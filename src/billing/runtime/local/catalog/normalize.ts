import {
  ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
  AthenaBillingProviderError,
} from "../../../errors.ts";
import { normalizeBillingMoney } from "../../../safety/money.ts";
import type {
  AthenaBillingCatalogConfig,
  AthenaBillingCatalogRelationConstraints,
  BillingCatalogRelation,
  BillingCatalogRelationType,
  BillingPrice,
  BillingProduct,
} from "../../../types.ts";
import { BILLING_CATALOG_RELATION_TYPES } from "../../../types.ts";

export interface NormalizedAthenaBillingCatalog {
  prices: readonly BillingPrice[] | null;
  products: readonly BillingProduct[] | null;
  relations: readonly BillingCatalogRelation[] | null;
}

function nonEmptyId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message: `billing.catalog ${label} requires a non-empty id.`,
    });
  }
  return value.trim();
}

function isRelationType(value: unknown): value is BillingCatalogRelationType {
  return (
    typeof value === "string" &&
    (BILLING_CATALOG_RELATION_TYPES as readonly string[]).includes(value)
  );
}

function normalizeRelationConstraints(
  value: unknown,
  relationId: string
): AthenaBillingCatalogRelationConstraints | undefined {
  if (value == null) {
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message: `billing.catalog relation ${relationId} constraints must be an object.`,
    });
  }
  const record = value as Record<string, unknown>;
  const constraints: AthenaBillingCatalogRelationConstraints = {};
  if (record.jurisdictions != null) {
    if (
      !Array.isArray(record.jurisdictions) ||
      record.jurisdictions.some(
        (entry) => typeof entry !== "string" || entry.trim().length === 0
      )
    ) {
      throw new AthenaBillingProviderError({
        code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
        message: `billing.catalog relation ${relationId} jurisdictions must be non-empty strings.`,
      });
    }
    constraints.jurisdictions = record.jurisdictions.map((entry) =>
      String(entry).trim()
    );
  }
  if (record.minQuantityContext != null) {
    if (
      typeof record.minQuantityContext !== "number" ||
      !Number.isInteger(record.minQuantityContext) ||
      record.minQuantityContext < 1
    ) {
      throw new AthenaBillingProviderError({
        code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
        message: `billing.catalog relation ${relationId} minQuantityContext must be a positive integer.`,
      });
    }
    constraints.minQuantityContext = record.minQuantityContext;
  }
  if (record.maxQuantityContext != null) {
    if (
      typeof record.maxQuantityContext !== "number" ||
      !Number.isInteger(record.maxQuantityContext) ||
      record.maxQuantityContext < 1
    ) {
      throw new AthenaBillingProviderError({
        code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
        message: `billing.catalog relation ${relationId} maxQuantityContext must be a positive integer.`,
      });
    }
    constraints.maxQuantityContext = record.maxQuantityContext;
  }
  if (
    constraints.minQuantityContext != null &&
    constraints.maxQuantityContext != null &&
    constraints.minQuantityContext > constraints.maxQuantityContext
  ) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message: `billing.catalog relation ${relationId} minQuantityContext cannot exceed maxQuantityContext.`,
    });
  }
  return constraints;
}

export function normalizeAthenaBillingCatalog(
  catalog?: AthenaBillingCatalogConfig
): NormalizedAthenaBillingCatalog | undefined {
  if (catalog == null) {
    return;
  }
  const productsConfigured = Array.isArray(catalog.products);
  const pricesConfigured = Array.isArray(catalog.prices);
  const relationsConfigured = Array.isArray(catalog.relations);
  if (!(productsConfigured || pricesConfigured || relationsConfigured)) {
    return;
  }

  const products: BillingProduct[] = [];
  const productIds = new Set<string>();
  if (productsConfigured) {
    for (const entry of catalog.products ?? []) {
      const id = nonEmptyId(entry.id, "product");
      if (productIds.has(id)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog product id ${id} is duplicated.`,
        });
      }
      if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog product ${id} requires a name.`,
        });
      }
      productIds.add(id);
      products.push({
        description: entry.description,
        id,
        metadata: entry.metadata ?? {},
        name: entry.name.trim(),
        raw: entry,
      });
    }
  }

  const prices: BillingPrice[] = [];
  const priceIds = new Set<string>();
  if (pricesConfigured) {
    for (const entry of catalog.prices ?? []) {
      const id = nonEmptyId(entry.id, "price");
      if (priceIds.has(id)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog price id ${id} is duplicated.`,
        });
      }
      const productId = nonEmptyId(entry.productId, "price.productId");
      if (productsConfigured && !productIds.has(productId)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog price ${id} references unknown product ${productId}.`,
        });
      }
      priceIds.add(id);
      prices.push({
        amount: normalizeBillingMoney(entry.amount),
        id,
        interval: entry.interval,
        metadata: entry.metadata ?? {},
        productId,
        raw: entry,
      });
    }
  }

  const relations: BillingCatalogRelation[] = [];
  const relationIds = new Set<string>();
  if (relationsConfigured) {
    if (!productsConfigured) {
      throw new AthenaBillingProviderError({
        code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
        message: "billing.catalog relations require products.",
      });
    }
    for (const entry of catalog.relations ?? []) {
      const id = nonEmptyId(entry.id, "relation");
      if (relationIds.has(id)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog relation id ${id} is duplicated.`,
        });
      }
      if (!isRelationType(entry.type)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog relation ${id} has unsupported type.`,
        });
      }
      const sourceProductId = nonEmptyId(
        entry.sourceProductId,
        "relation.sourceProductId"
      );
      const targetProductId = nonEmptyId(
        entry.targetProductId,
        "relation.targetProductId"
      );
      if (!productIds.has(sourceProductId)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog relation ${id} references unknown source product ${sourceProductId}.`,
        });
      }
      if (!productIds.has(targetProductId)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog relation ${id} references unknown target product ${targetProductId}.`,
        });
      }
      if (sourceProductId === targetProductId) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
          message: `billing.catalog relation ${id} cannot target its source product.`,
        });
      }
      relationIds.add(id);
      relations.push({
        constraints: normalizeRelationConstraints(entry.constraints, id),
        id,
        metadata: entry.metadata ?? {},
        raw: entry,
        sourceProductId,
        targetProductId,
        type: entry.type,
      });
    }
  }

  return {
    prices: pricesConfigured ? prices : null,
    products: productsConfigured ? products : null,
    relations: relationsConfigured ? relations : null,
  };
}
