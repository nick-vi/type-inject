import path from "node:path";
import { type ArgSpec, createTypeInject } from "./core.ts";

// Minimal structural slice of the opencode v2 plugin API
// (`@opencode-ai/plugin` promise entry). Declared locally so the package
// doesn't depend on the v2 beta and its transitive deps.

type Registration = { dispose(): Promise<void> };

type JsonSchema = { [key: string]: unknown };

type ContentPart = { readonly type: string; readonly text?: string };

type ToolResult = {
	readonly output?: unknown;
	readonly content?: string | ReadonlyArray<ContentPart>;
	readonly metadata?: Readonly<Record<string, unknown>>;
};

type ToolInfo = {
	readonly name: string;
	readonly description: string;
	readonly input: JsonSchema;
	readonly options?: { readonly codemode: boolean };
	readonly execute: (
		input: unknown,
		context: unknown,
	) => Promise<{ readonly content: string }>;
};

type ExecuteAfterEvent = {
	readonly tool: string;
	readonly input: unknown;
} & (
	| { readonly status: "completed"; result: ToolResult }
	| { readonly status: "error" }
);

export type Context = {
	readonly location: { readonly directory: string };
	readonly tool: {
		readonly transform: (
			callback: (editor: { add(tool: ToolInfo): void }) => void,
		) => Promise<Registration>;
		readonly hook: (
			name: "execute.after",
			callback: (event: ExecuteAfterEvent) => Promise<void> | void,
		) => Promise<Registration>;
	};
};

type ReadOutput =
	| { type: "file"; content: string; encoding?: string }
	| { type: "text-page"; content: string; offset: number }
	| { type: "list-page" };

function toJsonSchema(spec: ArgSpec): JsonSchema {
	const scalar = spec.type === "string[]" ? "string" : spec.type;
	const item = spec.enum ? { type: scalar, enum: spec.enum } : { type: scalar };
	return spec.type === "string[]"
		? { type: "array", items: item, description: spec.description }
		: { ...item, description: spec.description };
}

/** opencode v2 plugin setup. */
export async function setup(ctx: Context) {
	const directory = ctx.location.directory;
	const typeInject = createTypeInject(directory);
	if (!typeInject) {
		return;
	}

	const registrations = await Promise.all([
		ctx.tool.transform((editor) => {
			for (const def of typeInject.tools) {
				editor.add({
					name: def.name,
					description: def.description,
					input: {
						type: "object",
						properties: Object.fromEntries(
							Object.entries(def.args).map(([key, spec]) => [
								key,
								toJsonSchema(spec),
							]),
						),
						required: Object.entries(def.args)
							.filter(([, spec]) => !spec.optional)
							.map(([key]) => key),
					},
					// Expose directly to the model instead of behind the codemode `execute` tool
					options: { codemode: false },
					execute: async (input) => ({
						content: def.execute((input ?? {}) as Record<string, unknown>),
					}),
				});
			}
		}),

		ctx.tool.hook("execute.after", (event) => {
			if (event.tool !== "read" || event.status !== "completed") {
				return;
			}

			const { result } = event;
			const output = result.output as ReadOutput | undefined;
			const filePath = (event.input as { path?: unknown } | undefined)?.path;
			if (
				typeof filePath !== "string" ||
				!output ||
				output.type === "list-page" ||
				(output.type === "file" && output.encoding === "base64")
			) {
				return;
			}

			// Hooks see content normalized to parts; inject into the first text part
			const parts =
				typeof result.content === "string"
					? [{ type: "text", text: result.content }]
					: result.content;
			const textIndex =
				parts?.findIndex(
					(part) => part.type === "text" && typeof part.text === "string",
				) ?? -1;
			const displayContent = parts?.[textIndex]?.text;
			if (!parts || displayContent === undefined) {
				return;
			}

			const injected = typeInject.inject({
				filePath: path.resolve(directory, filePath),
				rawContent: output.content,
				displayContent,
				// Pages are 1-based; the extractor expects 0-based
				lineRange:
					output.type === "text-page"
						? {
								offset: output.offset - 1,
								limit: output.content.split("\n").length,
							}
						: undefined,
			});

			if (injected !== undefined) {
				event.result = {
					...result,
					content: parts.map((part, i) =>
						i === textIndex ? { type: "text", text: injected } : part,
					),
				};
			}
		}),
	]);

	return async () => {
		await Promise.all(registrations.map((r) => r.dispose()));
	};
}
