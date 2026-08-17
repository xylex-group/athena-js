import fs from "node:fs";

const path = new URL(
  "../src/auth/social-providers/microsoft-entra-id.ts",
  import.meta.url
);
const src = fs.readFileSync(path, "utf8");

const profileStart = src.indexOf("export interface MicrosoftEntraIDProfile");
const factoryStart = src.indexOf("export const microsoft");
if (profileStart < 0 || factoryStart < 0) {
  throw new Error(
    `Could not locate microsoft types/factory (start=${profileStart}, factory=${factoryStart})`
  );
}

const interfaces = src.slice(profileStart, factoryStart).trim();
const typesOut = `import type { ProviderOptions } from '../oauth2/index.ts'

/**
 * Microsoft personal (consumer) account tenant id.
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference
 */
export const MICROSOFT_CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad'

${interfaces}
`;

const typesPath = new URL(
  "../src/auth/social-providers/microsoft-types.ts",
  import.meta.url
);
fs.writeFileSync(typesPath, typesOut);

// Drop the old const + types block before the factory.
const consumerStart = src.indexOf("/**\n * Microsoft's fixed tenant");
if (consumerStart < 0) {
  throw new Error("Could not locate MICROSOFT_CONSUMER_TENANT_ID block");
}

const header = src.slice(0, consumerStart).trimEnd();
const factory = src.slice(factoryStart);

const importBlock = `import {
	MICROSOFT_CONSUMER_TENANT_ID,
	type MicrosoftEntraIDProfile,
	type MicrosoftOptions,
} from "./microsoft-types.ts";

export type { MicrosoftEntraIDProfile, MicrosoftOptions } from "./microsoft-types.ts";
export { MICROSOFT_CONSUMER_TENANT_ID } from "./microsoft-types.ts";
`;

// Insert type imports after existing imports (before blank line / first export)
const main = `${header}

${importBlock}

${factory}
`;

fs.writeFileSync(path, main);
console.log("Wrote microsoft-types.ts and updated microsoft-entra-id.ts");
