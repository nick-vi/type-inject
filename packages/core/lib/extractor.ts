import * as path from "node:path";
import {
	Project,
	type TsMorphProject,
	type SourceFile,
	SyntaxKind,
	VariableDeclarationKind,
} from "./ts-morph.ts";
import {
	extractSvelteScripts,
	loadSvelteParser,
	type SvelteParser,
} from "./svelte-utils.ts";
import type { Config, ExtractedType } from "./types.ts";

export class TypeExtractor {
	private project: TsMorphProject;
	private config: Config;
	private directory: string;
	private svelteParser: SvelteParser | null = null;

	constructor(directory: string, config: Config) {
		this.config = config;
		this.directory = directory;

		const tsConfigPath = path.join(directory, "tsconfig.json");

		try {
			this.project = new Project({
				tsConfigFilePath: tsConfigPath,
				skipAddingFilesFromTsConfig: true,
				compilerOptions: {
					allowJs: true,
				},
			});
		} catch {
			// If tsconfig fails to load, create project without it
			if (this.config.debug) {
				console.log(
					"[TypeInject] Failed to load tsconfig.json, using default compiler options",
				);
			}
			this.project = new Project({
				skipAddingFilesFromTsConfig: true,
				compilerOptions: {
					allowJs: true,
				},
			});
		}

		// Try to load svelte compiler (optional peer dependency)
		// Using require() for sync loading - cached for reuse across extract() calls
		this.svelteParser = loadSvelteParser();

		if (this.config.debug) {
			console.log("[TypeInject] TypeExtractor initialized");
			console.log("[TypeInject] tsconfig.json:", tsConfigPath);
			console.log(
				"[TypeInject] Svelte support:",
				this.svelteParser ? "enabled" : "disabled",
			);
		}
	}

	/**
	 * Extract type signatures from a TypeScript or Svelte file
	 * @param filePath Path to the TypeScript/Svelte file
	 * @param lineRange Optional line range to filter types (for partial reads)
	 */
	extract(
		filePath: string,
		lineRange?: { offset: number; limit: number },
	): ExtractedType[] {
		const startTime = Date.now();

		if (this.config.debug) {
			console.log(`[TypeInject] Extracting types from: ${filePath}`);
		}

		try {
			// Handle Svelte files by extracting script content (may have multiple scripts)
			const isSvelteFile = filePath.endsWith(".svelte");
			const types: ExtractedType[] = [];
			const processedFiles = new Set<string>();
			processedFiles.add(filePath);

			// Track primary source file for filtering (instance script for Svelte, or the TS file)
			let primarySourceFile: SourceFile | undefined;

			if (isSvelteFile) {
				const svelteResults = this.getSvelteScripts(filePath);
				if (svelteResults.length === 0) {
					if (this.config.debug) {
						console.log(
							`[TypeInject] No TypeScript script found in Svelte file`,
						);
					}
					return [];
				}

				// Extract from all scripts (module and instance)
				for (const { sourceFile, lineOffset, isModule } of svelteResults) {
					const scriptTypes = this.extractTypesFromSourceFile(sourceFile);

					// Apply lineOffset to local types
					for (const type of scriptTypes) {
						if (type.lineStart !== undefined) {
							type.lineStart += lineOffset;
						}
						if (type.lineEnd !== undefined) {
							type.lineEnd += lineOffset;
						}
					}

					types.push(...scriptTypes);

					// Resolve imports from this script
					if (this.config.imports.enabled) {
						const importedTypes = this.resolveImports(
							sourceFile,
							0,
							processedFiles,
						);
						types.push(...importedTypes);
					}

					// Use instance script as primary, fallback to module
					if (!isModule || !primarySourceFile) {
						primarySourceFile = sourceFile;
					}
				}
			} else {
				primarySourceFile = this.project.addSourceFileAtPath(filePath);
				types.push(...this.extractTypesFromSourceFile(primarySourceFile));

				if (this.config.imports.enabled) {
					const importedTypes = this.resolveImports(
						primarySourceFile,
						0,
						processedFiles,
					);
					types.push(...importedTypes);
				}
			}

			// Apply filtering if enabled
			let finalTypes = types;
			if (this.config.filtering.onlyUsed && primarySourceFile) {
				if (lineRange) {
					finalTypes = this.filterTypesForLineRange(
						primarySourceFile,
						types,
						lineRange,
					);
				} else {
					finalTypes = this.filterUsedTypes(primarySourceFile, types);
				}
			}

			const duration = Date.now() - startTime;

			if (this.config.debug) {
				console.log(
					`[TypeInject] Extracted ${finalTypes.length} types in ${duration}ms`,
				);
			}

			return finalTypes;
		} catch (error) {
			if (this.config.debug) {
				console.error(
					`[TypeInject] Error extracting types from ${filePath}:`,
					error,
				);
			}
			return [];
		}
	}

