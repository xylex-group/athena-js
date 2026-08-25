import { defineMigrateCommand } from "./define.ts";

export const migratePlanCommand = defineMigrateCommand({
	path: ["migrate", "plan"],
	mode: "plan",
});
