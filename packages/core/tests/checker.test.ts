import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { getProjectDiagnostics } from "../lib/index.ts";

const fixtureDir = path.join(import.meta.dir, "fixtures/typecheck");
const tsconfigPath = path.join(fixtureDir, "tsconfig.json");

describe("getProjectDiagnostics", () => {
	test("reports errors across the project", () => {
		const result = getProjectDiagnostics(tsconfigPath);
		expect(result.success).toBe(false);
		expect(result.error).toBeUndefined();
		expect(result.diagnostics.map((d) => path.basename(d.file))).toEqual([
			"broken.ts",
		]);
	});

	test("reports errors in the requested file", () => {
		const result = getProjectDiagnostics(
			tsconfigPath,
			path.join(fixtureDir, "broken.ts"),
		);
		expect(result.success).toBe(false);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]?.code).toBe(2322);
	});

	test("a clean file passes even when other files have errors", () => {
		const result = getProjectDiagnostics(
			tsconfigPath,
			path.join(fixtureDir, "clean.ts"),
		);
		expect(result).toEqual({ success: true, diagnostics: [] });
	});

	test("returns raw tsc output when tsc fails without diagnostics", () => {
		const result = getProjectDiagnostics(
			path.join(fixtureDir, "missing-tsconfig.json"),
		);
		expect(result.success).toBe(false);
		expect(result.diagnostics).toEqual([]);
		expect(result.error).toContain("TS5058");
	});
});
