import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { type Config, TypeLookup } from "../lib/index.ts";

const testConfig: Config = {
	enabled: true,
	debug: false,
	includeJSDoc: true,
	inject: {
		functions: true,
		types: true,
		interfaces: true,
		enums: true,
		classes: true,
		constants: true,
	},
	format: { includeMarkers: true },
	imports: { enabled: true, maxDepth: 4, includeTypeOnly: true },
	filtering: { onlyUsed: true, includeTransitive: true },
	budget: { maxTokens: 1500, skipBarrelFiles: true },
};

const projectDir = path.join(import.meta.dir, "..");

describe("TypeLookup", () => {
	test("finds types by exact name", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const result = lookup.findType("Config", { exact: true });

		expect(result.found).toBe(true);
		expect(result.types[0]?.name).toBe("Config");
	});

	test("finds types by partial name", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const result = lookup.findType("Type", { exact: false, limit: 10 });

		expect(result.found).toBe(true);
		expect(result.totalMatches).toBeGreaterThan(1);
	});

	test("filters by kind", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const result = lookup.findType("greet", {
			exact: true,
			kind: ["function"],
		});

		expect(result.found).toBe(true);
		expect(result.types[0]?.kind).toBe("function");
	});

	test("lists all type names", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const names = lookup.listTypeNames({ limit: 50 });

		expect(names.length).toBeGreaterThan(0);
		expect(names.length).toBeLessThanOrEqual(50);
	});

	test("returns stats", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		lookup.findType("Config");
		const stats = lookup.getStats();

		expect(stats.indexed).toBe(true);
		expect(stats.totalTypes).toBeGreaterThan(0);
		expect(stats.totalFiles).toBeGreaterThan(0);
	});
});

describe("TypeLookup - Svelte files", () => {
	test("finds types from Svelte files", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const result = lookup.findType("CounterProps", { exact: true });

		expect(result.found).toBe(true);
		expect(result.types[0]?.name).toBe("CounterProps");
		expect(result.types[0]?.filePath).toContain("Counter.svelte");
	});

	test("finds functions from Svelte files", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const result = lookup.findType("increment", {
			exact: true,
			kind: ["function"],
		});

		expect(result.found).toBe(true);
		expect(result.types[0]?.kind).toBe("function");
		expect(result.types[0]?.filePath).toContain("Counter.svelte");
	});

	test("finds types from module script", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const result = lookup.findType("Currency", { exact: true });

		expect(result.found).toBe(true);
		expect(result.types[0]?.name).toBe("Currency");
		expect(result.types[0]?.filePath).toContain("ModuleScript.svelte");
	});

	test("applies correct line offset for Svelte types", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const result = lookup.findType("CounterProps", { exact: true });

		expect(result.found).toBe(true);
		// CounterProps is at line 7 in Counter.svelte (1-based)
		// The type definition starts after <script lang="ts"> on line 2
		expect(result.types[0]?.line).toBeGreaterThan(1);
	});

	test("lists Svelte types in listTypeNames", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		const names = lookup.listTypeNames({ limit: 300 });

		const svelteTypes = ["CounterProps", "Currency", "PriceConfig", "UserData"];
		for (const typeName of svelteTypes) {
			expect(names.some((n) => n.name === typeName)).toBe(true);
		}
	});

	test("stats include Svelte files", () => {
		const lookup = new TypeLookup(projectDir, testConfig);
		lookup.findType("CounterProps"); // Trigger indexing
		const stats = lookup.getStats();

		// Should have indexed Svelte files
		expect(stats.totalFiles).toBeGreaterThan(5);
	});
});

describe("TypeLookup - solution-style tsconfig", () => {
	const solutionDir = path.join(import.meta.dir, "fixtures", "solution-style");

	test("indexes types via referenced tsconfig when root has no files", () => {
		const lookup = new TypeLookup(solutionDir, testConfig);
		const result = lookup.findType("BuildStatus", { exact: true });

		expect(result.found).toBe(true);
		expect(result.types[0]?.name).toBe("BuildStatus");
	});

	test("finds functions and interfaces from referenced project", () => {
		const lookup = new TypeLookup(solutionDir, testConfig);

		const fn = lookup.findType("formatBuildStatus", { exact: true });
		expect(fn.found).toBe(true);
		expect(fn.types[0]?.kind).toBe("function");

		const iface = lookup.findType("BuildInfo", { exact: true });
		expect(iface.found).toBe(true);
		expect(iface.types[0]?.kind).toBe("interface");
	});

	test("listTypeNames is not empty", () => {
		const lookup = new TypeLookup(solutionDir, testConfig);
		const names = lookup.listTypeNames({ limit: 50 });

		expect(names.length).toBeGreaterThan(0);
		expect(names.some((n) => n.name === "BuildStatus")).toBe(true);
	});
});

describe("TypeLookup - project reference formats", () => {
	for (const { fixture, names } of [
		{ fixture: "solution-comments", names: ["BuildStatus"] },
		{ fixture: "solution-multiple", names: ["BuildStatus", "NodeEnvironment"] },
		{ fixture: "solution-directory", names: ["NodeEnvironment"] },
		{ fixture: "solution-missing", names: ["BuildStatus"] },
	]) {
		test(`indexes referenced types in ${fixture}`, () => {
			const lookup = new TypeLookup(
				path.join(import.meta.dir, "fixtures", fixture),
				testConfig,
			);
			for (const name of names) {
				const result = lookup.findType(name, { exact: true });
				expect(result.found).toBe(true);
				expect(result.types[0]?.name).toBe(name);
			}
			const listed = lookup.listTypeNames().map((entry) => entry.name);
			for (const name of names) {
				expect(listed).toContain(name);
			}
		});
	}
});
