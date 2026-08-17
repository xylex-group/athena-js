/** Discovery/runtime protocol. Distinct from package semver. */
export const ATHENA_RUNTIME_PROTOCOL = {
  major: 1,
  minor: 0,
} as const;

/** Client accepts the same major and runtime minor >= this value. */
export const ATHENA_RUNTIME_PROTOCOL_MIN_MINOR = 0;

export function isCompatibleAthenaRuntimeProtocol(input: {
  major: number;
  minor: number;
}): boolean {
  return (
    input.major === ATHENA_RUNTIME_PROTOCOL.major &&
    input.minor >= ATHENA_RUNTIME_PROTOCOL_MIN_MINOR
  );
}
