import { defineAthenaEmailProvider } from "../provider.ts";
import {
  envelopeAcceptedRecipients,
  toPublicEmailDeliveryResult,
} from "../runtime.ts";
import type { AthenaEmailProvider } from "../types.ts";
import { requireSendableBody } from "./attachments.ts";

export interface ConsoleEmailProviderOptions {
  log?: (line: string) => void;
}

/**
 * Development/testing provider. Must be constructed explicitly — Athena never
 * installs a console transport by default.
 */
export function consoleEmailProvider(
  options: ConsoleEmailProviderOptions = {}
): AthenaEmailProvider {
  const log = options.log ?? ((line: string) => console.info(line));
  return defineAthenaEmailProvider({
    capabilities: {
      delivery: "console",
      runtimes: ["node", "browser", "edge"],
    },
    id: "console",
    async send(message) {
      requireSendableBody(message);
      const recipients = message.to.join(",");
      log(
        `[athena/email]\nprovider=console\nto=${recipients}\nsubject=${JSON.stringify(message.subject)}\n\n${message.text ?? message.html ?? ""}`
      );
      return toPublicEmailDeliveryResult(
        {
          accepted: envelopeAcceptedRecipients(message),
          provider: "console",
          rejected: [],
          success: true,
        },
        "console"
      );
    },
  });
}
