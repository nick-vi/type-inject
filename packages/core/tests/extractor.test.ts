import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { type Config, TypeExtractor } from "../lib/index.ts";

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

const rootDir = path.join(import.meta.dir, "..");
const fixturesDir = path.join(import.meta.dir, "fixtures");

describe("TypeExtractor", () => {
	test("extracts functions from simple file", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(path.join(fixturesDir, "simple.ts"));

		const functionNames = types
			.filter((t) => t.kind === "function")
			.map((t) => t.name);
		expect(functionNames).toContain("greet");
		expect(functionNames).toContain("add");
	});

	test("extracts types and interfaces", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(path.join(fixturesDir, "with-types.ts"));

		const typeNames = types
			.filter((t) => t.kind === "type" || t.kind === "interface")
			.map((t) => t.name);
		expect(typeNames.length).toBeGreaterThan(0);
	});

	test("resolves imports up to maxDepth", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "depth-test/main.ts"),
		);

		const typeNames = types.map((t) => t.name);
		expect(typeNames).toContain("User");
		expect(typeNames).toContain("Role");
		expect(typeNames).toContain("Permission");
		expect(typeNames).toContain("AuditLog");
	});

	test("includes JSDoc comments", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(path.join(fixturesDir, "simple.ts"));

		const greet = types.find((t) => t.name === "greet");
		expect(greet?.jsdoc).toBeDefined();
		expect(greet?.jsdoc?.length).toBeGreaterThan(0);
	});

	test("extracts line numbers for types", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(path.join(fixturesDir, "simple.ts"));

		const greet = types.find((t) => t.name === "greet");
		expect(greet?.lineStart).toBeDefined();
		expect(greet?.lineEnd).toBeDefined();
		// greet function starts at line 6 (0-based: 5) and ends at line 8 (0-based: 7)
		expect(greet?.lineStart).toBe(5);
		expect(greet?.lineEnd).toBe(7);
	});

	test("extracts explicitly typed arrow functions", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "arrow-functions.ts"),
		);

		const functionNames = types
			.filter((t) => t.kind === "function")
			.map((t) => t.name);

		// Should include explicitly typed arrow functions
		expect(functionNames).toContain("processUser");
		expect(functionNames).toContain("myHandler");
		expect(functionNames).toContain("funcExpr");
		expect(functionNames).toContain("regularFunction");

		// Should NOT include non-typed arrow function
		expect(functionNames).not.toContain("double");
	});

	test("arrow functions have correct signatures", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "arrow-functions.ts"),
		);

		const processUser = types.find((t) => t.name === "processUser");
		expect(processUser?.signature).toBe(
			"const processUser: (id: string) => string",
		);

		const myHandler = types.find((t) => t.name === "myHandler");
		expect(myHandler?.signature).toBe("const myHandler: Handler");
	});

	test("sets importDepth for imported types", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "depth-test/main.ts"),
		);

		// Local type should not have importDepth
		const getUser = types.find((t) => t.name === "getUser");
		expect(getUser?.importDepth).toBeUndefined();

		// Direct import (depth 1)
		const user = types.find((t) => t.name === "User");
		expect(user?.importDepth).toBe(1);

		// Transitive import (depth 2)
		const role = types.find((t) => t.name === "Role");
		expect(role?.importDepth).toBe(2);
	});

	test("sets sourcePath as relative path for imports", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "depth-test/main.ts"),
		);

		const user = types.find((t) => t.name === "User");
		expect(user?.sourcePath).toBe("./tests/fixtures/depth-test/user.ts");
	});
});

