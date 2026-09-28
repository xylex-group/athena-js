import {
  fingerprintAthenaCapabilitiesIr,
  type AthenaCapabilitiesIr,
} from "../../capabilities/index.ts";
import type { AthenaDevtoolsCapabilitiesInspector } from "../protocol/capabilities.ts";

export function projectAthenaCapabilitiesToDevtools(
  ir: AthenaCapabilitiesIr
): AthenaDevtoolsCapabilitiesInspector {
  const summary = {
    available: 0,
    unavailable: 0,
    degraded: 0,
    unknown: 0,
  };
  const entries = ir.capabilities.map((entry) => {
    summary[entry.status] += 1;
    return {
      key: entry.key,
      domain: entry.domain,
      kind: entry.kind,
      implementation: entry.implementation,
      status: entry.status,
      maturity: entry.maturity,
      reason: entry.reason?.code ?? null,
      sources: entry.sources.map((source) => ({
        kind: source.kind,
        source: source.source,
      })),
    };
  });
  return {
    fingerprint: fingerprintAthenaCapabilitiesIr(ir),
    irVersion: ir.irVersion,
    entries,
    summary,
  };
}
