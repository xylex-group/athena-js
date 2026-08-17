/**
 * Compile-time type assertions for Policy DSL (T2).
 * Not executed at runtime — included in typecheck project if referenced.
 */
import { number, string, table } from "../src/index.ts";
import { policy } from "../src/policy/index.ts";

const invoices = table("invoices")
	.schema("public")
	.columns({
		amount: number(),
		id: string().generated(),
		userId: string().from("user_id"),
	})
	.primaryKey("id");

// Valid: known column + subject
policy(invoices, {
	select: {
		allow: ({ row, auth }) => row.userId.eq(auth.userId),
	},
});

// Valid: numeric compare
policy(invoices, {
	select: {
		allow: ({ row }) => row.amount.gt(0),
	},
});

policy(invoices, {
	select: {
		allow: ({ row, auth }) =>
			// @ts-expect-error — unknown column must fail typecheck (T2)
			row.notAColumn.eq(auth.userId),
	},
});
