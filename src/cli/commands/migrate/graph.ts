import { defineMigrateCommand } from "./define.ts";

export const migrateGraphCommand = defineMigrateCommand({
  mode: "graph",
  path: ["migrate", "graph"],
});
