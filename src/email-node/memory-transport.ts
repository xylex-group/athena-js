import type {
  AthenaSmtpConnectInput,
  AthenaSmtpConnection,
  AthenaSmtpReply,
  AthenaSmtpTransport,
} from "./transport.ts";

export interface MemorySmtpTransport extends AthenaSmtpTransport {
  commands: string[];
  payloads: string[];
}

export const DEFAULT_STARTTLS_REPLIES: AthenaSmtpReply[] = [
  { code: 220, lines: ["smtp.example.com ESMTP"] },
  { code: 250, lines: ["smtp.example.com", "STARTTLS", "AUTH PLAIN LOGIN"] },
  { code: 220, lines: ["ready to start TLS"] },
  { code: 250, lines: ["smtp.example.com", "AUTH PLAIN LOGIN"] },
  { code: 235, lines: ["Authentication successful"] },
  { code: 250, lines: ["OK"] },
  { code: 250, lines: ["OK"] },
  { code: 354, lines: ["Start mail input"] },
  { code: 250, lines: ["queued as <smtp-test-id@smtp.example.com>"] },
  { code: 221, lines: ["Bye"] },
];

function scriptedReply(
  commands: string[],
  payloads: string[],
  awaitingData: { value: boolean }
): AthenaSmtpReply {
  if (payloads.length > 0 && awaitingData.value) {
    awaitingData.value = false;
    return { code: 250, lines: ["queued as <smtp-test-id@smtp.example.com>"] };
  }
  const last = commands.at(-1) ?? "";
  if (commands.length === 0) {
    return { code: 220, lines: ["smtp.example.com ESMTP"] };
  }
  if (last.startsWith("EHLO ")) {
    return {
      code: 250,
      lines: ["smtp.example.com", "STARTTLS", "AUTH PLAIN LOGIN"],
    };
  }
  if (last === "STARTTLS") {
    return { code: 220, lines: ["ready to start TLS"] };
  }
  if (last.startsWith("AUTH ")) {
    return { code: 235, lines: ["Authentication successful"] };
  }
  if (last.startsWith("MAIL FROM:")) {
    return { code: 250, lines: ["OK"] };
  }
  if (last.startsWith("RCPT TO:")) {
    return { code: 250, lines: ["OK"] };
  }
  if (last === "DATA") {
    awaitingData.value = true;
    return { code: 354, lines: ["Start mail input"] };
  }
  if (last === "QUIT") {
    return { code: 221, lines: ["Bye"] };
  }
  return { code: 250, lines: ["OK"] };
}

export function createMemorySmtpTransport(
  replies?: AthenaSmtpReply[]
): MemorySmtpTransport {
  const commands: string[] = [];
  const payloads: string[] = [];
  const remaining = replies ? [...replies] : null;
  const awaitingData = { value: false };

  const connect: MemorySmtpTransport = async (
    _input: AthenaSmtpConnectInput
  ) => {
    const connection: AthenaSmtpConnection = {
      async close() {},
      async readReply() {
        if (remaining) {
          const next = remaining.shift();
          if (!next) {
            throw new Error("SMTP memory transport has no remaining replies");
          }
          return next;
        }
        return scriptedReply(commands, payloads, awaitingData);
      },
      async startTls() {
        commands.push("STARTTLS-UPGRADE");
      },
      async writeData(data: string) {
        payloads.push(data);
      },
      async writeLine(line: string) {
        commands.push(line);
      },
    };
    return connection;
  };

  connect.commands = commands;
  connect.payloads = payloads;
  return connect;
}
