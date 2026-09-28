import { resolvePasskeyAuthenticatorDisplay } from "../../passkey/metadata/index.ts";
import type { AthenaStoredPasskey } from "../../passkey/server/types.ts";
import type { AthenaPasskeyRecord } from "../../types.ts";

function asTransportList(
  transports: readonly string[] | string | null | undefined
): string[] {
  if (Array.isArray(transports)) {
    return transports.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0
    );
  }
  if (typeof transports === "string" && transports.trim()) {
    try {
      const parsed: unknown = JSON.parse(transports);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.length > 0
        );
      }
    } catch {
      return [transports];
    }
  }
  return [];
}

export function toPasskeyView(
  stored: AthenaStoredPasskey,
  transports?: string | null
): AthenaPasskeyRecord {
  const listed = asTransportList(
    transports === undefined ? stored.transports : transports
  );
  const resolved = resolvePasskeyAuthenticatorDisplay({
    aaguid: stored.aaguid,
    backedUp: stored.backedUp,
    deviceType: stored.deviceType,
    name: stored.name,
    residentKey: stored.residentKey,
    transports: listed,
  });
  const authenticator: AthenaPasskeyRecord["authenticator"] = {
    backedUp: stored.backedUp,
    deviceType: stored.deviceType,
    displayName: resolved.displayName,
    residentKey: stored.residentKey,
    transports: listed,
  };
  if (resolved.vendor) {
    authenticator.vendor = resolved.vendor;
  }
  if (resolved.model) {
    authenticator.model = resolved.model;
  }
  const view: AthenaPasskeyRecord = {
    authenticator,
    createdAt: stored.createdAt.toISOString(),
    id: stored.id,
    name: stored.name,
    userId: stored.userId,
  };
  if (stored.updatedAt) {
    view.updatedAt = stored.updatedAt.toISOString();
  }
  return view;
}
