/**
 * Unified finality matrix (Wave 6).
 * Every hard cell must have on-disk proofs. Packed cells must appear in
 * scripts/run-finality.mjs. Adjacent cells are documented, not release blockers.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** @typedef {"hard" | "adjacent"} FinalityGate */
/** @typedef {"unit" | "packed" | "script" | "sibling" | "docs"} FinalityLane */

/**
 * @typedef {object} FinalityCell
 * @property {number} id
 * @property {string} title
 * @property {FinalityGate} gate
 * @property {FinalityLane} lane
 * @property {string[]} proofs
 */

/** @type {readonly FinalityCell[]} */
export const FINALITY_MATRIX = Object.freeze([
  {
    gate: "hard",
    id: 1,
    lane: "unit",
    proofs: [
      "test/auth-route-inventory.test.ts",
      "scripts/auth-route-parity.mjs",
    ],
    title: "auth route parity",
  },
  {
    gate: "hard",
    id: 2,
    lane: "packed",
    proofs: [
      "test/finality/next-minimal-golden-social.test.ts",
      "test/fixtures/oauth-provider/index.ts",
    ],
    title: "Social OAuth packed Athena JS canary",
  },
  {
    gate: "hard",
    id: 3,
    lane: "unit",
    proofs: [
      "test/sdd/social-oauth-embedded-runtime.target.test.ts",
      "test/sdd/social-oauth-release.target.test.ts",
      "test/sdd/social-oauth-deny-corpus.target.test.ts",
      "../../contracts/auth/oauth-deny-vectors.json",
    ],
    title: "OAuth security vectors",
  },
  {
    gate: "hard",
    id: 4,
    lane: "packed",
    proofs: [
      "test/finality/next-minimal-golden-passkey.test.ts",
      "test/sdd/athena-js-passkey-closure.target.test.ts",
    ],
    title: "WebAuthn packed Chromium",
  },
  {
    gate: "hard",
    id: 5,
    lane: "unit",
    proofs: [
      "test/sdd/athena-token-authority-interop.target.test.ts",
      "test/sdd/athena-token-authority-finality.target.test.ts",
      "test/finality/token-key-store-postgres.test.ts",
      "test/finality/token-key-store-child.ts",
    ],
    title: "JWT/JWKS durable Postgres TokenKeyStore (not process Map)",
  },
  {
    gate: "hard",
    id: 6,
    lane: "packed",
    proofs: [
      "test/finality/next-minimal-golden-path.test.ts",
      "test/sdd/athena-js-authorization-production-proof.target.test.ts",
    ],
    title: "authorization golden path",
  },
  {
    gate: "hard",
    id: 7,
    lane: "unit",
    proofs: ["test/sdd/athena-js-postgres-ownership-finality.target.test.ts"],
    title: "Postgres ownership architecture scan",
  },
  {
    gate: "hard",
    id: 8,
    lane: "unit",
    proofs: ["test/postgres-pool-manager.test.ts"],
    title: "Postgres manager runtime tests",
  },
  {
    gate: "hard",
    id: 9,
    lane: "unit",
    proofs: [
      "test/sdd/athena-js-auth-client-decomposition.target.test.ts",
      "test/fixtures/auth-client-api-shape.json",
      "test/auth-client.test.ts",
    ],
    title: "Auth client public-shape test",
  },
  {
    gate: "hard",
    id: 10,
    lane: "sibling",
    proofs: [
      "../athena-auth-ui/tests/public-export-graph.test.ts",
      "../athena-auth-ui/tests/export-boundary.test.ts",
    ],
    title: "Auth UI export tests",
  },
  {
    gate: "hard",
    id: 11,
    lane: "script",
    proofs: [
      "test/finality/browser-boundary.test.ts",
      "scripts/audit-browser-bundle-safety.mjs",
    ],
    title: "browser graph audit",
  },
  {
    gate: "hard",
    id: 12,
    lane: "script",
    proofs: ["scripts/audit-rn-bundle-safety.mjs"],
    title: "React Native graph audit",
  },
  {
    gate: "hard",
    id: 13,
    lane: "script",
    proofs: ["scripts/check-release-tarball.mjs"],
    title: "tarball structure",
  },
  {
    gate: "hard",
    id: 14,
    lane: "packed",
    proofs: ["test/finality/package-install.test.ts"],
    title: "clean package install",
  },
  {
    gate: "hard",
    id: 15,
    lane: "packed",
    proofs: ["test/finality/embedded-next.test.ts"],
    title: "Next build / Turbopack build",
  },
  {
    gate: "hard",
    id: 16,
    lane: "packed",
    proofs: ["test/finality/next-minimal-golden-path.test.ts"],
    title: "fresh DB migration",
  },
  {
    gate: "hard",
    id: 17,
    lane: "unit",
    proofs: [
      "test/embedded-sql-apply.test.ts",
      "test/migrations-managed-auth.test.ts",
    ],
    title: "migration idempotency",
  },
  {
    gate: "hard",
    id: 18,
    lane: "docs",
    proofs: ["scripts/check-docs-consistency.mjs"],
    title: "final docs/contract drift check",
  },
  {
    gate: "hard",
    id: 19,
    lane: "packed",
    proofs: ["test/finality/next-minimal-golden-auth-ui-pack.test.ts"],
    title: "Packed athena-js + athena-auth-ui consumer",
  },
  {
    gate: "hard",
    id: 21,
    lane: "packed",
    proofs: ["test/finality/packed-transport-topology.test.ts"],
    title: "Packed Transport 1.2 topology (auth.url / proxy / credentials)",
  },
  {
    gate: "hard",
    id: 23,
    lane: "script",
    proofs: [
      "scripts/run-release-gates.mjs",
      "test/sdd/billing-release/financial-finality.target.test.ts",
      "test/sdd/billing-release/auth-schema-release.target.test.ts",
    ],
    title: "Billing financial and Auth schema release gates",
  },
  {
    gate: "hard",
    id: 24,
    lane: "packed",
    proofs: [
      "test/fixtures/expo-rn53/package.json",
      "test/fixtures/expo-rn53/scripts/check-resolve.mjs",
      "test/fixtures/expo-rn53/scripts/check-export.mjs",
    ],
    title: "Packed Expo 53 / React Native 0.79 consumer",
  },
  {
    gate: "adjacent",
    id: 22,
    lane: "sibling",
    proofs: ["../athena-auth-ui/e2e/tests/passkey-browser-finality.e2e.ts"],
    title: "WebAuthn Chromium virtual authenticator (Auth UI)",
  },
  {
    gate: "adjacent",
    id: 20,
    lane: "docs",
    proofs: ["docs/auth/passkey-platform-matrix.md"],
    title: "WebAuthn physical platform matrix (manual)",
  },
]);

export function athenaJsHardCells() {
  return FINALITY_MATRIX.filter(
    (cell) => cell.gate === "hard" && cell.lane !== "sibling"
  );
}

/**
 * @param {string} packageRoot packages/athena-js
 */
export function assertFinalityMatrixProofs(packageRoot) {
  const missing = [];
  for (const cell of FINALITY_MATRIX) {
    for (const proof of cell.proofs) {
      const absolute = join(packageRoot, proof);
      if (!existsSync(absolute)) {
        missing.push(`${cell.id} ${cell.title}: ${proof}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `finality matrix proofs missing:\n${missing.map((row) => `  - ${row}`).join("\n")}`
    );
  }
}
