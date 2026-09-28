export const ATHENA_TRANSPORT_DOMAINS = [
  "data",
  "auth",
  "storage",
  "billing",
] as const;

export type AthenaTransportDomain = (typeof ATHENA_TRANSPORT_DOMAINS)[number];
