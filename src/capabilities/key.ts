const CAPABILITY_KEY = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export type AthenaCapabilityKey = string & {
  readonly __athenaCapabilityKey: unique symbol;
};

export function parseAthenaCapabilityKey(value: string): AthenaCapabilityKey {
  if (typeof value !== "string" || !CAPABILITY_KEY.test(value)) {
    throw new TypeError(`Invalid Athena capability key: ${String(value)}`);
  }
  return value as AthenaCapabilityKey;
}

export function tryParseAthenaCapabilityKey(
  value: unknown
): AthenaCapabilityKey | undefined {
  if (typeof value !== "string" || !CAPABILITY_KEY.test(value)) {
    return;
  }
  return value as AthenaCapabilityKey;
}

export function athenaCapabilityKeyString(
  value: AthenaCapabilityKey
): string {
  return value;
}
