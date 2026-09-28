import type {
  BillingCancelPaymentInput,
  BillingCancelRefundInput,
  BillingCancelSubscriptionInput,
  BillingCatalogRelation,
  BillingCheckout,
  BillingConnectionRef,
  BillingCreateCheckoutInput,
  BillingCreateCustomerInput,
  BillingCreatePaymentInput,
  BillingCreatePaymentLinkInput,
  BillingCreateRefundInput,
  BillingCreateSubscriptionInput,
  BillingCreateWebhookInput,
  BillingCustomer,
  BillingDeleteCustomerInput,
  BillingDeletePaymentLinkInput,
  BillingDeleteWebhookInput,
  BillingExecutionTarget,
  BillingGetCustomerInput,
  BillingGetInvoiceInput,
  BillingGetPaymentInput,
  BillingGetPaymentLinkInput,
  BillingGetRefundInput,
  BillingGetSubscriptionInput,
  BillingGetWebhookInput,
  BillingInvoice,
  BillingListCustomersInput,
  BillingListInvoicesInput,
  BillingListPaymentLinksInput,
  BillingListPaymentsInput,
  BillingListPricesInput,
  BillingListProductsInput,
  BillingListRefundsInput,
  BillingListRelationsInput,
  BillingListSubscriptionsInput,
  BillingListWebhooksInput,
  BillingPayment,
  BillingPaymentLink,
  BillingPrice,
  BillingProduct,
  BillingRefund,
  BillingRuntimeMode,
  BillingSubscription,
  BillingTestWebhookInput,
  BillingUpdateCustomerInput,
  BillingUpdatePaymentLinkInput,
  BillingUpdateSubscriptionInput,
  BillingUpdateWebhookInput,
  BillingWebhook,
} from "../types.ts";
import type { BillingPlanChangeState } from "../workflows/plan-change/plan-change-state.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import type {
  BillingAdminConflictResolveResult,
  BillingAdminBootstrapRetryResult,
  BillingAdminConnectionMaterializeResult,
  BillingAdminIngestionHealth,
  BillingAdminPort,
  BillingAdminWebhookStatus,
} from "./admin/types.ts";
import type { BillingCapabilities, BillingOperation } from "./capabilities.ts";
import type { AthenaBillingHealth } from "./health.ts";
import type { BillingSelfCustomerView } from "./self/customer.ts";
import type { BillingEntitlementsSnapshot } from "./self/entitlements.ts";

export type {
  BillingAdminBootstrapRetryResult,
  BillingAdminConflictResolveResult,
  BillingAdminConnectionMaterializeResult,
  BillingAdminIngestionHealth,
  BillingAdminPort,
  BillingAdminWebhookStatus,
  BillingConnectionRef,
};

export interface BillingPage<T> {
  items: T[];
  nextCursor?: string | null;
  previousCursor?: string | null;
}

export interface BillingPaymentPort {
  cancel(input: BillingCancelPaymentInput): Promise<BillingPayment>;
  create(input: BillingCreatePaymentInput): Promise<BillingPayment>;
  get(input: BillingGetPaymentInput): Promise<BillingPayment>;
  list(input: BillingListPaymentsInput): Promise<BillingPage<BillingPayment>>;
}

export interface BillingCustomerPort {
  create(input: BillingCreateCustomerInput): Promise<BillingCustomer>;
  delete(input: BillingDeleteCustomerInput): Promise<void>;
  get(input: BillingGetCustomerInput): Promise<BillingCustomer>;
  list(input: BillingListCustomersInput): Promise<BillingPage<BillingCustomer>>;
  update(input: BillingUpdateCustomerInput): Promise<BillingCustomer>;
}

export interface BillingRefundPort {
  cancel(input: BillingCancelRefundInput): Promise<BillingRefund>;
  create(input: BillingCreateRefundInput): Promise<BillingRefund>;
  get(input: BillingGetRefundInput): Promise<BillingRefund>;
  list(input: BillingListRefundsInput): Promise<BillingPage<BillingRefund>>;
}

export interface BillingPaymentLinkPort {
  create(input: BillingCreatePaymentLinkInput): Promise<BillingPaymentLink>;
  delete(input: BillingDeletePaymentLinkInput): Promise<void>;
  get(input: BillingGetPaymentLinkInput): Promise<BillingPaymentLink>;
  list(
    input: BillingListPaymentLinksInput,
  ): Promise<BillingPage<BillingPaymentLink>>;
  update(input: BillingUpdatePaymentLinkInput): Promise<BillingPaymentLink>;
}

