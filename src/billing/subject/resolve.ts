import type { BillingSubjectRef } from "../types.ts";
import type {
  BillingSubjectBindingRecord,
  BillingSubjectRepository,
  ProviderSubject,
} from "./repository.ts";

export type ResolvedBillingSubject =
  | { readonly status: "unbound" }
  | { readonly status: "conflict" }
  | {
      readonly status: "ready";
      readonly binding: BillingSubjectBindingRecord;
      readonly provider: ProviderSubject;
    };

export async function resolveSubject(input: {
  athenaUserId: string;
  connectionId: string;
  provider: ProviderSubject["provider"];
  repository: BillingSubjectRepository;
}): Promise<ResolvedBillingSubject> {
  const subject: BillingSubjectRef = { id: input.athenaUserId, kind: "user" };
  const bindings = await input.repository.listActiveBindings({
    connectionId: input.connectionId,
    subject,
  });
  if (bindings.some((row) => row.status === "conflict")) {
    return { status: "conflict" };
  }
  const active = bindings.filter((row) => row.status === "active");
  if (active.length > 1) {
    return { status: "conflict" };
  }
  const binding = active[0];
  if (!binding) {
    return { status: "unbound" };
  }
  return {
    binding,
    provider: {
      connectionId: binding.connectionId,
      provider: input.provider,
      providerSubjectId: binding.providerSubjectId,
      providerSubjectKind: binding.providerSubjectKind,
    },
    status: "ready",
  };
}
