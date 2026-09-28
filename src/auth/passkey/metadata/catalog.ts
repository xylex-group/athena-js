import type { AthenaAuthenticatorMetadata } from "./types.ts";

/**
 * Bundled, replaceable AAGUID catalog. Not a network Metadata Service client.
 * Keys are canonical lowercase UUID text from `normalizePasskeyAaguid`.
 */
export const ATHENA_AUTHENTICATOR_METADATA_CATALOG: readonly AthenaAuthenticatorMetadata[] =
  [
    {
      aaguid: "adce0002-35bc-c60a-648b-0b25b34bb543",
      displayName: "Chrome on Mac",
      vendor: "Google",
    },
    {
      aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
      displayName: "Google Password Manager",
      vendor: "Google",
    },
    {
      aaguid: "08987058-cadc-4b81-b6e1-30de50dcbe96",
      displayName: "Windows Hello",
      vendor: "Microsoft",
    },
    {
      aaguid: "9ddd1817-af5a-4672-a2b9-3e3dd95000a9",
      displayName: "Windows Hello",
      vendor: "Microsoft",
    },
    {
      aaguid: "dd4ec289-e01d-41c9-bb89-70fa845d4bf2",
      displayName: "iCloud Keychain",
      vendor: "Apple",
    },
    {
      aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
      displayName: "iCloud Keychain",
      vendor: "Apple",
    },
    {
      aaguid: "cc4fb84c-2424-4c94-87ba-6767112e9012",
      displayName: "MacBook Touch ID",
      model: "Touch ID",
      vendor: "Apple",
    },
    {
      aaguid: "002ebc4f-5700-4f6b-b3d1-967ae1d7eab6",
      displayName: "YubiKey",
      vendor: "Yubico",
    },
    {
      aaguid: "2fc0579f-8113-47ea-b116-bb5a8db9202a",
      displayName: "YubiKey",
      vendor: "Yubico",
    },
    {
      aaguid: "bada5566-a7aa-401f-ad96-45686a11f038",
      displayName: "1Password",
      vendor: "1Password",
    },
    {
      aaguid: "d548826e-79b4-db40-a3d8-11116f7e8349",
      displayName: "Bitwarden",
      vendor: "Bitwarden",
    },
  ];

const BY_AAGUID = new Map(
  ATHENA_AUTHENTICATOR_METADATA_CATALOG.map((entry) => [entry.aaguid, entry])
);

export function lookupAuthenticatorMetadata(
  aaguid: string | null | undefined
): AthenaAuthenticatorMetadata | undefined {
  if (!aaguid) {
    return;
  }
  return BY_AAGUID.get(aaguid);
}
