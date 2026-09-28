import { decodeMollieListCursor } from "../../runtime/local/providers/mollie/cursor.ts";
import { mapGetCustomerToMollieSdk } from "../../runtime/local/providers/mollie/dialect/customers.ts";
import {
  callMollieSdk,
  clientFromPool,
} from "../../runtime/local/providers/mollie/sdk/call.ts";
import type { MollieSdkClientPool } from "../../runtime/local/providers/mollie/sdk/client-factory.ts";
import { readOneMollieSdkPage } from "../../runtime/local/providers/mollie/sdk/page.ts";
import type { BillingProviderExecutionContext } from "../../runtime/local/providers/types.ts";
import type {
  BillingImportCustomer,
  BillingImportCustomerPage,
} from "../types.ts";
import type { BillingCustomerImportPort } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null | undefined {
  if (value == null) {
    return value === undefined ? undefined : null;
  }
  return typeof value === "string" ? value : undefined;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return value;
}

export function projectMollieImportCustomer(
  raw: unknown
): BillingImportCustomer {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.trim() === "") {
    throw new Error("ATHENA_BILLING_IMPORT_PROVIDER_FAILED");
  }
  return {
    email: optionalString(raw.email),
    metadata: metadataRecord(raw.metadata),
    name: optionalString(raw.name),
    providerCustomerId: raw.id,
    raw,
  };
}

export function createMollieBillingCustomerImportPort(input: {
  connection?: {
    environment: "live" | "test";
    id: string;
    provider: string;
  };
  context: BillingProviderExecutionContext;
  pool: MollieSdkClientPool;
}): BillingCustomerImportPort {
  const connection = input.connection ?? {
    environment: input.context.environment.name,
    id: "unbound",
    provider: "mollie",
  };
  return {
    async getCustomer(getInput) {
      const bound = getInput.connection ?? connection;
      if (bound.provider !== "mollie") {
        throw new Error("ATHENA_BILLING_IMPORT_PROVIDER_FAILED");
      }
      const raw = await callMollieSdk({
        client: clientFromPool(input.pool, input.context),
        method: "get",
        operation: "customers.get",
        request: mapGetCustomerToMollieSdk({
          id: getInput.customerId,
        }),
        resource: "customers",
        unwrap: true,
      });
      return projectMollieImportCustomer(raw);
    },
    async listCustomers(page) {
      const from =
        page.cursor != null && page.cursor.length > 0
          ? decodeMollieListCursor(page.cursor, "customers")
          : undefined;
      const raw = await callMollieSdk({
        client: clientFromPool(input.pool, input.context),
        method: "list",
        operation: "customers.list",
        request: { from, limit: page.limit },
        resource: "customers",
        unwrap: false,
      });
      const listed = await readOneMollieSdkPage(
        raw,
        "customers",
        input.pool.apiBaseUrl()
      );
      const items: BillingImportCustomer[] = [];
      for (const item of listed.items) {
        items.push(projectMollieImportCustomer(item));
      }
      const result: BillingImportCustomerPage = {
        items,
        nextCursor: listed.nextCursor,
      };
      return result;
    },
  };
}
