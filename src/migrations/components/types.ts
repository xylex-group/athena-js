/**
 * Tooling protocol for first-class migration components.
 * Auth apply still uses `migrateAthenaAuthSchema`; packaged SQL modules use
 * `applyEmbeddedSqlMigrations`. Do not import this from browser graphs.
 */

export type EmbeddedMigrationComponentId =
  | "auth"
  | "chat"
  | "event_ingress"
  | "billing";

export type MigrationComponentState =
  | "current"
  | "pending"
  | "legacy-compatible"
  | "mismatch"
  | "disabled";

export interface EmbeddedMigrationLegacyIdentity {
  readonly acceptedChecksums?: readonly string[];
}

export interface EmbeddedMigrationComponent {
  enabled(modules: unknown): boolean;
  readonly id: EmbeddedMigrationComponentId;
  readonly requires?: readonly EmbeddedMigrationComponentId[];
}
