import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type DiagnosticMessageChain, DiagnosticCategory, Project, ts } from "ts-morph";

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

/**
 * Map TypeScript DiagnosticCategory to severity level.
 * TypeScript: Warning=0, Error=1, Suggestion=2, Message=3
 * Severity: 1=Error, 2=Warning, 3=Info, 4=Hint
 */
function mapCategoryToSeverity(category: DiagnosticCategory): number {
	switch (category) {
		case DiagnosticCategory.Error:
			return 1;
		case DiagnosticCategory.Warning:
			return 2;
		case DiagnosticCategory.Message:
			return 3;
		case DiagnosticCategory.Suggestion:
			return 4;
		default:
			return 1;
	}
}

function flattenMessageText(
	msg: string | DiagnosticMessageChain,
): string {
	if (typeof msg === "string") return msg;
	return ts.flattenDiagnosticMessageText(msg.compilerObject, "\n");
}

export function getProjectDiagnostics(
	tsconfigPath: string,
	filePath?: string,
): CheckResult {
	try {
		const project = new Project({
			tsConfigFilePath: tsconfigPath,
			skipAddingFilesFromTsConfig: false,
		});

		const preEmitDiagnostics = project.getPreEmitDiagnostics();
		const diagnostics: Diagnostic[] = [];

		for (const diagnostic of preEmitDiagnostics) {
			const sourceFile = diagnostic.getSourceFile();
			if (!sourceFile) continue;

			const fileDiagPath = sourceFile.getFilePath();

			if (
				filePath &&
				!fileDiagPath.endsWith(filePath) &&
				fileDiagPath !== filePath
			) {
				continue;
			}

			const start = diagnostic.getStart();
			const lineAndCol = sourceFile.getLineAndColumnAtPos(start ?? 0);

			diagnostics.push({
				file: fileDiagPath,
				line: lineAndCol.line,
				col: lineAndCol.column,
				message: flattenMessageText(diagnostic.getMessageText()),
				code: diagnostic.getCode(),
				severity: mapCategoryToSeverity(diagnostic.getCategory()),
			});
		}

		return {
			success: diagnostics.length === 0,
			diagnostics,
		};
	} catch {
		return {
			success: true,
			diagnostics: [],
		};
	}
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