export interface BillingSubscriptionPort {
  cancel(input: BillingCancelSubscriptionInput): Promise<BillingSubscription>;
  create(input: BillingCreateSubscriptionInput): Promise<BillingSubscription>;
  get(input: BillingGetSubscriptionInput): Promise<BillingSubscription>;
  list(
    input: BillingListSubscriptionsInput,
  ): Promise<BillingPage<BillingSubscription>>;
  update(input: BillingUpdateSubscriptionInput): Promise<BillingSubscription>;
}

export interface BillingInvoicePort {
  get(input: BillingGetInvoiceInput): Promise<BillingInvoice>;
  list(input: BillingListInvoicesInput): Promise<BillingPage<BillingInvoice>>;
}

export interface BillingWebhookPort {
  create(input: BillingCreateWebhookInput): Promise<BillingWebhook>;
  delete(input: BillingDeleteWebhookInput): Promise<void>;
  get(input: BillingGetWebhookInput): Promise<BillingWebhook>;
  list(input: BillingListWebhooksInput): Promise<BillingPage<BillingWebhook>>;
  test(input: BillingTestWebhookInput): Promise<BillingWebhook>;
  update(input: BillingUpdateWebhookInput): Promise<BillingWebhook>;
}

export interface BillingProductPort {
  list(input: BillingListProductsInput): Promise<BillingPage<BillingProduct>>;
}

export interface BillingPricePort {
  list(input: BillingListPricesInput): Promise<BillingPage<BillingPrice>>;
}

export interface BillingRelationPort {
  list(
    input: BillingListRelationsInput,
  ): Promise<BillingPage<BillingCatalogRelation>>;
}

export interface BillingCheckoutPort {
  create(input: BillingCreateCheckoutInput): Promise<BillingCheckout>;
}

export interface BillingSelfListInput {
  limit?: number;
}

export interface BillingSelfPaymentView {
  amount: {
    currency: string;
    value: string;
  };
  createdAt: string;
  description?: string;
  id: string;
  paidAt?: string;
  priceId?: string;
  provider: "mollie" | "stripe";
  reference?: string;
  status: string;
}

export interface BillingSelfInvoiceGetInput {
  invoiceId: string;
}

export interface BillingSelfPaymentGetInput {
  paymentId: string;
}

export interface BillingSelfSubscriptionGetInput {
  subscriptionId?: string;
}

export interface BillingSelfSubscriptionCancelInput {
  subscriptionId: string;
}

export interface BillingSelfCheckoutLineInput {
  priceId: string;
  quantity?: number;
}

export interface BillingSelfCheckoutCreateInput {
  cancelUrl?: string;
  idempotencyKey: string;
  lines?: readonly BillingSelfCheckoutLineInput[];
  priceId?: string;
  successUrl?: string;
}

export interface BillingSelfCheckoutResumeInput {
  returnToken: string;
}

export type BillingSelfCheckoutKind = "one_off" | "subscription_enrollment";

export interface BillingSelfCheckoutResumeResult {
  checkout: {
    id: string;
    kind: BillingSelfCheckoutKind;
    priceId: string;
    status: string;
  };
  payment: BillingSelfPaymentView | null;
}

export type BillingSelfSubscriptionEnrollmentStatus =
  | "first_payment_required"
  | "enrolled"
  | "pending"
  | "failed";

export interface BillingSelfSubscriptionEnrollInput {
  cancelUrl?: string;
  idempotencyKey: string;
  priceId: string;
  successUrl?: string;
}

export interface BillingSelfSubscriptionEnrollResult {
  checkoutUrl?: string | null;
  enrollmentId: string;
  metadata: unknown;
  provider: BillingCheckout["provider"];
  status: BillingSelfSubscriptionEnrollmentStatus;
  subscription?: BillingSubscription;
}

export interface BillingSelfInvoicePort {
  get(input: BillingSelfInvoiceGetInput): Promise<BillingInvoice>;
  list(input?: BillingSelfListInput): Promise<BillingPage<BillingInvoice>>;
}

