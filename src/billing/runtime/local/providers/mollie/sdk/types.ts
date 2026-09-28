import type {
  MollieSdkClient,
  MollieSdkClientOptions,
  MollieSdkConstructor,
} from "../../../../../providers/types.ts";

export type { MollieSdkClient, MollieSdkClientOptions, MollieSdkConstructor };

export interface MollieSdkResourceMethods {
  cancel?(request: Record<string, unknown>): Promise<unknown>;
  create?(request: Record<string, unknown>): Promise<unknown>;
  delete?(request: Record<string, unknown>): Promise<unknown>;
  get?(request: Record<string, unknown>): Promise<unknown>;
  list?(request: Record<string, unknown>): Promise<unknown>;
  update?(request: Record<string, unknown>): Promise<unknown>;
}

export interface MollieSdkResourceClient extends MollieSdkClient {
  customers: MollieSdkResourceMethods;
  invoices?: MollieSdkResourceMethods;
  paymentLinks: MollieSdkResourceMethods;
  payments: MollieSdkResourceMethods;
  refunds: MollieSdkResourceMethods;
  salesInvoices?: MollieSdkResourceMethods;
  subscriptions: MollieSdkResourceMethods;
  webhooks?: MollieSdkResourceMethods;
}
