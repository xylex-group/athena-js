import { isBlockedIpv4, parseIpv4 } from "../../email/blocked-ip.ts";
import type { AthenaAuthEmailTemplateAttachment } from "../types.ts";
import type { AthenaAuthEmailAttachmentFailureMode } from "./contract.ts";
import { AthenaAuthEmailError } from "./errors.ts";

const PRIVATE_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isNonGlobalIpv4(host: string): boolean {
  const octets = parseIpv4(host);
  return octets !== null && isBlockedIpv4(octets);
}

export function validateAttachmentTarget(fileUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    throw AthenaAuthEmailError.badRequest("attachment URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw AthenaAuthEmailError.badRequest(
      "attachment URL must use http or https"
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (
    PRIVATE_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "[::1]" ||
    isNonGlobalIpv4(host)
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
