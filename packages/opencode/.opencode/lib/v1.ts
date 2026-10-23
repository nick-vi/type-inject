import type {
	Plugin,
	ToolDefinition,
	tool as toolFn,
} from "@opencode-ai/plugin";
import { type ArgSpec, createTypeInject } from "./core.ts";

type Zod = typeof toolFn.schema;

function toZod(z: Zod, spec: ArgSpec) {
	const base =
		spec.type === "string[]"
			? z.array(spec.enum ? z.enum(spec.enum) : z.string())
			: spec.enum
				? z.enum(spec.enum)
				: z[spec.type]();
	return (spec.optional ? base.optional() : base).describe(spec.description);
}

/** opencode v1 server plugin. */
export const server: Plugin = async ({ directory }) => {
	const typeInject = createTypeInject(directory);
	if (!typeInject) {
		return {};
	}

	// Loaded lazily so the v2 path never needs the v1 plugin package installed.
	const { tool } = await import("@opencode-ai/plugin");

	const tools: Record<string, ToolDefinition> = {};
	for (const def of typeInject.tools) {
		tools[def.name] = tool({
			description: def.description,
			args: Object.fromEntries(
				Object.entries(def.args).map(([key, spec]) => [
					key,
					toZod(tool.schema, spec),
				]),
			),
			async execute(args) {
				return def.execute(args);
			},
		});
	}

	const currentReads = new Map<
		string,
		{ filePath: string; offset?: number; limit?: number }
	>();

	return {
		tool: tools,

		"tool.execute.before": async (input, output) => {
			if (input.tool === "read" && output.args?.filePath) {
				currentReads.set(input.callID, {
					filePath: output.args.filePath as string,
					offset: output.args.offset as number | undefined,
					limit: output.args.limit as number | undefined,
				});
			}
		},

		"tool.execute.after": async (input, output) => {
			if (input.tool !== "read") {
				return;
			}

			const readContext = currentReads.get(input.callID);
			currentReads.delete(input.callID);
			if (!readContext) {
				return;
			}

			const { filePath, offset, limit } = readContext;
			const injected = typeInject.inject({
				filePath,
				rawContent: output.output,
				displayContent: output.output,
				// The read tool's offset is 1-based; the extractor expects 0-based
				lineRange:
					offset !== undefined && limit !== undefined
						? { offset: Math.max(offset, 1) - 1, limit }
						: undefined,
			});

			if (injected !== undefined) {
				output.output = injected;
			}
		},
	};
};
