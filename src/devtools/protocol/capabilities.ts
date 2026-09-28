export interface AthenaDevtoolsCapabilitySource {
  kind: string;
  source: string;
}

export interface AthenaDevtoolsCapabilityEntry {
  key: string;
  domain: string;
  kind: string;
  implementation: string;
  status: string;
  maturity: string;
  reason: string | null;
  sources: readonly AthenaDevtoolsCapabilitySource[];
}

export interface AthenaDevtoolsCapabilitiesInspector {
  fingerprint: string;
  irVersion: number;
  entries: readonly AthenaDevtoolsCapabilityEntry[];
  summary: {
    available: number;
    unavailable: number;
    degraded: number;
    unknown: number;
  };
}
