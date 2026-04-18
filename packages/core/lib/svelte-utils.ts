import * as fs from "node:fs";
import type { SourceFile, TsMorphProject as Project } from "./ts-morph.ts";

export type SvelteScript = {
	sourceFile: SourceFile;
	lineOffset: number;
	isModule: boolean;
};

export type SvelteParser = typeof import("svelte/compiler").parse;

/**
 * Try to load the svelte compiler (optional peer dependency)
 * Using require() for sync loading - cached for reuse across calls
 */
export function loadSvelteParser(): SvelteParser | null {
	try {
		return require("svelte/compiler").parse;
	} catch {
		return null;
	}
}

/**
 * Extract TypeScript script content from a Svelte file using svelte/compiler
 * Returns both module and instance scripts if present
 */
export function extractSvelteScripts(
	filePath: string,
	project: Project,
	svelteParser: SvelteParser | null,
	debug = false,
): SvelteScript[] {
	if (!svelteParser) {
		if (debug) {
			console.log(
				"[TypeInject] svelte/compiler not available, skipping Svelte file",
			);
		}
		return [];
	}

	const content = fs.readFileSync(filePath, "utf-8");

	// Parse the Svelte file with modern AST
	const ast = svelteParser(content, { modern: true, filename: filePath });

	const results: SvelteScript[] = [];

	// Process both module and instance scripts
	const scripts: Array<{ script: typeof ast.instance; isModule: boolean }> = [];
	if (ast.module) scripts.push({ script: ast.module, isModule: true });
	if (ast.instance) scripts.push({ script: ast.instance, isModule: false });

	for (const { script, isModule } of scripts) {
		if (!script) continue;

		// Check if it's a TypeScript script by looking at attributes
		const langAttr = script.attributes.find(
			(attr: { name: string }) => attr.name === "lang",
		);
		const isTypeScript =
			langAttr &&
			"value" in langAttr &&
			Array.isArray(langAttr.value) &&
			langAttr.value[0] &&
			"data" in langAttr.value[0] &&
			(langAttr.value[0].data === "ts" ||
				langAttr.value[0].data === "typescript");

		if (!isTypeScript) {
			if (debug) {
				console.log(
					`[TypeInject] Svelte ${isModule ? "module" : "instance"} script does not have lang='ts'`,
				);
			}
			continue;
		}

		// Extract the script content using start/end positions
		const scriptTag = content.slice(script.start, script.end);
		const openTagEnd = scriptTag.indexOf(">") + 1;
		const closeTagStart = scriptTag.lastIndexOf("</script>");
		const scriptContent = scriptTag.slice(openTagEnd, closeTagStart);

		// Calculate line offset: count newlines from file start to content start
		const contentStartPos = script.start + openTagEnd;
		const contentBeforeScript = content.slice(0, contentStartPos);
		const lineOffset = contentBeforeScript.split("\n").length - 1;

		// Create a virtual TypeScript file from the script content
		const suffix = isModule ? ".module.svelte.ts" : ".svelte.ts";
		const virtualPath = filePath.replace(".svelte", suffix);
		const sourceFile = project.createSourceFile(virtualPath, scriptContent, {
			overwrite: true,
		});

		results.push({ sourceFile, lineOffset, isModule });
	}

	return results;
}
