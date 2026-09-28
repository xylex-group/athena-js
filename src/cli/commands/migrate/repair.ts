import { defineMigrateCommand } from "./define.ts";

export const migrateRepairCommand = defineMigrateCommand({
  mode: "repair",
  path: ["migrate", "repair"],
});
