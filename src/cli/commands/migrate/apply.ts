import { defineMigrateCommand } from "./define.ts";

export const migrateApplyCommand = defineMigrateCommand({
  mode: "apply",
  path: ["migrate"],
});
