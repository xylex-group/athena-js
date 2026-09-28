import { ATHENA_EMAIL_MESSAGE_INVALID, AthenaEmailError } from "../errors.ts";
import type {
  AthenaEmailAttachment,
  AthenaResolvedEmailMessage,
} from "../types.ts";

export function requireSendableBody(message: AthenaResolvedEmailMessage): void {
  if (!(message.text || message.html)) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      "Athena email messages require text or html content."
    );
  }
}

export function selectAttachments(
  message: AthenaResolvedEmailMessage
): AthenaEmailAttachment[] {
  const selected: AthenaEmailAttachment[] = [];
  for (const attachment of message.attachments) {
    const hasContent =
      attachment.content !== undefined &&
      (typeof attachment.content !== "string" ||
        attachment.content.length > 0) &&
      !(
        attachment.content instanceof Uint8Array &&
        attachment.content.byteLength === 0
      );
    const hasUrl =
      typeof attachment.fileUrl === "string" &&
      attachment.fileUrl.trim().length > 0;
    if (hasContent || hasUrl) {
      selected.push(attachment);
      continue;
    }
    if (message.attachmentFailureMode === "skip") {
      continue;
    }
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      "Athena email attachments require content or fileUrl."
    );
  }
  return selected;
}
