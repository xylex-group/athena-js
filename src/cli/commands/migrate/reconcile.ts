import { defineMigrateCommand } from "./define.ts";

export const migrateReconcileCommand = defineMigrateCommand({
  mode: "reconcile",
  path: ["migrate", "reconcile"],
});
