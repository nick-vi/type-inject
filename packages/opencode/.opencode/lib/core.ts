import { existsSync } from "node:fs";
import path from "node:path";
import {
	CHARS_PER_TOKEN,
	type Config,
	ContentFormatter,
	defaultConfig,
	type ExtractedTypeKind,
	filterVisibleTypes,
	findNearestTsconfig,
	formatDiagnostics,
	getProjectDiagnostics,
	isBarrelFile,
	prioritizeTypes,
	TypeExtractor,
	TypeLookup,
} from "@nick-vi/type-inject-core";

/**
 * Runtime-agnostic tool argument description. The v1 adapter turns it into
 * zod, the v2 adapter into JSON Schema.
 */
export type ArgSpec = {
	type: "string" | "number" | "boolean" | "string[]";
	enum?: readonly [string, ...string[]];
	optional?: boolean;
	description: string;
};

export type ToolDef = {
	name: string;
	description: string;
	args: Record<string, ArgSpec>;
	execute(args: Record<string, unknown>): string;
};

export type LineRange = { offset: number; limit: number };

export type InjectInput = {
	filePath: string;
	/** Raw file text, used for barrel detection and line counting. */
	rawContent: string;
	/** Text shown to the model; types are prepended to this. */
	displayContent: string;
	/** 0-based line range for partial reads. */
	lineRange?: LineRange;
};

export type TypeInject = {
	tools: ToolDef[];
	/** Returns the injected content, or undefined when nothing should change. */
	inject(input: InjectInput): string | undefined;
};

const KINDS = [
	"function",
	"type",
	"interface",
	"enum",
	"class",
	"const",
] as const;