	/**
	 * Extract all types from a source file (without import resolution)
	 */
	private extractTypesFromSourceFile(sourceFile: SourceFile): ExtractedType[] {
		const types: ExtractedType[] = [];

		if (this.config.inject.functions) {
			types.push(...this.extractFunctions(sourceFile));
			types.push(...this.extractArrowFunctions(sourceFile));
		}

		if (this.config.inject.types) {
			types.push(...this.extractTypeAliases(sourceFile));
		}

		if (this.config.inject.interfaces) {
			types.push(...this.extractInterfaces(sourceFile));
		}

		if (this.config.inject.enums) {
			types.push(...this.extractEnums(sourceFile));
		}

		if (this.config.inject.classes) {
			types.push(...this.extractClasses(sourceFile));
		}

		if (this.config.inject.constants) {
			types.push(...this.extractConstants(sourceFile));
		}

		return types;
	}

	/**
	 * Extract function signatures
	 */
	private extractFunctions(sourceFile: SourceFile): ExtractedType[] {
		const functions = sourceFile.getFunctions();
		const extracted: ExtractedType[] = [];

		for (const func of functions) {
			const name = func.getName();
			if (!name) continue;

			const exported = func.isExported();

			// Get parameters with types
			const params = func
				.getParameters()
				.map((p) => {
					const paramName = p.getName();
					const paramType = p.getType().getText(p);
					const isOptional = p.isOptional();
					const hasInitializer = p.hasInitializer();

					return `${paramName}${isOptional || hasInitializer ? "?" : ""}: ${paramType}`;
				})
				.join(", ");

			// Get return type
			const returnType = func.getReturnType().getText(func);

			// Get type parameters (generics)
			const typeParams = func.getTypeParameters();
			const typeParamsText =
				typeParams.length > 0
					? `<${typeParams.map((tp) => tp.getText()).join(", ")}>`
					: "";

			const signature = `function ${name}${typeParamsText}(${params}): ${returnType}`;

			// Get JSDoc if enabled
			let jsdoc: string[] | undefined;
			if (this.config.includeJSDoc) {
				jsdoc = func
					.getJsDocs()
					.map((doc) => doc.getDescription().trim())
					.filter(Boolean);
			}

			// ts-morph uses 1-based line numbers, read tool uses 0-based offset
			const lineStart = func.getStartLineNumber() - 1;
			const lineEnd = func.getEndLineNumber() - 1;

			extracted.push({
				kind: "function",
				name,
				signature,
				jsdoc,
				exported,
				lineStart,
				lineEnd,
			});
		}

		return extracted;
	}

	/**
	 * Extract type aliases
	 */
	private extractTypeAliases(sourceFile: SourceFile): ExtractedType[] {
		const typeAliases = sourceFile.getTypeAliases();
		const extracted: ExtractedType[] = [];

		for (const typeAlias of typeAliases) {
			const name = typeAlias.getName();
			const exported = typeAlias.isExported();

			// Get type parameters (generics)
			const typeParams = typeAlias.getTypeParameters();
			const typeParamsText =
				typeParams.length > 0
					? `<${typeParams.map((tp) => tp.getText()).join(", ")}>`
					: "";

			const typeText = typeAlias.getType().getText(typeAlias);
			const signature = `type ${name}${typeParamsText} = ${typeText}`;

			// Get JSDoc if enabled
			let jsdoc: string[] | undefined;
			if (this.config.includeJSDoc) {
				jsdoc = typeAlias
					.getJsDocs()
					.map((doc) => doc.getDescription().trim())
					.filter(Boolean);
			}

			const lineStart = typeAlias.getStartLineNumber() - 1;
			const lineEnd = typeAlias.getEndLineNumber() - 1;

			extracted.push({
				kind: "type",
				name,
				signature,
				jsdoc,
				exported,
				lineStart,
				lineEnd,
			});
		}

		return extracted;
	}

