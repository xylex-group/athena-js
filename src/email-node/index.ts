/**
 * Node-only Athena email transports.
 *
 * Never import this module from browser, React Native, or Cloudflare entries.
 */

import "server-only";

export {
  smtp,
  type AthenaSmtpAuth,
  type AthenaSmtpConfig,
  type AthenaSmtpSecure,
} from "./smtp.ts";
export {
  createNodeSmtpTransport,
  type AthenaSmtpConnectInput,
  type AthenaSmtpConnection,
  type AthenaSmtpReply,
  type AthenaSmtpTransport,
} from "./transport.ts";
export { createMemorySmtpTransport } from "./memory-transport.ts";
