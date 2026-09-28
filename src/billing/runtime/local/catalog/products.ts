import type { BillingProduct } from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type {
  BillingProductsPort,
  BillingProviderExecutionContext,
  BillingProviderListInput,
} from "../providers/types.ts";
import { pageAthenaCatalogItems } from "./page.ts";

export class AthenaBillingProductsPort implements BillingProductsPort {
  readonly kind = "products" as const;

  constructor(private readonly products: readonly BillingProduct[]) {}

  async list(
    _context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingProduct>> {
    return pageAthenaCatalogItems(this.products, input, "products");
  }
}

export function createAthenaBillingProductsPort(
  products: readonly BillingProduct[]
): BillingProductsPort {
  return new AthenaBillingProductsPort(products);
}