	/**
	 * Extract interfaces
	 */
	private extractInterfaces(sourceFile: SourceFile): ExtractedType[] {
		const interfaces = sourceFile.getInterfaces();
		const extracted: ExtractedType[] = [];

		for (const iface of interfaces) {
			const name = iface.getName();
			const exported = iface.isExported();

			// Get type parameters (generics)
			const typeParams = iface.getTypeParameters();
			const typeParamsText =
				typeParams.length > 0
					? `<${typeParams.map((tp) => tp.getText()).join(", ")}>`
					: "";

			// Get extends clause
			const extendsTypes = iface.getExtends();
			const extendsText =
				extendsTypes.length > 0
					? ` extends ${extendsTypes.map((e) => e.getText()).join(", ")}`
					: "";

			// Get properties
			const properties = iface.getProperties().map((prop) => {
				const propName = prop.getName();
				const propType = prop.getType().getText(prop);
				const isOptional = prop.hasQuestionToken();
				const readonly = prop.isReadonly() ? "readonly " : "";

				return `  ${readonly}${propName}${isOptional ? "?" : ""}: ${propType};`;
			});

			// Get methods
			const methods = iface.getMethods().map((method) => {
				const methodName = method.getName();
				const typeParams = method.getTypeParameters();
				const typeParamsText =
					typeParams.length > 0
						? `<${typeParams.map((tp) => tp.getText()).join(", ")}>`
						: "";

				const params = method
					.getParameters()
					.map((p) => {
						const paramName = p.getName();
						const paramType = p.getType().getText(p);
						const isOptional = p.isOptional();
						return `${paramName}${isOptional ? "?" : ""}: ${paramType}`;
					})
					.join(", ");

				const returnType = method.getReturnType().getText(method);
				return `  ${methodName}${typeParamsText}(${params}): ${returnType};`;
			});

			const members = [...properties, ...methods].join("\n");
			const signature = `interface ${name}${typeParamsText}${extendsText} {\n${members}\n}`;

			// Get JSDoc if enabled
			let jsdoc: string[] | undefined;
			if (this.config.includeJSDoc) {
				jsdoc = iface
					.getJsDocs()
					.map((doc) => doc.getDescription().trim())
					.filter(Boolean);
			}

			const lineStart = iface.getStartLineNumber() - 1;
			const lineEnd = iface.getEndLineNumber() - 1;

			extracted.push({
				kind: "interface",
				name,
				signature,
				jsdoc,
				exported,
				lineStart,
				lineEnd,
			});
		}

		return extracted;
	}

	/**
	 * Extract enums
	 */
	private extractEnums(sourceFile: SourceFile): ExtractedType[] {
		const enums = sourceFile.getEnums();
		const extracted: ExtractedType[] = [];

		for (const enumDecl of enums) {
			const name = enumDecl.getName();
			const exported = enumDecl.isExported();
			const isConst = enumDecl.isConstEnum();

			// Get enum members
			const members = enumDecl
				.getMembers()
				.map((member) => {
					const memberName = member.getName();
					const value = member.getValue();

					if (value !== undefined) {
						const valueStr = typeof value === "string" ? `"${value}"` : value;
						return `  ${memberName} = ${valueStr},`;
					}

					return `  ${memberName},`;
				})
				.join("\n");

			const signature = `${isConst ? "const " : ""}enum ${name} {\n${members}\n}`;

			// Get JSDoc if enabled
			let jsdoc: string[] | undefined;
			if (this.config.includeJSDoc) {
				jsdoc = enumDecl
					.getJsDocs()
					.map((doc) => doc.getDescription().trim())
					.filter(Boolean);
			}

			const lineStart = enumDecl.getStartLineNumber() - 1;
			const lineEnd = enumDecl.getEndLineNumber() - 1;

			extracted.push({
				kind: "enum",
				name,
				signature,
				jsdoc,
				exported,
				lineStart,
				lineEnd,
			});
		}

		return extracted;
	}

