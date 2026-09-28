import type { AthenaCapabilityContribution } from "../capabilities/resolver.ts";
import {
  capabilityContribution,
  unsupportedCapabilityContribution,
} from "../capabilities/contribution.ts";
import type { AthenaChatCapabilities } from "./types.ts";

export function chatCapabilitiesToContributions(
  capabilities: AthenaChatCapabilities
): AthenaCapabilityContribution[] {
  const source = {
    kind: "transport" as const,
    source: `chat:${capabilities.transport}`,
  };
  const facts: readonly (readonly [string, boolean])[] = [
    ["chat.realtime.messages", capabilities.realtime.messages],
    ["chat.realtime.reactions", capabilities.realtime.reactions],
    ["chat.realtime.websocket", capabilities.realtime.websocket],
    ["chat.realtime.presence", capabilities.realtime.presence],
    ["chat.realtime.typing", capabilities.realtime.typing],
  ];
  return facts.map(([key, enabled]) =>
    enabled
      ? capabilityContribution({ key, domain: "chat", kind: "feature" }, source)
      : unsupportedCapabilityContribution(
          { key, domain: "chat", kind: "feature" },
          source
        )
  );
}
