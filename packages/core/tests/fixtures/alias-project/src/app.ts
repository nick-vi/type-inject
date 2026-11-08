import type { Task, TaskStatus } from "@/lib/models";

// Arrow function with an explicit return type annotation but no variable
// type annotation - should now be extracted via the return type fallback
export const makeTask = (id: string): Task => ({
	id,
	status: "open",
});

// Typed const referencing an imported type
export const defaultStatus: TaskStatus = "open";
