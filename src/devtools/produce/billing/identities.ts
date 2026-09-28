import type {
  AthenaDevtoolsBillingConnectionInspector,
  AthenaDevtoolsBillingIdentityRoute,
  AthenaDevtoolsBillingInspector,
} from "../../protocol/billing.ts";
import type { ProduceBillingInspectorInput } from "./types.ts";

export function produceBillingIdentities(
  input: ProduceBillingInspectorInput & {
    connections: AthenaDevtoolsBillingConnectionInspector[];
  }
): AthenaDevtoolsBillingInspector["subjects"] {
  const materialized = input.internals?.billingMaterializedConnections ?? [];
  const activeCount = materialized.length;
  const routes: AthenaDevtoolsBillingIdentityRoute[] = [];
  const conflicts: AthenaDevtoolsBillingInspector["subjects"]["conflicts"] = [];
  if (activeCount > 1) {
    conflicts.push({
      code: "BILLING_CONNECTION_AMBIGUOUS",
      detail: `${String(activeCount)} active provider connections; subject routing is ambiguous`,
    });
    routes.push({
      diagnostics: [
        "Multiple materialized connections; require a sole active connection before binding a provider customer",
      ],
      resolution: "ambiguous",
      subject: { id: "*", kind: "user" },
    });
  } else if (activeCount === 0 && input.connections.length > 0) {
    routes.push({
      diagnostics: [
        "Provider slots are configured but no materialized connection id is available yet",
      ],
      resolution: "unbound",
      subject: { id: "*", kind: "user" },
    });
  } else if (activeCount === 1) {
    const sole = materialized[0];
    if (sole) {
      routes.push({
        connection: {
          id: sole.id,
          provider: sole.provider,
        },
        diagnostics: [
          "Sole active connection; provider-customer binding is not loaded in this inspector wave",
        ],
        resolution: "bound",
        subject: { id: "*", kind: "user" },
      });
    }
  }
  return {
    bindings: [],
    conflicts,
    routes,
  };
}
