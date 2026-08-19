import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Only publish credentials — never load DATABASE_URL or other app secrets. */
const PUBLISH_ENV_KEYS = new Set(["NPM_TOKEN", "NODE_AUTH_TOKEN"]);

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadPublishTokenFromEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!PUBLISH_ENV_KEYS.has(key)) {
      continue;
    }
    if (process.env[key] === undefined) {
      process.env[key] = stripQuotes(rawValue);
    }
  }
}

for (const fileName of [".env.local", ".env"]) {
  loadPublishTokenFromEnvFile(resolve(process.cwd(), fileName));
}

function requireFinalityReport() {
  const reportPath = resolve(process.cwd(), ".tmp/athena-finality.json");
  if (!existsSync(reportPath)) {
    console.error(
      "Missing .tmp/athena-finality.json. Run `pnpm test:finality` before publishing."
    );
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const pkg = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8")
  );
  const rev = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (rev.status !== 0) {
    console.error("git rev-parse HEAD failed; cannot verify finality report.");
    process.exit(1);
  }
  const commit = (rev.stdout || "").trim();
  const requiredChecks = [
    "unit",
    "ownership",
    "exports",
    "browserIsolation",
    "tarballConsumer",
    "postgres",
    "embeddedAuth",
    "nextE2E",
  ];

  if (report.passed !== true) {
    console.error("athena-finality.json passed is not true; refuse to publish.");
    process.exit(1);
  }
  if (report.package !== "@xylex-group/athena") {
    console.error(
      "athena-finality.json package does not match @xylex-group/athena."
    );
    process.exit(1);
  }
  if (report.version !== pkg.version) {
    console.error(
      `athena-finality.json version ${report.version} does not match package.json ${pkg.version}.`
    );
    process.exit(1);
  }
  if (report.commit !== commit) {
    console.error(
      `athena-finality.json commit ${report.commit} does not match git HEAD ${commit}.`
    );
    process.exit(1);
  }
  const checks = report.checks ?? {};
  for (const key of requiredChecks) {
    if (checks[key] !== true) {
      console.error(`athena-finality.json checks.${key} is not true.`);
      process.exit(1);
    }
  }
}

requireFinalityReport();

const token = process.env.NODE_AUTH_TOKEN ?? process.env.NPM_TOKEN;

if (!token) {
  console.error(
    "Missing NPM token. Set NODE_AUTH_TOKEN or NPM_TOKEN before publishing."
  );
  process.exit(1);
}

const result = spawnSync(
  process.platform === "win32" ? "npm publish --access public" : "npm",
  process.platform === "win32"
    ? process.argv.slice(2)
    : ["publish", "--access", "public", ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      NODE_AUTH_TOKEN: token,
    },
    shell: process.platform === "win32",
    stdio: "inherit",
  }
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
}
