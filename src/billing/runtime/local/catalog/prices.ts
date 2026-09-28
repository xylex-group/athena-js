import type { BillingPrice } from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type {
  BillingPricesPort,
  BillingProviderExecutionContext,
  BillingProviderListInput,
} from "../providers/types.ts";
import { pageAthenaCatalogItems } from "./page.ts";

export class AthenaBillingPricesPort implements BillingPricesPort {
  readonly kind = "prices" as const;

  constructor(private readonly prices: readonly BillingPrice[]) {}

  async list(
    _context: BillingProviderExecutionContext,
    input: BillingProviderListInput & { productId?: string }
  ): Promise<BillingPage<BillingPrice>> {
    const filtered =
      input.productId != null && input.productId.length > 0
        ? this.prices.filter((price) => price.productId === input.productId)
        : this.prices;
    return pageAthenaCatalogItems(filtered, input, "prices");
  }
}

export function createAthenaBillingPricesPort(
  prices: readonly BillingPrice[]
): BillingPricesPort {
  return new AthenaBillingPricesPort(prices);
}
