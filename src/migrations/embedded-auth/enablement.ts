export type AthenaAuthMigrationModules = {
  auth?: boolean;
  billing?: boolean;
  chat?: boolean;
  eventIngress?: boolean;
};

/**
 * Embedded Auth applies when `modules` is omitted (legacy) or `modules.auth === true`.
 */
export function shouldApplyEmbeddedAuthMigrations(
  modules: AthenaAuthMigrationModules | undefined
): boolean {
  if (modules == null) {
    return true;
  }
  return modules.auth === true;
}
