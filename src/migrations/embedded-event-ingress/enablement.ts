export type AthenaEventIngressMigrationModules = {
  auth?: boolean;
  billing?: boolean;
  chat?: boolean;
  eventIngress?: boolean;
};

export function shouldApplyEmbeddedEventIngressMigrations(
  modules: AthenaEventIngressMigrationModules | undefined
): boolean {
  return modules?.eventIngress === true || modules?.billing === true;
}

export function shouldApplyEmbeddedBillingMigrations(
  modules: AthenaEventIngressMigrationModules | undefined
): boolean {
  return modules?.billing === true;
}
