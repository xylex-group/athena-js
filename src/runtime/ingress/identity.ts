import { createHash } from "node:crypto";

export function deriveIngressProviderEventId(input: {
  provider: string;
  connectionId?: string;
  resourceKind: string;
  resourceId: string;
  authoritativeStateOrVersion: string;
}): string {
  const material = [
    input.provider,
    input.connectionId ?? "",
    input.resourceKind,
    input.resourceId,
    input.authoritativeStateOrVersion,
  ].join("\0");
  return createHash("sha256").update(material).digest("hex");
}
