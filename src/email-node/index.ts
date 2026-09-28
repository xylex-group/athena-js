/**
 * Node-only Athena email transports.
 *
 * Never import this module from browser, React Native, or Cloudflare entries.
 */

import "server-only";

export { createMemorySmtpTransport } from "./memory-transport.ts";
export {
  type AthenaSmtpAuth,
  type AthenaSmtpConfig,
  type AthenaSmtpSecure,
  smtp,
} from "./smtp.ts";
export {
  type AthenaSmtpConnectInput,
  type AthenaSmtpConnection,
  type AthenaSmtpReply,
  type AthenaSmtpTransport,
  createNodeSmtpTransport,
} from "./transport.ts";
