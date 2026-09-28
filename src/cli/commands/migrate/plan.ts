import { defineMigrateCommand } from "./define.ts";

export const migratePlanCommand = defineMigrateCommand({
  mode: "plan",
  path: ["migrate", "plan"],
});
