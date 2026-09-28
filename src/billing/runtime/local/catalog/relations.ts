import type { BillingCatalogRelation } from "../../../types.ts";
import type { BillingPage } from "../../types.ts";
import type {
  BillingProviderExecutionContext,
  BillingProviderListInput,
  BillingRelationsPort,
} from "../providers/types.ts";
import { pageAthenaCatalogItems } from "./page.ts";

export class AthenaBillingRelationsPort implements BillingRelationsPort {
  readonly kind = "relations" as const;

  constructor(private readonly relations: readonly BillingCatalogRelation[]) {}

  async list(
    _context: BillingProviderExecutionContext,
    input: BillingProviderListInput & { sourceProductId?: string }
  ): Promise<BillingPage<BillingCatalogRelation>> {
    const filtered =
      input.sourceProductId != null && input.sourceProductId.length > 0
        ? this.relations.filter(
            (relation) => relation.sourceProductId === input.sourceProductId
          )
        : this.relations;
    return pageAthenaCatalogItems(filtered, input, "relations");
  }
}

export function createAthenaBillingRelationsPort(
  relations: readonly BillingCatalogRelation[]
): BillingRelationsPort {
  return new AthenaBillingRelationsPort(relations);
}
