import { createHash } from "node:crypto";

export function deriveCanonicalEventId(material: string): string {
  const hex = createHash("sha256").update(material).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
