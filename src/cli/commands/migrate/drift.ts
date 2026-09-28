import { defineMigrateCommand } from "./define.ts";

export const migrateDriftCommand = defineMigrateCommand({
  mode: "drift",
  path: ["migrate", "drift"],
});