export function createTypeInject(directory: string): TypeInject | undefined {
	const config: Config = defaultConfig;

	if (config.debug) {
		console.log("🔌 [TypeInject] Plugin Loading...");
		console.log(`   Enabled: ${config.enabled}`);
		console.log(`   Debug: ${config.debug}`);
	}

	if (!config.enabled) {
		return undefined;
	}

	const tsConfigPath = path.join(directory, "tsconfig.json");
	if (!existsSync(tsConfigPath)) {
		if (config.debug) {
			console.log(
				`[TypeInject] Skipping - no tsconfig.json found at: ${tsConfigPath}`,
			);
		}
		return undefined;
	}

	const extractor = new TypeExtractor(directory, config);
	const formatter = new ContentFormatter(config);
	const typeLookup = new TypeLookup(directory, config);

	if (config.debug) {
		console.log("✅ [TypeInject] Plugin initialized successfully");
	}

	const tools: ToolDef[] = [
		{
			name: "lookup_type",
			description:
				"Look up TypeScript type definitions by name. Returns the full type signature, file location, and optionally where it's used. Use this to quickly find type definitions without reading entire files.",
			args: {
				name: {
					type: "string",
					description: "Type name to search for (e.g., 'User', 'Config')",
				},
				exact: {
					type: "boolean",
					optional: true,
					description: "Exact match (true) or contains (false). Default: true",
				},
				kind: {
					type: "string[]",
					enum: KINDS,
					optional: true,
					description:
						"Filter by type kind. Options: function, type, interface, enum, class, const",
				},
				includeUsages: {
					type: "boolean",
					optional: true,
					description:
						"Include files that import/use this type. Default: false (can be slow)",
				},
				limit: {
					type: "number",
					optional: true,
					description: "Maximum results to return. Default: 5",
				},
			},
			execute(args) {
				const name = args.name as string;
				const result = typeLookup.findType(name, {
					exact: (args.exact as boolean | undefined) ?? true,
					kind: args.kind as ExtractedTypeKind[] | undefined,
					includeUsages: (args.includeUsages as boolean | undefined) ?? false,
					limit: (args.limit as number | undefined) ?? 5,
				});

				if (!result.found) {
					return `No types found matching "${name}"`;
				}

				const lines: string[] = [];

				lines.push(
					`Found ${result.totalMatches} type(s) matching "${name}" (showing ${result.types.length}):`,
				);
				lines.push("");

				for (const type of result.types) {
					lines.push(`## ${type.name} (${type.kind})`);
					// The read tool's offset is 1-based (opencode >=1.2 and v2)
					const offset = type.line;
					const limit = type.lineEnd - type.line + 1;
					lines.push(
						`File: ${type.relativePath} [offset=${offset},limit=${limit}]`,
					);
					if (type.exported) lines.push("Exported: yes");
					if (type.jsdoc) lines.push(`JSDoc: ${type.jsdoc}`);
					if (type.generics?.length) {
						lines.push(`Generics: <${type.generics.join(", ")}>`);
					}
					lines.push("");
					lines.push("```typescript");
					lines.push(type.signature);
					lines.push("```");

					if (type.usedIn?.length) {
						lines.push("");
						lines.push(`Used in ${type.usedIn.length} file(s):`);
						for (const usage of type.usedIn.slice(0, 10)) {
							lines.push(`  - ${usage.relativePath}:${usage.line}`);
						}
						if (type.usedIn.length > 10) {
							lines.push(`  ... and ${type.usedIn.length - 10} more`);
						}
					}
					lines.push("");
				}

				if (result.totalMatches > result.types.length) {
					lines.push(
						`(${result.totalMatches - result.types.length} more results not shown)`,
					);
				}

				lines.push(`Search time: ${result.searchTimeMs}ms`);
				if (result.indexBuilt) {
					lines.push("(Index was built during this query)");
				}

				return lines.join("\n");
			},
		},
		{
			name: "list_types",
			description:
				"List all TypeScript type names in the project. Useful for discovering available types or autocomplete suggestions.",
			args: {
				kind: {
					type: "string[]",
					enum: KINDS,
					optional: true,
					description: "Filter by type kind",
				},
				limit: {
					type: "number",
					optional: true,
					description: "Maximum results to return. Default: 100",
				},
			},
			execute(args) {
				const results = typeLookup.listTypeNames({
					kind: args.kind as ExtractedTypeKind[] | undefined,
					limit: (args.limit as number | undefined) ?? 100,
				});

				if (results.length === 0) {
					return "No types found in the project";
				}

				const stats = typeLookup.getStats();
				const lines: string[] = [];
				lines.push(
					`Found ${stats.totalTypes} types in ${stats.totalFiles} files. Showing ${results.length}:`,
				);
				lines.push("");
				lines.push(results.map((r) => `${r.name} (${r.kind})`).join(", "));

				return lines.join("\n");
			},
		},
		{
			name: "type_check",
			description:
				"Run TypeScript type checking on the project or a specific file. Returns diagnostic errors if any type issues are found.",
			args: {
				file: {
					type: "string",
					optional: true,
					description:
						"File path to check. If omitted, checks the entire project.",
				},
			},
			execute(args) {
				const file = args.file as string | undefined;
				const effectiveTsconfig = file
					? (findNearestTsconfig(file, directory) ?? tsConfigPath)
					: tsConfigPath;

				const result = getProjectDiagnostics(effectiveTsconfig, file);

				if (result.error) {
					return result.error;
				}

				if (result.success) {
					if (file) {
						return `No TypeScript errors found in ${file}`;
					}
					return "No TypeScript errors found in the project";
				}

				const formatted = formatDiagnostics(
					result.diagnostics,
					directory,
					file
						? { modifiedFile: file, maxFileErrors: 50 }
						: { maxProjectFiles: 20 },
				);

				const header = file
					? `TypeScript errors found in ${file}:`
					: `TypeScript errors found in project (${result.diagnostics.length} total):`;

				return `${header}\n\n${formatted}`;
			},
		},
	];

	function inject({
		filePath,
		rawContent,
		displayContent,
		lineRange,
	}: InjectInput): string | undefined {
		if (config.debug) {
			console.log(`\n🔍 [TypeInject] Read tool executed for: ${filePath}`);
			if (lineRange) {
				console.log(
					`   📍 Line range: offset=${lineRange.offset}, limit=${lineRange.limit}`,
				);
			}
		}

		if (!isTypeScriptFile(filePath)) {
			if (config.debug) {
				console.log(`   ⏭️  Not a TypeScript file, skipping`);
			}
			return undefined;
		}

		try {
			if (config.budget.skipBarrelFiles && isBarrelFile(rawContent)) {
				if (config.debug) {
					console.log(`   ⏭️  Barrel file detected, skipping injection`);
				}
				return undefined;
			}

			const startTime = Date.now();
			const rawTypes = extractor.extract(filePath, lineRange);
			const extractTime = Date.now() - startTime;

			if (config.debug) {
				console.log(
					`   📊 Extracted ${rawTypes.length} types in ${extractTime}ms`,
				);
			}

			const priorityResult = prioritizeTypes(rawTypes, {
				tokenBudget: config.budget.maxTokens,
				debug: config.debug,
			});

			if (config.debug && priorityResult.budgetExceeded) {
				console.log(
					`   ⚠️  Budget exceeded: ${priorityResult.excludedCount} types excluded`,
				);
			}

			// Filter out local types that are already visible in the read content
			const totalLines = rawContent.split("\n").length;
			const types = filterVisibleTypes(
				priorityResult.types,
				lineRange,
				totalLines,
			);

			// Recalculate tokens for filtered types
			const estimatedTokens = Math.ceil(
				types.reduce((sum: number, t) => sum + t.signature.length, 0) /
					CHARS_PER_TOKEN,
			);

			const injected = formatter.format(displayContent, types, {
				totalTypes: types.length,
				estimatedTokens,
				isPartialRead: lineRange !== undefined,
				includeDescription: false,
			});

			if (config.debug) {
				console.log(
					`   ✨ Injection complete: ${displayContent.length} -> ${injected.length} bytes (~${priorityResult.totalTokens} tokens)`,
				);
			}

			return injected;
		} catch (error) {
			console.error(`❌ [TypeInject] Error processing ${filePath}:`, error);
			return undefined;
		}
	}

	return { tools, inject };
}

function isTypeScriptFile(filePath: string): boolean {
	return (
		filePath.endsWith(".ts") ||
		filePath.endsWith(".tsx") ||
		filePath.endsWith(".mts") ||
		filePath.endsWith(".cts") ||
		filePath.endsWith(".svelte")
	);
}
