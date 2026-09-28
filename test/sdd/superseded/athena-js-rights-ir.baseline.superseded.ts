/**
 * SUPERSEDED by test/sdd/athena-js-rights-ir.target.test.ts
 *
 * Former characterization of freeze-HEAD defects:
 * - no src/rights/
 * - no ./rights export
 * - no branded AthenaRightKey / parseAthenaRightKey
 * - AthenaPrincipal.rights string[] (unparsed)
 * - grants treated like rights (no provenance-only docs)
 * - no shared JSON fixtures
 * - api-key/rights CLI and gateway-admin forwarded unparsed strings
 *
 * Target suite is the CI source of truth. Do not invert titles in place.
 *
 * See docs/sdd/xylex/athena-js-rights-ir/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as rootBarrel from "../../../src/index.ts";
import { matchPolicyPrincipal } from "../../../src/policy/match-principal.ts";
import {
  anonymousAthenaPrincipal,
  normalizeAthenaPrincipal,
} from "../../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const repoRoot = join(pkgRoot, "..", "..");
const rightsSrcDir = join(srcRoot, "rights");
const fixturesRightsDir = join(pkgRoot, "test", "fixtures", "rights");
const rustRightsSrc = join(repoRoot, "crates", "athena-rights", "src");

type PackageJsonShape = {
  exports?: Record<string, unknown>;
  typesVersions?: Record<string, Record<string, unknown>>;
};

function readPkgRel(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function srcMentions(pattern: RegExp): boolean {
  return collectTsFiles(srcRoot).some((file) =>
    pattern.test(readFileSync(file, "utf8"))
  );
}

function loadPackageJson(): PackageJsonShape {
  return JSON.parse(readPkgRel("package.json")) as PackageJsonShape;
}

test("B-RIR-NO-RIGHTS-DIR: P?: src/rights/ does not exist", () => {
  assert.equal(existsSync(rightsSrcDir), false);
});

test("B-RIR-NO-EXPORT: P?: package.json exports have no ./rights", () => {
  const pkg = loadPackageJson();
  const exportsMap = pkg.exports ?? {};
  assert.equal("./policy" in exportsMap, true);
  assert.equal("./schema" in exportsMap, true);
  assert.equal("./devtools" in exportsMap, true);
  assert.equal("./runtime" in exportsMap, true);
  assert.equal("./rights" in exportsMap, false);
  assert.equal(readPkgRel("package.json").includes('"./rights"'), false);

  const tsup = readPkgRel("tsup.config.ts");
  assert.match(tsup, /policy:\s*"src\/policy\/index\.ts"/);
  assert.match(tsup, /schema:\s*"src\/schema\/index\.ts"/);
  assert.match(tsup, /devtools:\s*"src\/devtools\/index\.ts"/);
  assert.match(tsup, /runtime:\s*"src\/runtime\/data\/index\.ts"/);
  assert.equal(/rights:\s*"src\/rights/.test(tsup), false);

  const typesStar = pkg.typesVersions?.["*"] ?? {};
  assert.equal("rights" in typesStar, false);
  assert.equal("parseAthenaRightKey" in rootBarrel, false);
});

test("B-RIR-NO-PARSE: P?: parseAthenaRightKey does not exist", () => {
  assert.equal(srcMentions(/\bparseAthenaRightKey\b/), false);
  assert.equal(srcMentions(/\btryParseAthenaRightKey\b/), false);
  assert.equal(srcMentions(/\bathenaRightKeyString\b/), false);
  assert.equal("parseAthenaRightKey" in rootBarrel, false);
});

test("B-RIR-NO-BRAND: P?: no branded AthenaRightKey type", () => {
  assert.equal(srcMentions(/\bathenaRightKeyBrand\b/), false);
  assert.equal(srcMentions(/\bAthenaRightKey\b/), false);
  assert.equal(srcMentions(/\bAthenaRightDescriptor\b/), false);
  assert.equal(srcMentions(/\brightMatches\b/), false);
  assert.equal(srcMentions(/\bmissingRequiredRights\b/), false);
});

test("B-RIR-PRINCIPAL-STRING: P?: AthenaPrincipal.rights is string[]", () => {
  const principalSrc = readPkgRel("src/runtime/data/principal.ts");
  assert.match(principalSrc, /rights:\s*readonly string\[\]/);
  assert.equal(principalSrc.includes("AthenaRightKey"), false);
  assert.equal(principalSrc.includes("AthenaPrincipalInput"), false);
  assert.equal(srcMentions(/\bAthenaPrincipalInput\b/), false);
});

test("B-RIR-GRANTS-STRING: P?: AthenaPrincipal.grants is string[] like rights", () => {
  const principalSrc = readPkgRel("src/runtime/data/principal.ts");
  assert.match(principalSrc, /grants:\s*readonly string\[\]/);
  assert.match(principalSrc, /rights:\s*readonly string\[\]/);
  assert.equal(/legacy provenance/i.test(principalSrc), false);
  assert.equal(/never used to satisfy/i.test(principalSrc), false);
});

test("B-RIR-NO-FIXTURES: P?: no shared JSON rights fixtures", () => {
  assert.equal(existsSync(fixturesRightsDir), false);
  assert.equal(
    existsSync(join(fixturesRightsDir, "key-parsing-v1.json")),
    false
  );
  assert.equal(existsSync(join(fixturesRightsDir, "matching-v1.json")), false);
  assert.equal(
    existsSync(join(fixturesRightsDir, "descriptors-v1.json")),
    false
  );
});

test("B-RIR-APIKEY-UNPARSED: P?: api-key create --rights forwards CSV strings without parseAthenaRightKey", () => {
  const apiKeySrc = readPkgRel("src/cli/commands/api-key/index.ts");
  assert.match(apiKeySrc, /rights = parseCsvList/);
  assert.equal(apiKeySrc.includes("parseAthenaRightKey"), false);

  const gatewayAdminSrc = readPkgRel("src/cli/gateway-admin.ts");
  assert.match(gatewayAdminSrc, /rights: options\.input\.rights \?\? \[\]/);
  assert.equal(gatewayAdminSrc.includes("parseAthenaRightKey"), false);
});

test("B-RIR-RIGHTS-CREATE-UNPARSED: P?: rights create --name is a raw string", () => {
  const rightsCliSrc = readPkgRel("src/cli/commands/rights/index.ts");
  assert.match(rightsCliSrc, /name = nextValue/);
  assert.match(rightsCliSrc, /name: parsed\.name/);
  assert.equal(rightsCliSrc.includes("parseAthenaRightKey"), false);
  assert.match(
    rightsCliSrc,
    /rights create requires --name <right>\. Example: athena-js rights create --name gateway\.query/
  );
});

test("B-RIR-NORMALIZE-COPY: P?: normalizeAthenaPrincipal copies rights strings without parsing", () => {
  const principalSrc = readPkgRel("src/runtime/data/principal.ts");
  assert.match(
    principalSrc,
    /rights:\s*Object\.freeze\(\[\.\.\.\(principal\.rights \?\? \[\]\)\]\)/
  );
  assert.equal(principalSrc.includes("parseAthenaRightKey"), false);
  assert.equal(principalSrc.includes("tryParseAthenaRightKey"), false);

  const normalized = normalizeAthenaPrincipal({
    authenticated: true,
    grants: ["users.delete"],
    rights: ["admin:read", "users.read", "gateway .query"],
  });
  assert.deepEqual(
    [...normalized.rights],
    ["admin:read", "users.read", "gateway .query"]
  );
  assert.deepEqual([...normalized.grants], ["users.delete"]);
  assert.equal(
    matchPolicyPrincipal(
      { kind: "permission", name: "admin:read" },
      normalized
    ),
    true
  );
  assert.equal(
    matchPolicyPrincipal(
      { kind: "permission", name: "users.delete" },
      normalized
    ),
    false
  );

  const anonymous = anonymousAthenaPrincipal();
  assert.deepEqual([...anonymous.rights], []);
  assert.deepEqual([...anonymous.grants], []);
});

test("B-RIR-NO-CTOR: P?: no createRightsClient", () => {
  assert.equal(srcMentions(/\bcreateRightsClient\b/), false);
  assert.equal(srcMentions(/\bAthenaRightsClient\b/), false);
  assert.equal("createRightsClient" in rootBarrel, false);
  assert.equal(typeof rootBarrel.createClient, "function");
});

test("B-RIR-GRANTS-FIELD: P?: AthenaPrincipal.grants field exists", () => {
  const principalSrc = readPkgRel("src/runtime/data/principal.ts");
  assert.match(principalSrc, /grants:\s*readonly string\[\]/);
  const normalized = normalizeAthenaPrincipal({
    authenticated: false,
    grants: ["legacy-grant"],
    rights: [],
  });
  assert.deepEqual([...normalized.grants], ["legacy-grant"]);
});

test("B-RIR-NO-NUCLEUS-EXPORT: P?: Data Nucleus is not a public package export", () => {
  const pkg = loadPackageJson();
  const exportKeys = Object.keys(pkg.exports ?? {});
  assert.equal(
    exportKeys.some((key) => key.includes("nucleus")),
    false
  );
  assert.equal("./runtime" in (pkg.exports ?? {}), true);
  assert.equal(existsSync(join(srcRoot, "runtime", "data", "nucleus")), true);
});

test("B-RIR-POLICY-IR: P?: Policy IR matcher file still exists (no fork this slice)", () => {
  const matchPrincipalPath = join(srcRoot, "policy", "match-principal.ts");
  assert.equal(existsSync(matchPrincipalPath), true);
  const matchSrc = readFileSync(matchPrincipalPath, "utf8");
  assert.match(matchSrc, /sensitivity:\s*"accent"/);
  assert.match(matchSrc, /listHas\(principal\.rights/);
  assert.equal(srcMentions(/\bcreatePolicyClient\b/), false);
  assert.equal(
    srcMentions(/\bexport (?:class|function|type|interface) PolicyClient\b/),
    false
  );
});

test("B-RIR-RUST-AUTHORITY: P?: crates/athena-rights remains catalog authority", () => {
  assert.equal(existsSync(join(rustRightsSrc, "key.rs")), true);
  assert.equal(existsSync(join(rustRightsSrc, "matching.rs")), true);
  assert.equal(existsSync(join(rustRightsSrc, "lib.rs")), true);
  assert.equal(existsSync(join(rustRightsSrc, "catalog.rs")), true);
  const keyRs = readFileSync(join(rustRightsSrc, "key.rs"), "utf8");
  assert.match(keyRs, /impl AthenaRightKey/);
  const matchingRs = readFileSync(join(rustRightsSrc, "matching.rs"), "utf8");
  assert.match(matchingRs, /fn right_matches/);
  const libRs = readFileSync(join(rustRightsSrc, "lib.rs"), "utf8");
  assert.match(libRs, /fn native_right_catalog/);
});
