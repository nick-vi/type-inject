import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type Diagnostic = {
	file: string;
	line: number;
	col: number;
	message: string;
	code: number;
	severity: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
};

export type CheckResult = {
	success: boolean;
	diagnostics: Diagnostic[];
	error?: string;
};

/**
 * Find the nearest tsconfig.json starting from filePath and walking up.
 * Stops at cwd to avoid searching above project root.
 * Returns null if no tsconfig.json is found.
 */
export function findNearestTsconfig(
	filePath: string,
	cwd: string,
): string | null {
	let dir = dirname(resolve(cwd, filePath));

	while (dir.startsWith(cwd)) {
		const tsconfigPath = join(dir, "tsconfig.json");
		if (existsSync(tsconfigPath)) {
			return tsconfigPath;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return null;
}

const TSC_DIAGNOSTIC_RE =
	/^(.+)\((\d+),(\d+)\): (error|warning|message) TS(\d+): (.+)$/;

function findTscBinary(startDir: string): string {
	let dir = startDir;
	while (true) {
		const candidate = join(dir, "node_modules", ".bin", "tsc");
		if (existsSync(candidate)) {
			return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return "tsc";
}

function parseTscOutput(output: string): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const line of output.split("\n")) {
		const match = TSC_DIAGNOSTIC_RE.exec(line);
		if (!match) continue;
		const [, file, lineStr, colStr, category, codeStr, message] =
			match as RegExpExecArray &
				[string, string, string, string, string, string, string];
		diagnostics.push({
			file,
			line: Number(lineStr),
			col: Number(colStr),
			message,
			code: Number(codeStr),
			severity: category === "error" ? 1 : category === "warning" ? 2 : 3,
		});
	}
	return diagnostics;
}

export function getProjectDiagnostics(
	tsconfigPath: string,
	filePath?: string,
): CheckResult {
	const projectDir = dirname(tsconfigPath);
	const tscBin = findTscBinary(projectDir);

	const result = spawnSync(
		tscBin,
		["--noEmit", "--pretty", "false", "--project", tsconfigPath],
		{ encoding: "utf8", timeout: 60_000, cwd: projectDir },
	);

	if (result.error) {
		return {
			success: false,
			diagnostics: [],
			error: `Failed to run tsc: ${result.error.message}`,
		};
	}

	if (result.signal) {
		return {
			success: false,
			diagnostics: [],
			error: `tsc terminated by signal: ${result.signal}`,
		};
	}

	const stdout = result.stdout || "";
	const stderr = result.stderr || "";
	let diagnostics = parseTscOutput(`${stdout}\n${stderr}`);

	// Resolve diagnostic file paths to absolute (tsc outputs relative to projectDir)
	for (const d of diagnostics) {
		if (!isAbsolute(d.file)) {
			d.file = resolve(projectDir, d.file);
		}
	}

	if (filePath) {
		// filePath may be absolute or relative to any directory,
		// so normalize the diagnostic path and compare basenames as fallback
		const absoluteFilePath = isAbsolute(filePath)
			? filePath
			: resolve(projectDir, filePath);
		diagnostics = diagnostics.filter(
			(d) => d.file === absoluteFilePath || d.file.endsWith(filePath),
		);
	}

	if (result.status !== 0 && diagnostics.length === 0) {
		const errorOutput = stderr.trim() || stdout.trim();
		return {
			success: false,
			diagnostics: [],
			error: errorOutput || "tsc failed without parseable output",
		};
	}

	return {
		success: result.status === 0 && diagnostics.length === 0,
		diagnostics,
	};
}

export function formatDiagnostics(
	diagnostics: Diagnostic[],
	cwd: string,
	options: {
		modifiedFile?: string;
		maxFileErrors?: number;
		maxProjectFiles?: number;
	} = {},
): string {
	const { modifiedFile, maxFileErrors = 20, maxProjectFiles = 5 } = options;

	const errorDiagnostics = diagnostics.filter((d) => d.severity === 1);

	if (errorDiagnostics.length === 0) {
		return "";
	}

	const fileErrors = modifiedFile
		? errorDiagnostics.filter(
				(d) => d.file === modifiedFile || d.file.endsWith(modifiedFile),
			)
		: [];
	const otherErrors = modifiedFile
		? errorDiagnostics.filter(
				(d) => d.file !== modifiedFile && !d.file.endsWith(modifiedFile),
			)
		: errorDiagnostics;

	const lines: string[] = [];

	if (fileErrors.length > 0) {
		lines.push("TypeScript errors in the file you just wrote:");
		lines.push("<file_diagnostics>");
		for (const err of fileErrors.slice(0, maxFileErrors)) {
			lines.push(`ERROR [${err.line}:${err.col}] ${err.message}`);
		}
		if (fileErrors.length > maxFileErrors) {
			lines.push(`... and ${fileErrors.length - maxFileErrors} more`);
		}
		lines.push("</file_diagnostics>");
	}

	if (otherErrors.length > 0) {
		lines.push("TypeScript errors in other project files:");
		lines.push("<project_diagnostics>");

		const byFile = new Map<string, Diagnostic[]>();
		for (const err of otherErrors) {
			const existing = byFile.get(err.file) || [];
			existing.push(err);
			byFile.set(err.file, existing);
		}

		let fileCount = 0;
		for (const [file, errors] of byFile) {
			if (fileCount >= maxProjectFiles) {
				lines.push(
					`... and ${byFile.size - maxProjectFiles} more files with errors`,
				);
				break;
			}

			const relativePath = file.startsWith(cwd)
				? file.slice(cwd.length + 1)
				: file;

			lines.push(relativePath);
			for (const err of errors.slice(0, 5)) {
				lines.push(`  ERROR [${err.line}:${err.col}] ${err.message}`);
			}
			if (errors.length > 5) {
				lines.push(`  ... and ${errors.length - 5} more`);
			}
			fileCount++;
		}
		lines.push("</project_diagnostics>");
	}

	return lines.join("\n");
}
