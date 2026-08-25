import { defineMigrateCommand } from "./define.ts";

export const migrateGraphCommand = defineMigrateCommand({
	path: ["migrate", "graph"],
	mode: "graph",
});