	/**
	 * Extract class declarations (public members only)
	 */
	private extractClasses(sourceFile: SourceFile): ExtractedType[] {
		const classes = sourceFile.getClasses();
		const extracted: ExtractedType[] = [];

		for (const classDecl of classes) {
			const name = classDecl.getName();
			if (!name) continue;

			const exported = classDecl.isExported();
			const isAbstract = classDecl.isAbstract();

			// Get type parameters (generics)
			const typeParams = classDecl.getTypeParameters();
			const typeParamsText =
				typeParams.length > 0
					? `<${typeParams.map((tp) => tp.getText()).join(", ")}>`
					: "";

			// Get extends clause
			const extendsClause = classDecl.getExtends();
			const extendsText = extendsClause
				? ` extends ${extendsClause.getText()}`
				: "";

			// Get implements clause
			const implementsClause = classDecl.getImplements();
			const implementsText =
				implementsClause.length > 0
					? ` implements ${implementsClause.map((i) => i.getText()).join(", ")}`
					: "";

			// Get public properties
			const properties = classDecl
				.getProperties()
				.filter((prop) => !prop.hasModifier(SyntaxKind.PrivateKeyword))
				.map((prop) => {
					const propName = prop.getName();
					const propType = prop.getType().getText(prop);
					const isOptional = prop.hasQuestionToken();
					const readonly = prop.isReadonly() ? "readonly " : "";
					const isStatic = prop.isStatic() ? "static " : "";

					return `  ${isStatic}${readonly}${propName}${isOptional ? "?" : ""}: ${propType};`;
				});

			// Get public methods (signatures only)
			const methods = classDecl
				.getMethods()
				.filter((method) => !method.hasModifier(SyntaxKind.PrivateKeyword))
				.map((method) => {
					const methodName = method.getName();
					const isStatic = method.isStatic() ? "static " : "";
					const isAbstract = method.isAbstract() ? "abstract " : "";

					const params = method
						.getParameters()
						.map((p) => {
							const paramName = p.getName();
							const paramType = p.getType().getText(p);
							const isOptional = p.isOptional();

							return `${paramName}${isOptional ? "?" : ""}: ${paramType}`;
						})
						.join(", ");

					const returnType = method.getReturnType().getText(method);

					return `  ${isStatic}${isAbstract}${methodName}(${params}): ${returnType};`;
				});

			const members = [...properties, ...methods].join("\n");
			const signature = `${isAbstract ? "abstract " : ""}class ${name}${typeParamsText}${extendsText}${implementsText} {\n${members}\n}`;

			// Get JSDoc if enabled
			let jsdoc: string[] | undefined;
			if (this.config.includeJSDoc) {
				jsdoc = classDecl
					.getJsDocs()
					.map((doc) => doc.getDescription().trim())
					.filter(Boolean);
			}

			const lineStart = classDecl.getStartLineNumber() - 1;
			const lineEnd = classDecl.getEndLineNumber() - 1;

			extracted.push({
				kind: "class",
				name,
				signature,
				jsdoc,
				exported,
				lineStart,
				lineEnd,
			});
		}

		return extracted;
	}

	/**
	 * Extract const objects (with as const or Object.freeze)
	 */
	private extractConstants(sourceFile: SourceFile): ExtractedType[] {
		const variables = sourceFile.getVariableDeclarations();
		const extracted: ExtractedType[] = [];

		for (const variable of variables) {
			// Only extract const declarations
			const varStatement = variable.getVariableStatement();
			if (
				!varStatement ||
				varStatement.getDeclarationKind() !== VariableDeclarationKind.Const
			)
				continue;

			const name = variable.getName();
			const exported = variable.getVariableStatement()?.isExported() ?? false;

			// Check if it has "as const" assertion or is frozen
			const initializer = variable.getInitializer();
			if (!initializer) continue;

			const hasAsConst = initializer.getType().getText().includes("readonly");
			const text = initializer.getText();
			const isFrozen = text.includes("Object.freeze");

			// Only include if it's a const assertion or frozen object
			if (!hasAsConst && !isFrozen) continue;

			// Get the type
			const type = variable.getType().getText(variable);

			// For simple values, show the actual value
			let signature: string;
			if (text.length < 200 && (text.startsWith("{") || text.startsWith("["))) {
				signature = `const ${name}: ${type} = ${text}`;
			} else {
				signature = `const ${name}: ${type}`;
			}

			// Get JSDoc if enabled
			let jsdoc: string[] | undefined;
			if (this.config.includeJSDoc) {
				const varStatement = variable.getVariableStatement();
				if (varStatement) {
					jsdoc = varStatement
						.getJsDocs()
						.map((doc) => doc.getDescription().trim())
						.filter(Boolean);
				}
			}

			const lineStart = variable.getStartLineNumber() - 1;
			const lineEnd = variable.getEndLineNumber() - 1;

			extracted.push({
				kind: "const",
				name,
				signature,
				jsdoc,
				exported,
				lineStart,
				lineEnd,
			});
		}

		return extracted;
	}

