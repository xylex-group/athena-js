import { defineMigrateCommand } from "./define.ts";

export const migrateDriftCommand = defineMigrateCommand({
	path: ["migrate", "drift"],
	mode: "drift",
});
