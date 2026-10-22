import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import plugin from "../.opencode/plugin/type-inject.ts";

// Any directory with a tsconfig.json and TS sources works; reuse core's fixtures.
const directory = path.resolve(import.meta.dir, "../../core");
const relPath = "tests/fixtures/import-test.ts";
const absPath = path.join(directory, relPath);
const raw = readFileSync(absPath, "utf8");
const lines = raw.replace(/\n$/, "").split("\n");

// biome-ignore lint/suspicious/noExplicitAny: fake host objects
type Any = any;

async function setupV2() {
	const tools: Any[] = [];
	let afterHook: ((event: Any) => Promise<void> | void) | undefined;
	const disposed: string[] = [];
	const cleanup = await plugin.setup({
		location: { directory },
		tool: {
			transform: async (callback: Any) => {
				callback({ add: (tool: Any) => tools.push(tool) });
				return { dispose: async () => void disposed.push("transform") };
			},
			hook: async (_name: Any, callback: Any) => {
				afterHook = callback;
				return { dispose: async () => void disposed.push("hook") };
			},
		},
	});
	if (!afterHook) throw new Error("execute.after hook not registered");
	return { tools, afterHook, cleanup, disposed };
}

function v2ReadEvent(
	output: Any,
	content: string,
	input: Any = { path: relPath },
) {
	return {
		tool: "read",
		input,
		status: "completed",
		result: { output, content: [{ type: "text", text: content }] },
	} as Any;
}

describe("default export", () => {
	test("exposes both v1 server and v2 setup", () => {
		expect(plugin.id).toBe("@nick-vi/opencode-type-inject");
		expect(typeof plugin.server).toBe("function");
		expect(typeof plugin.setup).toBe("function");
	});
});

describe("opencode v2 adapter", () => {
	test("registers direct tools with JSON Schema input", async () => {
		const { tools } = await setupV2();
		expect(tools.map((t) => t.name)).toEqual([
			"lookup_type",
			"list_types",
			"type_check",
		]);
		const lookup = tools[0];
		expect(lookup.options).toEqual({ codemode: false });
		expect(lookup.input.required).toEqual(["name"]);
		expect(lookup.input.properties.kind).toMatchObject({
			type: "array",
			items: { type: "string", enum: expect.arrayContaining(["interface"]) },
		});
	});

	test("lookup_type returns 1-based read offsets", async () => {
		const { tools } = await setupV2();
		const { content } = await tools[0].execute({ name: "UsedType" }, {});
		expect(content).toContain("## UsedType");
		expect(content).toMatch(/\[offset=[1-9]\d*,limit=\d+\]/);
	});

	test("injects types into the first text part of a full read", async () => {
		const { afterHook } = await setupV2();
		const display = `Read file ${relPath}\n1: ${lines[0]}`;
		const event = v2ReadEvent(
			{ type: "file", content: raw, encoding: "utf8", mime: "text/plain" },
			display,
		);
		await afterHook(event);
		const [part] = event.result.content;
		expect(part.type).toBe("text");
		expect(part.text).toStartWith("<types");
		expect(part.text).toContain("UsedType");
		expect(part.text).toEndWith(display);
	});

	test("injects for 1-based text pages", async () => {
		const { afterHook } = await setupV2();
		// Line 4 is `export function doSomething(input: UsedType): AnotherUsedType {`
		const event = v2ReadEvent(
			{ type: "text-page", content: lines[3], offset: 4, mime: "text/plain" },
			`Read file ${relPath}, lines 4-4\n4: ${lines[3]}`,
			{ path: relPath, offset: 4, limit: 1 },
		);
		await afterHook(event);
		expect(event.result.content[0].text).toStartWith("<types");
	});

	test("leaves directories, errors, binaries and other tools alone", async () => {
		const { afterHook } = await setupV2();
		const listing = v2ReadEvent({ type: "list-page", entries: [] }, "dir");
		const image = v2ReadEvent(
			{ type: "file", content: "AAAA", encoding: "base64", mime: "image/png" },
			"Image read successfully",
		);
		const other = {
			...v2ReadEvent({ type: "file", content: raw }, "x"),
			tool: "grep",
		};
		const failed: Any = {
			tool: "read",
			input: { path: relPath },
			status: "error",
		};
		for (const event of [listing, image, other, failed]) {
			const before = JSON.stringify(event);
			await afterHook(event);
			expect(JSON.stringify(event)).toBe(before);
		}
	});

	test("cleanup disposes registrations", async () => {
		const { cleanup, disposed } = await setupV2();
		await cleanup?.();
		expect(disposed.sort()).toEqual(["hook", "transform"]);
	});
});

describe("opencode v1 adapter", () => {
	test("registers zod tools and injects into reads", async () => {
		const hooks: Any = await plugin.server({ directory } as Any);
		expect(Object.keys(hooks.tool)).toEqual([
			"lookup_type",
			"list_types",
			"type_check",
		]);
		const kind = hooks.tool.lookup_type.args.kind;
		expect(kind.safeParse(["interface"]).success).toBe(true);
		expect(kind.safeParse(["nope"]).success).toBe(false);

		const callID = "call_1";
		await hooks["tool.execute.before"](
			{ tool: "read", sessionID: "s", callID },
			{ args: { filePath: absPath } },
		);
		const output = { title: "", output: raw, metadata: {} };
		await hooks["tool.execute.after"](
			{ tool: "read", sessionID: "s", callID, args: {} },
			output,
		);
		expect(output.output).toStartWith("<types");
		expect(output.output).toEndWith(raw);
	});

	test("treats read offsets as 1-based", async () => {
		const hooks: Any = await plugin.server({ directory } as Any);
		const callID = "call_2";
		// Line 4 uses UsedType; a 0-based reading would land on line 5 (`return {`)
		await hooks["tool.execute.before"](
			{ tool: "read", sessionID: "s", callID },
			{ args: { filePath: absPath, offset: 4, limit: 1 } },
		);
		const output = { title: "", output: `4: ${lines[3]}`, metadata: {} };
		await hooks["tool.execute.after"](
			{ tool: "read", sessionID: "s", callID, args: {} },
			output,
		);
		expect(output.output).toStartWith("<types");
	});
});
