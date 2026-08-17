import type {
  AthenaAuthEmailDeliveryResult,
  AthenaAuthEmailMessage,
  AthenaAuthEmailProvider,
  AthenaAuthEmailProviderContext,
} from "./contract.ts";

export function createTestEmailProvider(): AthenaAuthEmailProvider & {
  messages: AthenaAuthEmailMessage[];
} {
  const messages: AthenaAuthEmailMessage[] = [];
  return {
    messages,
    async send(
      message: AthenaAuthEmailMessage,
      _context: AthenaAuthEmailProviderContext
    ): Promise<AthenaAuthEmailDeliveryResult> {
      messages.push(message);
      return {
        accepted: Array.isArray(message.to) ? message.to : [message.to],
        provider: "test",
        success: true,
      };
    },
  };
}

export function consoleEmailProvider(): AthenaAuthEmailProvider {
  return {
    async send(
      message: AthenaAuthEmailMessage,
      context: AthenaAuthEmailProviderContext
    ): Promise<AthenaAuthEmailDeliveryResult> {
      const recipients = Array.isArray(message.to) ? message.to.join(",") : message.to;
      console.info(
        `[athena-auth/email]\nevent=${context.eventType ?? ""}\nto=${recipients}\nsubject=${JSON.stringify(message.subject)}\n\n${message.text ?? ""}`
      );
      return {
        accepted: Array.isArray(message.to) ? message.to : [message.to],
        provider: "console",
        success: true,
      };
    },
  };
}
