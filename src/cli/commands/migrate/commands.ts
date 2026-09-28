import { migrateApplyCommand } from "./apply.ts";
import { migrateAuthSyncCommand } from "./auth-sync.ts";
import { migrateCheckCommand } from "./check.ts";
import { migrateDriftCommand } from "./drift.ts";
import { migrateExplainCommand } from "./explain.ts";
import { migrateGraphCommand } from "./graph.ts";
import { migratePlanCommand } from "./plan.ts";
import { migrateReconcileCommand } from "./reconcile.ts";
import { migrateRepairCommand } from "./repair.ts";
import { migrateStatusCommand } from "./status.ts";
import { migrateVerifyCommand } from "./verify.ts";

export const migrateCommands = [
  migrateAuthSyncCommand,
  migrateStatusCommand,
  migratePlanCommand,
  migrateCheckCommand,
  migrateGraphCommand,
  migrateExplainCommand,
  migrateDriftCommand,
  migrateReconcileCommand,
  migrateRepairCommand,
  migrateVerifyCommand,
  migrateApplyCommand,
] as const;
