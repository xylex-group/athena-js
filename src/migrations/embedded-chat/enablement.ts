export type AthenaChatMigrationModules = {
  auth?: boolean;
  chat?: boolean;
};

export function shouldApplyEmbeddedChatMigrations(
  modules: AthenaChatMigrationModules | undefined
): boolean {
  return modules?.chat === true;
}
