import {
  ATHENA_EMAIL_MESSAGE_INVALID,
  AthenaEmailError,
} from "../email/errors.ts";
import { selectAttachments } from "../email/providers/attachments.ts";
import type { AthenaResolvedEmailMessage } from "../email/types.ts";

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function needsEncodedWord(value: string): boolean {
  return /[^\t\x20-\x7e]/.test(value);
}

const ENCODED_WORD_PREFIX = "=?UTF-8?B?";
const ENCODED_WORD_SUFFIX = "?=";
const ENCODED_WORD_MAX_CHARS = 75;
const ENCODED_WORD_B64_BUDGET =
  ENCODED_WORD_MAX_CHARS -
  ENCODED_WORD_PREFIX.length -
  ENCODED_WORD_SUFFIX.length;
const ENCODED_WORD_MAX_BYTES = Math.floor(ENCODED_WORD_B64_BUDGET / 4) * 3;

function encodeMimeWord(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  const words: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(offset + ENCODED_WORD_MAX_BYTES, bytes.length);
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    if (end === offset) {
      end = Math.min(offset + 1, bytes.length);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
        end += 1;
      }
    }
    const chunk = bytes.subarray(offset, end);
    words.push(
      `${ENCODED_WORD_PREFIX}${chunk.toString("base64")}${ENCODED_WORD_SUFFIX}`
    );
    offset = end;
  }
  return words.join("\r\n ");
}

function encodeHeaderValue(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      "SMTP header must not contain CR or LF."
    );
  }
  return needsEncodedWord(value) ? encodeMimeWord(value) : value;
}

const RFC_PHRASE_SPECIALS = /[()<>[\]:;@\\,"]/;

function encodeDisplayName(value: string): string {
  if (needsEncodedWord(value)) {
    return encodeMimeWord(value);
  }
  if (!RFC_PHRASE_SPECIALS.test(value)) {
    return value;
  }
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}"`;
}

function formatSmtpFrom(from: string, fromName?: string): string {
  if (!fromName) {
    return from;
  }
  const safeName = fromName.replaceAll(/[\r\n<>]/g, "");
  return `${encodeDisplayName(safeName)} <${from}>`;
}

function assertHeaderField(name: string, value: string): void {
  if (!HEADER_NAME.test(name) || /[\r\n]/.test(name)) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      `Invalid SMTP header name "${name}".`
    );
  }
  if (
    /[\r\n]/.test(value) &&
    !/^(?:[^\r\n]*(?:\r\n[ \t][^\r\n]*)*)$/.test(value)
  ) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      `SMTP header "${name}" must not contain CR or LF.`
    );
  }
}

function foldBase64(value: string): string {
  const lines: string[] = [];
  for (let index = 0; index < value.length; index += 76) {
    lines.push(value.slice(index, index + 76));
  }
  return lines.join("\r\n");
}

function encodeUtf8Base64(value: string): string {
  return foldBase64(Buffer.from(value, "utf8").toString("base64"));
}

function encodeBytesBase64(bytes: Uint8Array): string {
  return foldBase64(Buffer.from(bytes).toString("base64"));
}

function headerBlock(headers: Array<[string, string]>): string {
  return headers
    .map(([name, value]) => {
      assertHeaderField(name, value);
      return `${name}: ${value}`;
    })
    .join("\r\n");
}

function textPart(contentType: string, body: string): string {
  return `${headerBlock([
    ["Content-Type", `${contentType}; charset=utf-8`],
    ["Content-Transfer-Encoding", "base64"],
  ])}\r\n\r\n${encodeUtf8Base64(body)}`;
}

function attachmentPart(
  filename: string,
  contentType: string,
  content: Uint8Array
): string {
  const safeName = filename
    .replaceAll(/[\r\n"]/g, "_")
    .replaceAll("\\", "\\\\");
  return `${headerBlock([
    ["Content-Type", `${contentType}; name="${safeName}"`],
    ["Content-Disposition", `attachment; filename="${safeName}"`],
    ["Content-Transfer-Encoding", "base64"],
  ])}\r\n\r\n${encodeBytesBase64(content)}`;
}

function wrapMultipart(kind: string, parts: string[]): string {
  const boundary = `athena_${crypto.randomUUID().replaceAll("-", "")}`;
  const inner = parts.map((part) => `--${boundary}\r\n${part}`).join("\r\n");
  return `${headerBlock([
    ["Content-Type", `multipart/${kind}; boundary=${boundary}`],
  ])}\r\n\r\n${inner}\r\n--${boundary}--`;
}

function bodyParts(message: AthenaResolvedEmailMessage): string[] {
  const parts: string[] = [];
  if (message.text) {
    parts.push(textPart("text/plain", message.text));
  }
  if (message.html) {
    parts.push(textPart("text/html", message.html));
  }
  return parts;
}

function attachmentBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? Buffer.from(content, "utf8") : content;
}

export function buildSmtpMime(message: AthenaResolvedEmailMessage): string {
  const attachments = selectAttachments(message).flatMap((attachment) => {
    if (attachment.content === undefined) {
      return [];
    }
    return [
      attachmentPart(
        attachment.filename ?? "attachment",
        attachment.contentType ?? "application/octet-stream",
        attachmentBytes(attachment.content)
      ),
    ];
  });

  const bodies = bodyParts(message);
  const alternative =
    bodies.length === 1 ? bodies[0] : wrapMultipart("alternative", bodies);
  const payload =
    attachments.length === 0
      ? alternative
      : wrapMultipart("mixed", [alternative, ...attachments]);

  const headers: Array<[string, string]> = [
    ["From", formatSmtpFrom(message.from, message.fromName)],
    ["To", message.to.join(", ")],
    ["Subject", encodeHeaderValue(message.subject)],
    ["MIME-Version", "1.0"],
  ];
  if (message.cc.length > 0) {
    headers.push(["Cc", message.cc.join(", ")]);
  }
  if (message.replyTo) {
    headers.push(["Reply-To", message.replyTo]);
  }
  for (const [name, value] of Object.entries(message.headers)) {
    headers.push([name, value]);
  }

  return `${headerBlock(headers)}\r\n${payload}\r\n`;
}

export function smtpDotStuff(payload: string): string {
  return payload.replaceAll("\r\n.", "\r\n..").replace(/^\./, "..");
}
