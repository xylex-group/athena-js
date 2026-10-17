import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineAthenaConfig,
  generateArtifactsFromSnapshot,
} from "@xylex-group/athena";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
  readFileSync(join(fixtureDir, "introspection.json"), "utf8")
);
const config = defineAthenaConfig({
  provider: {
    connectionString: "postgres://localhost/browser_integer_fixture",
    database: "browser_integer_fixture",
    kind: "postgres",
    mode: "direct",
  },
});
const model = generateArtifactsFromSnapshot(snapshot, config).files.find(
  (artifact) => artifact.kind === "model"
);
if (!model) {
  throw new Error("introspection fixture produced no model artifact");
}
for (const helper of ["bigint()", "integer()", "smallint()"]) {
  if (!model.content.includes(helper)) {
    throw new Error(`generated model is missing ${helper}`);
  }
}
writeFileSync(resolve(process.argv[2]), model.content);
