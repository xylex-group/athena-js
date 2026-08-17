import type { AthenaAuthEmailTemplateAttachment } from "../types.ts";
import type { AthenaAuthEmailAttachmentFailureMode } from "./contract.ts";
import { AthenaAuthEmailError } from "./errors.ts";

const PRIVATE_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}

export function validateAttachmentTarget(fileUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    throw AthenaAuthEmailError.badRequest("attachment URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw AthenaAuthEmailError.badRequest("attachment URL must use http or https");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    PRIVATE_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "[::1]" ||
    isPrivateIpv4(host)
  ) {
    throw AthenaAuthEmailError.badRequest(
      "attachment URL resolved to a non-public IP address"
    );
  }
}

export function resolveTemplateAttachments(
  attachments: AthenaAuthEmailTemplateAttachment[],
  mode: AthenaAuthEmailAttachmentFailureMode
): AthenaAuthEmailTemplateAttachment[] {
  const resolved: AthenaAuthEmailTemplateAttachment[] = [];
  for (const attachment of attachments) {
    try {
      validateAttachmentTarget(attachment.file_url);
      resolved.push(attachment);
    } catch (error) {
      if (mode === "skip") {
        continue;
      }
      throw error;
    }
  }
  return resolved;
}
