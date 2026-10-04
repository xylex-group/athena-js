export function assertAuthMigrationManifestAppendOnly(
  baselineManifest: Record<string, string>,
  candidateManifest: Record<string, string>,
  options?: { packageVersion?: string }
): boolean;
export function verifyAuthMigrationHistory(options?: {
  baseRef?: string;
}): void;
