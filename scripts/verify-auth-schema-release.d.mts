export function readPackageVersion(root?: string): string;
export function readAuthSchemaGeneration(root?: string): number;
export function fingerprintCanonicalAuthMigrations(root?: string): string;
export function computeAuthSchemaReleaseState(root?: string): {
  packageVersion: string;
  authSchemaGeneration: number;
  canonicalMigrationFingerprint: string;
};
export function verifyAuthMigrationHistory(options?: { baseRef?: string }): void;