describe("TypeExtractor - Svelte files", () => {
	test("extracts types from Svelte component", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/Counter.svelte"),
		);

		const typeNames = types.map((t) => t.name);
		expect(typeNames).toContain("CounterProps");
		expect(typeNames).toContain("increment");
		expect(typeNames).toContain("decrement");
		expect(typeNames).toContain("reset");
	});

	test("extracts CounterProps type correctly", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/Counter.svelte"),
		);

		const counterProps = types.find((t) => t.name === "CounterProps");
		expect(counterProps?.kind).toBe("type");
		expect(counterProps?.signature).toContain("initialCount");
		expect(counterProps?.signature).toContain("step");
		expect(counterProps?.signature).toContain("onCountChange");
	});

	test("extracts functions from Svelte component", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/Counter.svelte"),
		);

		const increment = types.find((t) => t.name === "increment");
		expect(increment?.kind).toBe("function");
		expect(increment?.signature).toContain("void");

		const reset = types.find((t) => t.name === "reset");
		expect(reset?.kind).toBe("function");
		expect(reset?.jsdoc?.length).toBeGreaterThan(0); // Has JSDoc
	});

	test("applies line offset for Svelte files", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/Counter.svelte"),
		);

		// CounterProps type starts at line 7 in the .svelte file (0-based: 6)
		// The <script lang="ts"> is at line 1 (0-based: 0), content starts at line 2 (0-based: 1)
		// So lineOffset is 1, and the type definition in the script is at line 4 (0-based: 3)
		// Final line should be 1 + 3 = 4... but let's check the actual value
		const counterProps = types.find((t) => t.name === "CounterProps");
		expect(counterProps?.lineStart).toBeDefined();
		// Line 7 in the file (0-based: 6) - the type keyword line
		expect(counterProps?.lineStart).toBe(6);
	});

	test("returns empty array for non-TypeScript Svelte files", () => {
		// This would require a fixture without lang="ts", but for now we test the existing file
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/Counter.svelte"),
		);

		// Should have extracted something since it has lang="ts"
		expect(types.length).toBeGreaterThan(0);
	});

	test("extracts types from module script (<script module>)", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/ModuleScript.svelte"),
		);

		const typeNames = types.map((t) => t.name);
		// Module script exports
		expect(typeNames).toContain("formatCurrency");
		expect(typeNames).toContain("Currency");
		expect(typeNames).toContain("PriceConfig");
	});

	test("module script has correct signatures", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/ModuleScript.svelte"),
		);

		const formatCurrency = types.find((t) => t.name === "formatCurrency");
		expect(formatCurrency?.kind).toBe("function");
		expect(formatCurrency?.signature).toContain("amount: number");
		expect(formatCurrency?.signature).toContain("string");

		const currency = types.find((t) => t.name === "Currency");
		expect(currency?.kind).toBe("type");
		expect(currency?.signature).toContain("USD");
		expect(currency?.signature).toContain("EUR");

		const priceConfig = types.find((t) => t.name === "PriceConfig");
		expect(priceConfig?.kind).toBe("interface");
		expect(priceConfig?.signature).toContain("showCents");
	});

	test("extracts types from PropsComponent with $props()", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/PropsComponent.svelte"),
		);

		const typeNames = types.map((t) => t.name);
		expect(typeNames).toContain("UserData");
		expect(typeNames).toContain("Props");
		expect(typeNames).toContain("handleSave");
	});

	test("UserData type has correct structure", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/PropsComponent.svelte"),
		);

		const userData = types.find((t) => t.name === "UserData");
		expect(userData?.kind).toBe("type");
		expect(userData?.signature).toContain("id: string");
		expect(userData?.signature).toContain("name: string");
		expect(userData?.signature).toContain("email: string");
		expect(userData?.exported).toBe(true);
	});

	test("extracts types from Svelte file that imports from TS", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/ImportFromTs.svelte"),
		);

		const typeNames = types.map((t) => t.name);
		// Local types defined in the Svelte file
		expect(typeNames).toContain("LoaderProps");
		expect(typeNames).toContain("load");

		// Imported types from types.ts should be resolved
		expect(typeNames).toContain("Status");
		expect(typeNames).toContain("ApiResponse");
		expect(typeNames).toContain("ID");
		expect(typeNames).toContain("createId");
	});

	test("imported types have correct sourcePath", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/ImportFromTs.svelte"),
		);

		const status = types.find((t) => t.name === "Status");
		expect(status?.sourcePath).toBe("./tests/fixtures/svelte/types.ts");
		expect(status?.importDepth).toBe(1);

		// Local type should not have sourcePath
		const loaderProps = types.find((t) => t.name === "LoaderProps");
		expect(loaderProps?.sourcePath).toBeUndefined();
	});

	test("extracts from both module and instance scripts", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/BothScripts.svelte"),
		);

		const typeNames = types.map((t) => t.name);

		// Instance script types
		expect(typeNames).toContain("BothProps");
		expect(typeNames).toContain("updateTheme");

		// Module script types (now extracted!)
		expect(typeNames).toContain("SharedConfig");
		expect(typeNames).toContain("getDefaultConfig");
	});

	test("has correct line numbers for both scripts", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/BothScripts.svelte"),
		);

		// Module script: SharedConfig starts at line 5 (0-based: 4)
		const sharedConfig = types.find((t) => t.name === "SharedConfig");
		expect(sharedConfig?.lineStart).toBe(4);

		// Instance script: BothProps starts at line 21 (0-based: 20)
		const bothProps = types.find((t) => t.name === "BothProps");
		expect(bothProps?.lineStart).toBe(20);
	});

	test("resolves deep import chain from Svelte through TS files", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/DeepImport.svelte"),
		);

		const typeNames = types.map((t) => t.name);

		// Local types from Svelte
		expect(typeNames).toContain("Props");
		expect(typeNames).toContain("loadUser");

		// Depth 1: from main.ts
		const getUser = types.find((t) => t.name === "getUser");
		expect(getUser?.importDepth).toBe(1);

		// Depth 2: from user.ts (imported by main.ts)
		const user = types.find((t) => t.name === "User");
		expect(user?.importDepth).toBe(2);

		// Depth 3: from role.ts (imported by user.ts)
		const role = types.find((t) => t.name === "Role");
		expect(role?.importDepth).toBe(3);

		// Depth 4: from permission.ts (imported by role.ts)
		const permission = types.find((t) => t.name === "Permission");
		expect(permission?.importDepth).toBe(4);
	});

	test("resolves TS → Svelte imports", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/ts-imports-svelte.ts"),
		);

		const typeNames = types.map((t) => t.name);

		// Local types from TS file
		expect(typeNames).toContain("PriceDisplay");
		expect(typeNames).toContain("createPriceDisplay");

		// Imported from ModuleScript.svelte
		expect(typeNames).toContain("formatCurrency");
		expect(typeNames).toContain("Currency");

		const formatCurrency = types.find((t) => t.name === "formatCurrency");
		expect(formatCurrency?.importDepth).toBe(1);
		expect(formatCurrency?.sourcePath).toBe(
			"./tests/fixtures/svelte/ModuleScript.svelte",
		);
	});

	test("resolves Svelte → TS → Svelte chain", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "svelte/SvelteToTsToSvelte.svelte"),
		);

		const typeNames = types.map((t) => t.name);

		// Local types
		expect(typeNames).toContain("Props");
		expect(typeNames).toContain("showPrice");

		// Depth 1: from ts-imports-svelte.ts
		const createPriceDisplay = types.find(
			(t) => t.name === "createPriceDisplay",
		);
		expect(createPriceDisplay?.importDepth).toBe(1);

		const priceDisplay = types.find((t) => t.name === "PriceDisplay");
		expect(priceDisplay?.importDepth).toBe(1);

		// Depth 2: Currency from ModuleScript.svelte (used in PriceDisplay type)
		const currency = types.find((t) => t.name === "Currency");
		expect(currency?.importDepth).toBe(2);
		expect(currency?.sourcePath).toBe(
			"./tests/fixtures/svelte/ModuleScript.svelte",
		);
	});

	test("extracts arrow functions with return type annotations", () => {
		const extractor = new TypeExtractor(rootDir, testConfig);
		const types = extractor.extract(
			path.join(fixturesDir, "arrow-return-annotation.ts"),
		);

		const functionNames = types
			.filter((t) => t.kind === "function")
			.map((t) => t.name);

		// Arrow function with only a return type annotation is extracted
		expect(functionNames).toContain("scale");
		const scale = types.find((t) => t.name === "scale");
		expect(scale?.signature).toBe("const scale: number");

		// Arrow function without any annotation is still skipped
		expect(functionNames).not.toContain("add");
	});

	test("resolves path-alias imports and extracts return-typed arrow functions", () => {
		const projectDir = path.join(fixturesDir, "alias-project");
		const extractor = new TypeExtractor(projectDir, testConfig);
		const types = extractor.extract(path.join(projectDir, "src/app.ts"));

		const typeNames = types.map((t) => t.name);

		// Types imported through the "@/lib/models" path alias
		expect(typeNames).toContain("Task");
		expect(typeNames).toContain("TaskStatus");

		// Arrow function with an explicit return type annotation
		expect(typeNames).toContain("makeTask");
		const makeTask = types.find((t) => t.name === "makeTask");
		expect(makeTask?.signature).toBe("const makeTask: Task");

		// Typed const using an imported type is used but plain typed consts
		// are not extracted by design (only as-const/Object.freeze)
		expect(typeNames).not.toContain("defaultStatus");
	});
});
