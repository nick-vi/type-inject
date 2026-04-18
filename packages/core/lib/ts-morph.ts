import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsMorph = require("ts-morph") as typeof import("ts-morph");

export const { Project, SyntaxKind, VariableDeclarationKind, ts } = tsMorph;

export type {
	DiagnosticCategory,
	DiagnosticMessageChain,
	Project as TsMorphProject,
	SourceFile,
} from "ts-morph";
