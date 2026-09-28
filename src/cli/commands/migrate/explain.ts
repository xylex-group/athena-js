import { defineMigrateCommand } from "./define.ts";

export const migrateExplainCommand = defineMigrateCommand({
  mode: "explain",
  path: ["migrate", "explain"],
});