	/**
	 * Extract explicitly typed arrow functions
	 * Only includes arrow functions with explicit type annotations
	 */
	private extractArrowFunctions(sourceFile: SourceFile): ExtractedType[] {
		const variables = sourceFile.getVariableDeclarations();
		const extracted: ExtractedType[] = [];

		for (const variable of variables) {
			// Only extract const declarations
			const varStatement = variable.getVariableStatement();
			if (
				!varStatement ||
				varStatement.getDeclarationKind() !== VariableDeclarationKind.Const
			)
				continue;

			const initializer = variable.getInitializer();
			if (!initializer) continue;

			// Check if it's an arrow function or function expression
			const kind = initializer.getKind();
			const isArrowFunc = kind === SyntaxKind.ArrowFunction;
			const isFuncExpr = kind === SyntaxKind.FunctionExpression;
			if (!isArrowFunc && !isFuncExpr) continue;

			// Only include if it has an explicit type annotation
			const typeNode = variable.getTypeNode();
			if (!typeNode) continue;

			const name = variable.getName();
			const exported = varStatement.isExported();
			const explicitType = typeNode.getText();
			const signature = `const ${name}: ${explicitType}`;

			// Get JSDoc if enabled
			let jsdoc: string[] | undefined;
			if (this.config.includeJSDoc) {
				jsdoc = varStatement
					.getJsDocs()
					.map((doc) => doc.getDescription().trim())
					.filter(Boolean);
			}

			const lineStart = variable.getStartLineNumber() - 1;
			const lineEnd = variable.getEndLineNumber() - 1;

			extracted.push({
				kind: "function",
				name,
				signature,
				jsdoc,
				exported,
				lineStart,
				lineEnd,
			});
		}

		return extracted;
	}

	private resolveImports(
		sourceFile: SourceFile,
		depth: number,
		processedFiles: Set<string>,
	): ExtractedType[] {
		if (depth >= this.config.imports.maxDepth) {
			return [];
		}

		const imported: ExtractedType[] = [];
		const imports = sourceFile.getImportDeclarations();

		for (const importDecl of imports) {
			const moduleSpecifier = importDecl.getModuleSpecifierValue();

			// Skip node_modules imports (only process relative imports)
			if (!moduleSpecifier.startsWith(".")) {
				continue;
			}

			// Skip type-only imports if disabled
			if (importDecl.isTypeOnly() && !this.config.imports.includeTypeOnly) {
				continue;
			}

			try {
				// Resolve the module path
				const moduleSourceFile = importDecl.getModuleSpecifierSourceFile();

				// Extract named imports to know which types to get
				const namedImports = importDecl.getNamedImports();
				const importedNames = new Set(namedImports.map((ni) => ni.getName()));

				// Handle .svelte imports manually (ts-morph can't resolve them)
				if (!moduleSourceFile && moduleSpecifier.endsWith(".svelte")) {
					const currentDir = path.dirname(sourceFile.getFilePath());
					const svelteImportPath = path.resolve(currentDir, moduleSpecifier);

					if (processedFiles.has(svelteImportPath)) continue;
					processedFiles.add(svelteImportPath);

					if (this.config.debug) {
						console.log(
							`[TypeInject] Resolving Svelte import: ${moduleSpecifier} -> ${svelteImportPath}`,
						);
					}

					// Extract from Svelte file
					const svelteResults = this.getSvelteScripts(svelteImportPath);
					for (const {
						sourceFile: svelteSource,
						lineOffset,
					} of svelteResults) {
						const svelteTypes = this.extractTypesFromFile(
							svelteSource,
							importedNames,
						);

						const relativePath = `./${path.relative(this.directory, svelteImportPath)}`;
						for (const type of svelteTypes) {
							if (type.lineStart !== undefined) type.lineStart += lineOffset;
							if (type.lineEnd !== undefined) type.lineEnd += lineOffset;
							type.sourcePath = relativePath;
							type.importDepth = depth + 1;
							imported.push(type);
						}

						// Recursively resolve imports from this Svelte file
						if (depth + 1 < this.config.imports.maxDepth) {
							const nestedImports = this.resolveImports(
								svelteSource,
								depth + 1,
								processedFiles,
							);
							imported.push(...nestedImports);
						}
					}
					continue;
				}

				if (!moduleSourceFile) continue;

				const importPath = moduleSourceFile.getFilePath();

				// Avoid circular imports
				if (processedFiles.has(importPath)) {
					continue;
				}
				processedFiles.add(importPath);

				if (this.config.debug) {
					console.log(
						`[TypeInject] Resolving import: ${moduleSpecifier} -> ${importPath}`,
					);
				}

				// Extract types from the imported file
				const importedTypes = this.extractTypesFromFile(
					moduleSourceFile,
					importedNames,
				);

				// Mark these as coming from an import with depth and resolved path
				const relativePath = `./${path.relative(this.directory, importPath)}`;
				for (const type of importedTypes) {
					type.sourcePath = relativePath;
					type.importDepth = depth + 1;
					imported.push(type);
				}

				// Recursively resolve imports from this file
				if (depth + 1 < this.config.imports.maxDepth) {
					const nestedImports = this.resolveImports(
						moduleSourceFile,
						depth + 1,
						processedFiles,
					);
					imported.push(...nestedImports);
				}
			} catch (error) {
				if (this.config.debug) {
					console.error(
						`[TypeInject] Error resolving import ${moduleSpecifier}:`,
						error,
					);
				}
			}
		}

		return imported;
	}

