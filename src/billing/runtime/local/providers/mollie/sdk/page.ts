import {
	embeddedListItems,
	nextCursorFromMolliePayload,
	type MollieListResource,
} from "../cursor.ts";
import { unwrapMollieSdkEntity } from "./invoke.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function firstEmbeddedKey(resource: MollieListResource): string[] {
	switch (resource) {
		case "payment-links":
			return ["payment_links", "paymentLinks"];
		case "invoices":
			return ["sales_invoices", "salesInvoices", "invoices"];
		default:
			return [resource];
	}
}

export async function readOneMollieSdkPage(
	result: unknown,
	resource: MollieListResource,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
	let page = result;
	if (
		page != null &&
		typeof page === "object" &&
		Symbol.asyncIterator in page
	) {
		const iterator = (page as AsyncIterable<unknown>)[Symbol.asyncIterator]();
		const first = await iterator.next();
		page = first.done ? undefined : first.value;
	}
	const entity = unwrapMollieSdkEntity(page);
	if (Array.isArray(entity)) {
		return { items: entity, nextCursor: null };
	}
	if (isRecord(entity) && Array.isArray(entity.items)) {
		return {
			items: entity.items,
			nextCursor: nextCursorFromMolliePayload(entity, resource),
		};
	}
	for (const key of firstEmbeddedKey(resource)) {
		const items = embeddedListItems(entity, key);
		if (items.length > 0) {
			return {
				items,
				nextCursor: nextCursorFromMolliePayload(entity, resource),
			};
		}
	}
	return {
		items: [],
		nextCursor: nextCursorFromMolliePayload(entity, resource),
	};
}
