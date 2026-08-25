import type { BillingMoney } from "../types.ts";

const MONEY_PATTERN = /^-?[0-9]+(\.[0-9]+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** ISO-4217 minor units for codes whose exponent is not 2. */
const ISO_4217_MINOR_UNITS: Record<string, number> = {
	BHD: 3,
	BIF: 0,
	CLF: 4,
	CLP: 0,
	DJF: 0,
	GNF: 0,
	IQD: 3,
	ISK: 0,
	JOD: 3,
	JPY: 0,
	KMF: 0,
	KRW: 0,
	KWD: 3,
	LYD: 3,
	OMR: 3,
	PYG: 0,
	RWF: 0,
	TND: 3,
	UGX: 0,
	UYI: 0,
	UYW: 4,
	VND: 0,
	VUV: 0,
	XAF: 0,
	XOF: 0,
	XPF: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function exponentForCurrency(currency: string): number {
	return ISO_4217_MINOR_UNITS[currency] ?? 2;
}

function digitsAreZero(digits: string): boolean {
	for (const ch of digits) {
		if (ch !== "0") {
			return false;
		}
	}
	return true;
}

export function parseBillingMoney(value: unknown): BillingMoney {
	if (!isRecord(value)) {
		throw new Error("ATHENA_BILLING_MONEY_INVALID");
	}
	if (typeof value.currency !== "string" || typeof value.value !== "string") {
		throw new Error("ATHENA_BILLING_MONEY_INVALID");
	}
	const currency = value.currency.trim().toUpperCase();
	if (!CURRENCY_PATTERN.test(currency)) {
		throw new Error("ATHENA_BILLING_MONEY_CURRENCY_INVALID");
	}
	const raw = value.value.trim();
	if (!MONEY_PATTERN.test(raw)) {
		throw new Error("ATHENA_BILLING_MONEY_VALUE_INVALID");
	}
	return { currency, value: raw };
}

function scaledValue(raw: string, exponent: number): string {
	const negative = raw.startsWith("-");
	const unsigned = negative ? raw.slice(1) : raw;
	const dot = unsigned.indexOf(".");
	const intDigits = dot < 0 ? unsigned : unsigned.slice(0, dot);
	const fracDigits = dot < 0 ? "" : unsigned.slice(dot + 1);
	if (fracDigits.length > exponent) {
		throw new Error("ATHENA_BILLING_MONEY_SCALE_INVALID");
	}
	const paddedFrac = fracDigits.padEnd(exponent, "0");
	const body =
		exponent === 0 ? intDigits : `${intDigits}.${paddedFrac}`;
	return negative ? `-${body}` : body;
}

export function normalizeBillingMoney(value: unknown): BillingMoney {
	const parsed = parseBillingMoney(value);
	const exponent = exponentForCurrency(parsed.currency);
	return {
		currency: parsed.currency,
		value: scaledValue(parsed.value, exponent),
	};
}

export function assertBillingMoney(value: unknown): BillingMoney {
	const normalized = normalizeBillingMoney(value);
	const unsigned = normalized.value.startsWith("-")
		? normalized.value.slice(1)
		: normalized.value;
	const dot = unsigned.indexOf(".");
	const intDigits = dot < 0 ? unsigned : unsigned.slice(0, dot);
	const fracDigits = dot < 0 ? "" : unsigned.slice(dot + 1);
	if (normalized.value.startsWith("-") || digitsAreZero(intDigits + fracDigits)) {
		throw new Error("ATHENA_BILLING_MONEY_NON_POSITIVE");
	}
	return normalized;
}
