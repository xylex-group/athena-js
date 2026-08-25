import { assertAthenaEmailProviderRuntime } from "../capabilities.ts";
import {
  ATHENA_EMAIL_DELIVERY_FAILED,
  ATHENA_EMAIL_PROVIDER_INVALID,
  AthenaEmailError,
} from "../errors.ts";
import { defineAthenaEmailProvider } from "../provider.ts";
import {
  envelopeAcceptedRecipients,
  toPublicEmailDeliveryResult,
} from "../runtime.ts";
import type { AthenaEmailProvider } from "../types.ts";
import { requireSendableBody, selectAttachments } from "./attachments.ts";
import { formatEmailMailbox, toBase64 } from "./encoding.ts";

const DEFAULT_RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_RESEND_TIMEOUT_MS = 30_000;

export interface ResendEmailProviderOptions {
  apiKey: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /**
   * Fetch and response-body deadline in milliseconds. Defaults to 30s.
   */
  timeoutMs?: number;
}

function resendTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_RESEND_TIMEOUT_MS;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_PROVIDER_INVALID,
      "Resend timeoutMs must be a positive number."
    );
  }
  return value;
}

async function withResendDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abort: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort();
          reject(
            new AthenaEmailError(
              ATHENA_EMAIL_DELIVERY_FAILED,
              `Resend email provider timed out after ${timeoutMs}ms.`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Resend delivery over HTTP (`POST /emails`). Does not import the Resend SDK.
 */
export function resend(options: ResendEmailProviderOptions): AthenaEmailProvider {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_PROVIDER_INVALID,
      "Resend email provider requires an apiKey."
    );
  }
  const endpoint = options.endpoint?.trim() || DEFAULT_RESEND_ENDPOINT;
  const fetchImpl = options.fetchImpl;
  const timeoutMs = resendTimeoutMs(options.timeoutMs);
  const provider = defineAthenaEmailProvider({
    capabilities: {
      delivery: "http",
      runtimes: ["node", "edge"],
    },
    id: "resend",
    async send(message) {
      assertAthenaEmailProviderRuntime(provider);
      requireSendableBody(message);
      const fetchFn = fetchImpl ?? globalThis.fetch;
      if (typeof fetchFn !== "function") {
        throw new AthenaEmailError(
          ATHENA_EMAIL_DELIVERY_FAILED,
          "Resend email provider requires fetch."
        );
      }
      const attachments = selectAttachments(message).map((attachment) => ({
        content:
          attachment.content === undefined
            ? undefined
            : toBase64(attachment.content),
        content_type: attachment.contentType,
        filename: attachment.filename,
        path: attachment.fileUrl,
      }));
      const controller = new AbortController();
      const response = await withResendDeadline(
        fetchFn(endpoint, {
          body: JSON.stringify({
            attachments: attachments.length > 0 ? attachments : undefined,
            bcc: message.bcc.length > 0 ? message.bcc : undefined,
            cc: message.cc.length > 0 ? message.cc : undefined,
            from: formatEmailMailbox(message.from, message.fromName),
            headers:
              Object.keys(message.headers).length > 0 ? message.headers : undefined,
            html: message.html,
            reply_to: message.replyTo,
            subject: message.subject,
            text: message.text,
            to: message.to,
          }),
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        }),
        timeoutMs,
        () => {
          controller.abort();
        }
      );
      const raw: unknown = await withResendDeadline(
        response.json().catch(() => null),
        timeoutMs,
        () => {
          controller.abort();
        }
      );
      if (!response.ok) {
        throw new AthenaEmailError(
          ATHENA_EMAIL_DELIVERY_FAILED,
          `Resend email provider failed (${response.status}).`
        );
      }
      const messageId =
        raw &&
        typeof raw === "object" &&
        typeof (raw as { id?: unknown }).id === "string"
          ? (raw as { id: string }).id
          : undefined;
      return toPublicEmailDeliveryResult(
        {
          accepted: envelopeAcceptedRecipients(message),
          messageId,
          provider: "resend",
          rejected: [],
          success: true,
        },
        "resend"
      );
    },
  });
  return provider;
}
