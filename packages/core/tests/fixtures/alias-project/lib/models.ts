export interface Task {
	id: string;
	status: TaskStatus;
}

export type TaskStatus = "open" | "in_progress" | "done";
