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
import type {
  AthenaEmailProvider,
  AthenaResolvedEmailMessage,
} from "../types.ts";
import { requireSendableBody, selectAttachments } from "./attachments.ts";
import { formatEmailMailbox, toBase64 } from "./encoding.ts";

export interface HttpEmailProviderOptions {
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  mapBody?: (message: AthenaResolvedEmailMessage) => unknown;
  /**
   * Fetch and response-body deadline in milliseconds. Defaults to 30s.
   */
  timeoutMs?: number;
  url: string;
}

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

function httpTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_HTTP_TIMEOUT_MS;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_PROVIDER_INVALID,
      "HTTP timeoutMs must be a positive number."
    );
  }
  return value;
}

async function withHttpDeadline<T>(
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
              `HTTP email provider timed out after ${timeoutMs}ms.`
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

function defaultHttpBody(message: AthenaResolvedEmailMessage): unknown {
  return {
    attachments: selectAttachments(message).map((attachment) => ({
      content:
        attachment.content === undefined ? undefined : toBase64(attachment.content),
      contentType: attachment.contentType,
      filename: attachment.filename,
      fileUrl: attachment.fileUrl,
    })),
    bcc: message.bcc,
    cc: message.cc,
    from: formatEmailMailbox(message.from, message.fromName),
    headers: message.headers,
    html: message.html,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    to: message.to,
  };
}

/**
 * Generic HTTP JSON delivery. Browser/edge-safe (`fetch` only).
 */
export function httpEmailProvider(
  options: HttpEmailProviderOptions
): AthenaEmailProvider {
  const url = options.url?.trim();
  if (!url) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_PROVIDER_INVALID,
      "HTTP email provider requires a url."
    );
  }
  const fetchImpl = options.fetchImpl;
  const timeoutMs = httpTimeoutMs(options.timeoutMs);
  return defineAthenaEmailProvider({
    capabilities: {
      delivery: "http",
      runtimes: ["node", "browser", "edge"],
    },
    id: "http",
    async send(message) {
      requireSendableBody(message);
      const fetchFn = fetchImpl ?? globalThis.fetch;
      if (typeof fetchFn !== "function") {
        throw new AthenaEmailError(
          ATHENA_EMAIL_DELIVERY_FAILED,
          "HTTP email provider requires fetch."
        );
      }
      const controller = new AbortController();
      const response = await withHttpDeadline(
        fetchFn(url, {
          body: JSON.stringify(
            options.mapBody ? options.mapBody(message) : defaultHttpBody(message)
          ),
          headers: {
            "content-type": "application/json",
            ...options.headers,
          },
          method: "POST",
          signal: controller.signal,
        }),
        timeoutMs,
        () => {
          controller.abort();
        }
      );
      const raw: unknown = await withHttpDeadline(
        response.json().catch(() => null),
        timeoutMs,
        () => {
          controller.abort();
        }
      );
      if (!response.ok) {
        throw new AthenaEmailError(
          ATHENA_EMAIL_DELIVERY_FAILED,
          `HTTP email provider failed (${response.status}).`
        );
      }
      return toPublicEmailDeliveryResult(
        {
          accepted: envelopeAcceptedRecipients(message),
          messageId:
            raw &&
            typeof raw === "object" &&
            typeof (raw as { id?: unknown }).id === "string"
              ? (raw as { id: string }).id
              : undefined,
          provider: "http",
          rejected: [],
          success: true,
        },
        "http"
      );
    },
  });
}