export interface BillingSelfPaymentPort {
  get(input: BillingSelfPaymentGetInput): Promise<BillingSelfPaymentView>;
  list(
    input?: BillingSelfListInput,
  ): Promise<BillingPage<BillingSelfPaymentView>>;
}

export interface BillingSelfSubscriptionChangeInput {
  currentVersion?: string;
  idempotencyKey: string;
  priceId: string;
  proration?: "none" | "immediate";
  subscriptionId?: string;
}

export type BillingSelfSubscriptionChangeStatus =
  | "attention_required"
  | "completed"
  | "failed"
  | "processing";

/**
 * Recurring plan-change poll result. Discriminate from a live subscription
 * with `"operationId" in result`. Public `status` is `processing`,
 * `completed`, `failed`, or `attention_required`. `state` is recovery
 * detail, not the app-facing contract.
 */
export interface BillingSelfSubscriptionChangeOperation {
  error?: string | null;
  operationId: string;
  priceId?: string;
  state: BillingPlanChangeState;
  status: BillingSelfSubscriptionChangeStatus;
  updatedAt?: string | null;
}

/** Immediate `BillingSubscription` or a pollable change operation. */
export type BillingSelfSubscriptionChangeResult =
  | BillingSelfSubscriptionChangeOperation
  | BillingSubscription;

export interface BillingSelfSubscriptionPort {
  cancel(
    input: BillingSelfSubscriptionCancelInput,
  ): Promise<BillingSubscription>;
  /**
   * Switch the live recurring catalog price. Caller-owned `idempotencyKey`.
   * Requires `billing.selfEnrollment.planChange: true`. May return a
   * subscription or a {@link BillingSelfSubscriptionChangeOperation}.
   */
  change(
    input: BillingSelfSubscriptionChangeInput,
  ): Promise<BillingSelfSubscriptionChangeResult>;
  enroll(
    input: BillingSelfSubscriptionEnrollInput,
  ): Promise<BillingSelfSubscriptionEnrollResult>;
  get(input?: BillingSelfSubscriptionGetInput): Promise<BillingSubscription>;
  /**
   * Poll `self.subscription.change` when the result includes `operationId`.
   * Branch on public `status` only.
   */
  getChangeOperation?(
    input: Pick<BillingSelfSubscriptionChangeOperation, "operationId">,
  ): Promise<BillingSelfSubscriptionChangeOperation>;
}

export interface BillingSelfCheckoutPort {
  create(input: BillingSelfCheckoutCreateInput): Promise<BillingCheckout>;
  resume(
    input: BillingSelfCheckoutResumeInput,
  ): Promise<BillingSelfCheckoutResumeResult>;
}

export interface BillingSelfCustomerPort {
  get(input?: Record<string, unknown>): Promise<BillingSelfCustomerView>;
}

export interface BillingSelfPort {
  readonly checkout: BillingSelfCheckoutPort;
  readonly customer: BillingSelfCustomerPort;
  readonly entitlements: (
    input?: Record<string, unknown>,
  ) => Promise<BillingEntitlementsSnapshot>;
  readonly invoices: BillingSelfInvoicePort;
  readonly payments: BillingSelfPaymentPort;
  readonly subscription: BillingSelfSubscriptionPort;
}

export interface BillingCatalogPort {
  readonly prices: BillingPricePort;
  readonly products: BillingProductPort;
  readonly relations: BillingRelationPort;
}

export type BillingRuntimeDispatchOperation =
  | BillingOperation
  | "getCapabilities";

export interface AthenaBillingRuntime {
  readonly admin: BillingAdminPort;
  readonly checkout: BillingCheckoutPort;
  readonly customers: BillingCustomerPort;

  getCapabilities(
    input: BillingExecutionTarget,
    principal?: AthenaPrincipal,
  ): Promise<BillingCapabilities>;
  health(): Promise<AthenaBillingHealth>;
  readonly invoices: BillingInvoicePort;
  readonly mode: BillingRuntimeMode;
  readonly paymentLinks: BillingPaymentLinkPort;
  readonly payments: BillingPaymentPort;
  readonly prices: BillingPricePort;
  readonly products: BillingProductPort;
  readonly relations: BillingRelationPort;
  readonly refunds: BillingRefundPort;
  readonly self: BillingSelfPort;
  readonly subscriptions: BillingSubscriptionPort;
  readonly webhooks: BillingWebhookPort;
}
