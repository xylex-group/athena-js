import packageJson from "../package.json" with { type: "json" };

export const PACKAGE_VERSION = packageJson.version;

export function buildSdkHeaderValue(sdkName: string): string {
  return `${sdkName} ${PACKAGE_VERSION}`;
}
