import { ATHENA_AUTH_ERROR_DESCRIPTORS } from "./generated/auth.ts";
import { ATHENA_BILLING_ERROR_DESCRIPTORS } from "./generated/billing.ts";
import { ATHENA_CHAT_ERROR_DESCRIPTORS } from "./generated/chat.ts";
import { ATHENA_DATA_ERROR_DESCRIPTORS } from "./generated/data.ts";
import { ATHENA_GATEWAY_ERROR_DESCRIPTORS } from "./generated/gateway.ts";
import { ATHENA_INTERNAL_ERROR_DESCRIPTORS } from "./generated/internal.ts";
import { ATHENA_NOTIFICATIONS_ERROR_DESCRIPTORS } from "./generated/notifications.ts";
import { ATHENA_POLICY_ERROR_DESCRIPTORS } from "./generated/policy.ts";
import { ATHENA_STORAGE_ERROR_DESCRIPTORS } from "./generated/storage.ts";
import { ATHENA_WEBHOOK_ERROR_DESCRIPTORS } from "./generated/webhook.ts";
import type { AthenaErrorDomain, AthenaErrorIR } from "./ir.ts";

const DESCRIPTORS: ReadonlyMap<string, AthenaErrorIR> = new Map(
  [
    ...ATHENA_AUTH_ERROR_DESCRIPTORS,
    ...ATHENA_BILLING_ERROR_DESCRIPTORS,
    ...ATHENA_CHAT_ERROR_DESCRIPTORS,
    ...ATHENA_DATA_ERROR_DESCRIPTORS,
    ...ATHENA_GATEWAY_ERROR_DESCRIPTORS,
    ...ATHENA_INTERNAL_ERROR_DESCRIPTORS,
    ...ATHENA_NOTIFICATIONS_ERROR_DESCRIPTORS,
    ...ATHENA_POLICY_ERROR_DESCRIPTORS,
    ...ATHENA_STORAGE_ERROR_DESCRIPTORS,
    ...ATHENA_WEBHOOK_ERROR_DESCRIPTORS,
  ].map((descriptor) => [`${descriptor.domain}:${descriptor.code}`, descriptor])
);
const DESCRIPTOR_LIST = [...DESCRIPTORS.values()];
const DESCRIPTORS_BY_CODE: ReadonlyMap<string, AthenaErrorIR> = new Map(
  DESCRIPTOR_LIST.map((descriptor) => [descriptor.code, descriptor])
);

export function errorDescriptor(
  domain: AthenaErrorDomain,
  code: string
): AthenaErrorIR | undefined {
  return DESCRIPTORS.get(`${domain}:${normalizeCatalogCode(domain, code)}`);
}

export function normalizeCatalogCode(
  domain: AthenaErrorDomain,
  code: string
): string {
  const normalized = code.trim().toLowerCase();
  const withoutAthenaPrefix = normalized.startsWith("athena_")
    ? normalized.slice("athena_".length)
    : normalized;
  if (domain === "internal") {
    return withoutAthenaPrefix;
  }
  const domainPrefix = `${domain}_`;
  if (withoutAthenaPrefix.startsWith(domainPrefix)) {
    return withoutAthenaPrefix;
  }
  return `${domainPrefix}${withoutAthenaPrefix}`;
}

export function storageErrorDescriptor(
  code: string
): AthenaErrorIR<string, "storage"> | undefined {
  return errorDescriptor("storage", code) as
    | AthenaErrorIR<string, "storage">
    | undefined;
}

export function dataErrorDescriptor(
  code: string
): AthenaErrorIR<string, "data"> | undefined {
  return errorDescriptor("data", code) as
    | AthenaErrorIR<string, "data">
    | undefined;
}

export function errorDescriptorForPublicCode(
  code: string
): AthenaErrorIR | undefined {
  return DESCRIPTORS_BY_CODE.get(code.trim().toLowerCase());
}

export function isCatalogErrorCode(code: string): boolean {
  return DESCRIPTORS_BY_CODE.has(code.trim().toLowerCase());
}

export function errorDescriptorsForDomain(
  domain: AthenaErrorDomain
): readonly AthenaErrorIR[] {
  return DESCRIPTOR_LIST.filter((descriptor) => descriptor.domain === domain);
}
