/**
 * SUPERSEDED by test/sdd/athena-js-transport-ir.target.test.ts
 *
 * Former Phase 0 characterization: no src/runtime/transport/**, Next protocol 1.1
 * Auth+Data only, GET-probe guessed Storage/Billing paths, billing throw new Error.
 * Target suite is the CI source of truth. Do not invert titles in place.
 */
/**
 * Baseline: Athena JS Transport IR found cases at Phase 0 pin.
 * Characterization of HEAD before Transport IR. Retired to superseded
 * after Phase 10 GREEN.
 * See docs/sdd/xylex/athena-js-transport-ir/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

test("B-TIR-NO-DIR: src/runtime/transport does not exist at characterization pin", () => {
  assert.equal(
    existsSync(join(srcRoot, "runtime", "transport")),
    false,
    "characterization: transport IR directory is absent"
  );
});

test("B-TIR-TOPOLOGY-AD: ResolvedNextAthenaTopology is auth + data + protocol", () => {
  const source = readSrc("next/topology.ts");
  assert.match(source, /export type ResolvedNextAthenaTopology/);
  assert.match(source, /auth\?: \{ path: string; transport:/);
  assert.match(source, /data\?: \{ path: string \}/);
  assert.doesNotMatch(
    source,
    /storage\?: \{ path:/,
    "characterization: topology type has no storage path"
  );
  assert.doesNotMatch(
    source,
    /billing\?: \{ path:/,
    "characterization: topology type has no billing path"
  );
});

test("B-TIR-DISCOVERY-ENDPOINTS: discovery has endpoints, not transports", () => {
  const source = readSrc("gateway/discovery-types.ts");
  assert.match(source, /export interface AthenaRuntimeDiscoveryEndpoints/);
  assert.doesNotMatch(source, /transports\?:/);
});

test("B-TIR-PROTOCOL-11: Next protocol is 1.1 Auth + Data", () => {
  const source = readSrc("gateway/protocol.ts");
  assert.match(source, /ATHENA_NEXT_RUNTIME_PROTOCOL/);
  assert.match(source, /minor:\s*1/);
  assert.match(source, /Auth \+ Data/);
});

test("B-TIR-STORAGE-STACK: storage browser-transport owns parse/join/GET/fetch", () => {
  const source = readSrc("storage/runtime/browser-transport.ts");
  assert.match(source, /function joinPath\(/);
  assert.match(source, /function parseEndpoint\(/);
  assert.match(source, /method:\s*"GET"/);
  assert.match(source, /fetchImpl/);
});

test("B-TIR-BILLING-STACK: billing browser-transport owns parse/join/GET/fetch", () => {
  const source = readSrc("billing/runtime/browser-transport.ts");
  assert.match(source, /function joinPath\(/);
  assert.match(source, /function parseEndpoint\(/);
  assert.match(source, /method:\s*"GET"/);
  assert.match(source, /fetchImpl/);
});

test("B-TIR-BILLING-ERROR: billing collapses HTTP failures to Error", () => {
  const source = readSrc("billing/runtime/browser-transport.ts");
  assert.match(source, /throw new Error\(/);
  assert.match(source, /json\?\.error\?\.message/);
});

test("B-TIR-SESSION-CACHE: session cache is selected + endpoint", () => {
  const source = readSrc("next/topology.ts");
  assert.match(source, /type SessionSelection = \{/);
  assert.match(source, /selected: "local" \| "hosted"/);
  assert.match(source, /endpoint\?: string/);
});

test("B-TIR-HANDLERS: AthenaNextHandlers already has auth/data/storage/billing", () => {
  const source = readSrc("next/data-handlers.ts");
  assert.match(source, /export interface AthenaNextHandlers/);
  assert.match(source, /auth:/);
  assert.match(source, /billing:/);
  assert.match(source, /data:/);
  assert.match(source, /storage:/);
});
