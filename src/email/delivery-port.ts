import type { AthenaEmailDeliveryPort, AthenaEmailModule } from "./types.ts";

export function createEmailDeliveryPort(
  email: Pick<AthenaEmailModule, "send">
): AthenaEmailDeliveryPort {
  return {
    send: (message) => email.send(message),
  };
}
