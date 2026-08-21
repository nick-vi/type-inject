export type BuildStatus = "idle" | "building" | "done";

export interface BuildInfo {
	status: BuildStatus;
	target: string;
}

export function formatBuildStatus(info: BuildInfo): string {
	return `${info.target}: ${info.status}`;
}
