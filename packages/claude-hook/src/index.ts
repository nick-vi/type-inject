#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
	CHARS_PER_TOKEN,
	ContentFormatter,
	defaultConfig,
	filterVisibleTypes,
	formatDiagnostics,
	getProjectDiagnostics,
	prioritizeTypes,
	TypeExtractor,
} from "@nick-vi/type-inject-core";

// Read stdin
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
	chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString());
const { tool_name, tool_input } = input;

if (!tool_input) {
	process.exit(0);
}

const filePath = tool_input.file_path;

// Handle Read tool - type injection
if (tool_name === "Read") {
	handleRead(filePath, tool_input);
}

// Handle Write tool - type checking
if (tool_name === "Write") {
	handleWrite(filePath);
}

function handleRead(
	filePath: string,
	toolInput: { offset?: number; limit?: number },
) {
	if (!filePath?.match(/\.(ts|tsx|mts|cts|svelte)$/)) {
		process.exit(0);
	}

	const offset = toolInput.offset as number | undefined;
	const limit = toolInput.limit as number | undefined;
	const lineRange =
		offset !== undefined && limit !== undefined ? { offset, limit } : undefined;

	try {
		const cwd = process.cwd();
		const extractor = new TypeExtractor(cwd, defaultConfig);
		const formatter = new ContentFormatter(defaultConfig);

		const rawTypes = extractor.extract(filePath, lineRange);
		const { types: prioritizedTypes } = prioritizeTypes(rawTypes, {
			tokenBudget: defaultConfig.budget.maxTokens,
			debug: false,
		});

		// Filter out local types that are already visible in the read content
		const fileContent = readFileSync(filePath, "utf-8");
		const totalLines = fileContent.split("\n").length;
		const types = filterVisibleTypes(prioritizedTypes, lineRange, totalLines);

		if (types.length === 0) {
			process.exit(0);
		}

		// Recalculate tokens for filtered types
		const estimatedTokens = Math.ceil(
			types.reduce((sum: number, t) => sum + t.signature.length, 0) /
				CHARS_PER_TOKEN,
		);

		const formatted = formatter.formatTypesOnly(types, {
			totalTypes: types.length,
			estimatedTokens,
			isPartialRead: lineRange !== undefined,
			includeDescription: true,
		});

		console.log(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
					additionalContext: formatted,
				},
			}),
		);
	} catch {
		// Fail silently
		process.exit(0);
	}
}

function handleWrite(filePath: string) {
	// Only check TypeScript files
	if (!filePath?.match(/\.(ts|tsx|mts|cts)$/)) {
		process.exit(0);
	}

	const cwd = process.cwd();

	// Find tsconfig.json in parent directories, but don't go above cwd
	let tsconfigDir = path.dirname(path.resolve(cwd, filePath));

	while (tsconfigDir.startsWith(cwd)) {
		if (existsSync(path.join(tsconfigDir, "tsconfig.json"))) {
			break;
		}
		const parent = path.dirname(tsconfigDir);
		if (parent === tsconfigDir) break;
		tsconfigDir = parent;
	}

	const tsconfigPath = path.join(tsconfigDir, "tsconfig.json");
	if (!existsSync(tsconfigPath)) {
		process.exit(0);
	}

	try {
		const result = getProjectDiagnostics(tsconfigPath);

		if (result.error) {
			process.exit(0);
		}

		if (result.success || result.diagnostics.length === 0) {
			process.exit(0);
		}

		const absoluteFilePath = path.resolve(cwd, filePath);
		const formatted = formatDiagnostics(result.diagnostics, cwd, {
			modifiedFile: absoluteFilePath,
		});

		if (!formatted) {
			process.exit(0);
		}

		console.log(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
					additionalContext: formatted,
				},
			}),
		);
	} catch {
		// Fail silently
		process.exit(0);
	}
}
