import { defineMigrateCommand } from "./define.ts";

export const migrateExplainCommand = defineMigrateCommand({
	path: ["migrate", "explain"],
	mode: "explain",
});
