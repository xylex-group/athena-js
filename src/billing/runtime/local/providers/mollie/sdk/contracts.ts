import type {
	MollieSdkAdapterFactory,
	MollieSdkClient,
	MollieSdkClientOptions,
	MollieSdkConstructor,
	MollieSdkResourcePort,
} from "../../../../../providers/types.ts";

export type {
	MollieSdkAdapterFactory,
	MollieSdkClient,
	MollieSdkClientOptions,
	MollieSdkConstructor,
	MollieSdkResourcePort,
};

export const MOLLIE_SDK_REQUIRED_RESOURCES = [
	"payments",
	"customers",
	"refunds",
	"paymentLinks",
	"subscriptions",
] as const;

export type MollieSdkRequiredResource =
	(typeof MOLLIE_SDK_REQUIRED_RESOURCES)[number];

/** Methods Athena actually invokes on each required resource. */
export const MOLLIE_SDK_REQUIRED_METHODS = {
	customers: ["create", "delete", "get", "list", "update"],
	paymentLinks: ["create", "delete", "get", "list", "update"],
	payments: ["cancel", "create", "get", "list"],
	refunds: ["cancel", "create", "get", "list"],
	subscriptions: ["cancel", "create", "get", "list", "update"],
} as const satisfies Record<MollieSdkRequiredResource, readonly string[]>;

export const MOLLIE_SDK_INVOICE_REQUIRED_METHODS = ["get", "list"] as const;