	private extractTypesFromFile(
		sourceFile: SourceFile,
		names: Set<string>,
	): ExtractedType[] {
		const types: ExtractedType[] = [];

		// If no specific names requested, extract all
		const filterByName = names.size > 0;

		// Extract each type category, filtering by name if needed
		if (this.config.inject.functions) {
			const functions = this.extractFunctions(sourceFile);
			types.push(
				...functions.filter((t) => !filterByName || names.has(t.name)),
			);
			const arrowFunctions = this.extractArrowFunctions(sourceFile);
			types.push(
				...arrowFunctions.filter((t) => !filterByName || names.has(t.name)),
			);
		}

		if (this.config.inject.types) {
			const typeAliases = this.extractTypeAliases(sourceFile);
			types.push(
				...typeAliases.filter((t) => !filterByName || names.has(t.name)),
			);
		}

		if (this.config.inject.interfaces) {
			const interfaces = this.extractInterfaces(sourceFile);
			types.push(
				...interfaces.filter((t) => !filterByName || names.has(t.name)),
			);
		}

		if (this.config.inject.enums) {
			const enums = this.extractEnums(sourceFile);
			types.push(...enums.filter((t) => !filterByName || names.has(t.name)));
		}

		if (this.config.inject.classes) {
			const classes = this.extractClasses(sourceFile);
			types.push(...classes.filter((t) => !filterByName || names.has(t.name)));
		}

		if (this.config.inject.constants) {
			const constants = this.extractConstants(sourceFile);
			types.push(
				...constants.filter((t) => !filterByName || names.has(t.name)),
			);
		}

		return types;
	}

	private filterUsedTypes(
		sourceFile: SourceFile,
		types: ExtractedType[],
	): ExtractedType[] {
		// Build a map of type names for quick lookup
		const typeMap = new Map<string, ExtractedType>();
		for (const type of types) {
			typeMap.set(type.name, type);
		}

		// Get all identifiers used in the file
		const usedNames = new Set<string>();
		sourceFile.forEachDescendant((node) => {
			// Check for identifier references
			if (node.getKind() === SyntaxKind.Identifier) {
				const name = node.getText();
				usedNames.add(name);
			}
		});

		// Find types that are referenced
		const usedTypes: ExtractedType[] = [];
		const transitiveTypes = new Set<string>();

		for (const type of types) {
			if (usedNames.has(type.name)) {
				usedTypes.push(type);
				type.isUsed = true;

				// If configured, find transitive dependencies
				if (this.config.filtering.includeTransitive) {
					this.findTransitiveDependencies(type, typeMap, transitiveTypes);
				}
			}
		}

		// Add transitive dependencies
		if (this.config.filtering.includeTransitive) {
			for (const typeName of transitiveTypes) {
				const type = typeMap.get(typeName);
				if (type && !usedTypes.includes(type)) {
					usedTypes.push(type);
				}
			}
		}

		if (this.config.debug) {
			console.log(
				`[TypeInject] Filtered ${types.length} -> ${usedTypes.length} used types`,
			);
		}

		return usedTypes;
	}

