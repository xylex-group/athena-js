import { defineMigrateCommand } from "./define.ts";

export const migrateStatusCommand = defineMigrateCommand({
  mode: "status",
  path: ["migrate", "status"],
});
