import { defineMigrateCommand } from "./define.ts";

export const migrateCheckCommand = defineMigrateCommand({
  mode: "check",
  path: ["migrate", "check"],
});