	private findTransitiveDependencies(
		type: ExtractedType,
		typeMap: Map<string, ExtractedType>,
		found: Set<string>,
	): void {
		// Parse the signature to find referenced type names
		const signature = type.signature;

		// Match type names (simplified - could be more sophisticated)
		// Look for type references in the signature
		for (const [typeName] of typeMap) {
			// Skip if already found
			if (found.has(typeName)) continue;

			// Check if this type name appears in the signature
			// Use word boundaries to avoid partial matches
			const regex = new RegExp(`\\b${typeName}\\b`);
			if (regex.test(signature)) {
				found.add(typeName);

				// Recursively find dependencies of this type
				const dependentType = typeMap.get(typeName);
				if (dependentType) {
					this.findTransitiveDependencies(dependentType, typeMap, found);
				}
			}
		}
	}

	/**
	 * Extract TypeScript script content from a Svelte file
	 * Delegates to shared utility
	 */
	private getSvelteScripts(filePath: string): Array<{
		sourceFile: SourceFile;
		lineOffset: number;
		isModule: boolean;
	}> {
		return extractSvelteScripts(
			filePath,
			this.project,
			this.svelteParser,
			this.config.debug,
		);
	}

	private filterTypesForLineRange(
		sourceFile: SourceFile,
		types: ExtractedType[],
		lineRange: { offset: number; limit: number },
	): ExtractedType[] {
		// Build a map of type names for quick lookup
		const typeMap = new Map<string, ExtractedType>();
		for (const type of types) {
			typeMap.set(type.name, type);
		}

		// Get the content for the specific line range
		const lines = sourceFile.getFullText().split("\n");
		const startLine = lineRange.offset;
		const endLine = startLine + lineRange.limit;
		const rangeContent = lines.slice(startLine, endLine).join("\n");

		if (this.config.debug) {
			console.log(
				`[TypeInject] Filtering types for lines ${startLine}-${endLine} (${rangeContent.length} chars)`,
			);
		}

		// Find types that are referenced in this range
		const usedNames = new Set<string>();

		// Match PascalCase identifiers (types/interfaces)
		const identifierRegex = /\b[A-Z][a-zA-Z0-9_]*\b/g;
		const pascalMatches = rangeContent.matchAll(identifierRegex);
		for (const match of pascalMatches) {
			const name = match[0];
			if (typeMap.has(name)) {
				usedNames.add(name);
			}
		}

		// Also look for function calls and variable references
		const allIdentifierRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
		const allMatches = rangeContent.matchAll(allIdentifierRegex);
		for (const match of allMatches) {
			const name = match[0];
			if (typeMap.has(name)) {
				usedNames.add(name);
			}
		}

		// Build result set
		const usedTypes: ExtractedType[] = [];
		const transitiveTypes = new Set<string>();

		for (const type of types) {
			if (usedNames.has(type.name)) {
				usedTypes.push(type);
				type.isUsed = true;

				// If configured, find transitive dependencies
				if (this.config.filtering.includeTransitive) {
					this.findTransitiveDependencies(type, typeMap, transitiveTypes);
				}
			}
		}

		// Add transitive dependencies
		if (this.config.filtering.includeTransitive) {
			for (const typeName of transitiveTypes) {
				const type = typeMap.get(typeName);
				if (type && !usedTypes.includes(type)) {
					usedTypes.push(type);
				}
			}
		}

		if (this.config.debug) {
			console.log(
				`[TypeInject] Line range ${startLine}-${endLine}: Found ${usedNames.size} directly used types, ${usedTypes.length} total types (with transitive)`,
			);
		}

		return usedTypes;
	}
}
