import type {
  BillingImportCustomer,
  BillingImportCustomerPage,
} from "../types.ts";

export interface BillingCustomerImportPort {
  getCustomer?(input: {
    connection?: {
      environment: "live" | "test";
      id: string;
      provider: string;
    };
    customerId: string;
  }): Promise<BillingImportCustomer>;
  listCustomers(input: {
    cursor?: string;
    limit?: number;
  }): Promise<BillingImportCustomerPage>;
}

export interface BillingCustomerReconciliationProvider {
  getCustomer(input: {
    connection: {
      environment: "live" | "test";
      id: string;
      provider: string;
    };
    customerId: string;
  }): Promise<BillingImportCustomer>;
  listCustomers(input: {
    cursor?: string;
    limit?: number;
  }): Promise<BillingImportCustomerPage>;
}
