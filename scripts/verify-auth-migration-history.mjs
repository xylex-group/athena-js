#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(pkgRoot));
const manifestPath = join(
  pkgRoot,
  "contracts",
  "auth",
  "schema-migrations.manifest.json"
);
const manifestGitPath = relative(repoRoot, manifestPath).replaceAll("\\", "/");

const ATHENA_570_033_CHECKSUM =
  "044557ff8b79810d05e43f4fb9f0203e42b68ad0ea9c62c4e1c1970440a6b764";
const CANONICAL_033_CHECKSUM =
  "483af951e47a72cdffb6b8a21f5878a1e9c2ce250079e7535bad35a47d5a1418";
const ONE_TIME_033_CORRECTION = Object.freeze({
  affectedPackageVersion: "5.7.0",
  issue: "#1108",
  newPackageVersion: "5.7.1",
  version: "033",
});

function fail(message) {
  throw new Error(message);
}

function parseManifest(manifest, label) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`${label} Auth migration manifest must be a JSON object.`);
  }
  const entries = Object.entries(manifest);
  for (const [version, checksum] of entries) {
    if (
      !/^\d{3,}$/.test(version) ||
      String(Number(version)).padStart(3, "0") !== version
    ) {
      fail(
        `${label} Auth migration manifest has non-canonical version key ${version}.`
      );
    }
    if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/.test(checksum)) {
      fail(
        `${label} Auth migration ${version} has an invalid SHA-256 checksum.`
      );
    }
  }
  return new Map(entries);
}

/**
 * Enforce append-only released migration identity, with the single #1108 recovery.
 */
export function assertAuthMigrationManifestAppendOnly(
  baselineManifest,
  candidateManifest,
  { packageVersion } = {}
) {
  const baseline = parseManifest(baselineManifest, "Baseline");
  const candidate = parseManifest(candidateManifest, "Candidate");
  if (
    packageVersion &&
    compareVersions(
      packageVersion.split(".").map(Number),
      ONE_TIME_033_CORRECTION.newPackageVersion.split(".").map(Number)
    ) >= 0 &&
    candidate.get(ONE_TIME_033_CORRECTION.version) !== CANONICAL_033_CHECKSUM
  ) {
    fail(
      `Auth migration 033 must retain canonical checksum ${CANONICAL_033_CHECKSUM} after the ${ONE_TIME_033_CORRECTION.newPackageVersion} correction.`
    );
  }
  const baselineVersions = [...baseline.keys()].map(Number);
  const highestBaselineVersion = Math.max(0, ...baselineVersions);
  let acceptedHistoricalCorrection = false;

  for (const [version, checksum] of baseline) {
    const nextChecksum = candidate.get(version);
    if (nextChecksum === undefined) {
      fail(
        `Released Auth migration ${version} was removed. Released migration history is append-only.`
      );
    }
    if (nextChecksum === checksum) {
      continue;
    }

    const isOneTime033Correction =
      version === ONE_TIME_033_CORRECTION.version &&
      checksum === ATHENA_570_033_CHECKSUM &&
      nextChecksum === CANONICAL_033_CHECKSUM &&
      packageVersion != null &&
      compareVersions(
        packageVersion.split(".").map(Number),
        ONE_TIME_033_CORRECTION.newPackageVersion.split(".").map(Number)
      ) >= 0;
    if (isOneTime033Correction) {
      acceptedHistoricalCorrection = true;
      continue;
    }

    fail(
      `Released Auth migration ${version} changed from ${checksum} to ${nextChecksum}. Released migration history is append-only.`
    );
  }

  for (const version of candidate.keys()) {
    if (baseline.has(version)) {
      continue;
    }
    if (Number(version) <= highestBaselineVersion) {
      fail(
        `Auth migration ${version} was inserted before the end of released history ${String(highestBaselineVersion).padStart(3, "0")}. New migrations must append after existing versions.`
      );
    }
  }
  return acceptedHistoricalCorrection;
}

function runGit(args, cwd = repoRoot) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    return null;
  }
  return (result.stdout || "").trim();
}

function parseReleaseVersion(value) {
  const match = /^athena-v(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function resolveBaselineRef(packageVersion, args = process.argv.slice(2)) {
  const baseArgument = args.indexOf("--base");
  const explicitBase = baseArgument >= 0 ? args[baseArgument + 1] : undefined;
  const configuredBase =
    explicitBase || process.env.ATHENA_AUTH_MIGRATION_BASE_REF;
  if (configuredBase) {
    return configuredBase;
  }
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }

  const currentVersion = packageVersion.split(".").map(Number);
  if (
    currentVersion.length !== 3 ||
    currentVersion.some((part) => !Number.isInteger(part))
  ) {
    fail(
      `Cannot determine previous release for package version ${packageVersion}.`
    );
  }
  const tags = runGit(["tag", "--list", "athena-v*"]);
  if (tags === null) {
    fail(
      "Cannot list Athena JS release tags for Auth migration history verification."
    );
  }
  const baselineTag = tags
    .split(/\r?\n/)
    .map((tag) => ({ tag, version: parseReleaseVersion(tag) }))
    .filter(
      (entry) =>
        entry.version && compareVersions(entry.version, currentVersion) < 0
    )
    .sort((left, right) =>
      compareVersions(right.version, left.version)
    )[0]?.tag;
  if (!baselineTag) {
    fail(
      `No earlier athena-v* release tag exists for @xylex-group/athena@${packageVersion}; set ATHENA_AUTH_MIGRATION_BASE_REF to a trusted baseline.`
    );
  }
  return baselineTag;
}

function readManifestFromGit(ref) {
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) {
    fail(`Invalid Auth migration history baseline ref ${ref}.`);
  }
  const source = runGit(["show", `${ref}:${manifestGitPath}`]);
  if (source === null) {
    fail(
      `Cannot read ${manifestGitPath} from baseline ${ref}. Fetch the base branch or choose a trusted Auth migration baseline.`
    );
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(
      `Baseline ${ref} has invalid Auth migration manifest JSON: ${error instanceof Error ? error.message : error}`
    );
  }
}

export function verifyAuthMigrationHistory({ baseRef } = {}) {
  const packageJson = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  );
  const candidateManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const baseline = baseRef || resolveBaselineRef(String(packageJson.version));
  const acceptedHistoricalCorrection = assertAuthMigrationManifestAppendOnly(
    readManifestFromGit(baseline),
    candidateManifest,
    { packageVersion: String(packageJson.version) }
  );
  if (acceptedHistoricalCorrection) {
    console.log(
      `Accepted the one-time ${ONE_TIME_033_CORRECTION.issue} migration 033 correction for Athena JS ${ONE_TIME_033_CORRECTION.affectedPackageVersion}.`
    );
  }
  console.log(
    `Auth migration history is append-only against ${baseline} for @xylex-group/athena@${packageJson.version}.`
  );
}

function main() {
  try {
    const args = process.argv.slice(2);
    const baseRef = args.includes("--base")
      ? args[args.indexOf("--base") + 1]
      : undefined;
    verifyAuthMigrationHistory({ baseRef });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

const invoked =
  Boolean(process.argv[1]) &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked) {
  main();
}
