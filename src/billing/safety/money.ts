import type { BillingMoney } from "../types.ts";

const MONEY_PATTERN = /^-?[0-9]+(\.[0-9]+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** Integer digits after leading-zero strip; Mollie string amounts stay bounded. */
const MAX_MONEY_INTEGER_DIGITS = 12;

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

function stripLeadingZeros(digits: string): string {
  let index = 0;
  while (index < digits.length - 1 && digits[index] === "0") {
    index += 1;
  }
  return digits.slice(index);
}

function scaledValue(raw: string, exponent: number): string {
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const dot = unsigned.indexOf(".");
  const intDigits = stripLeadingZeros(
    dot < 0 ? unsigned : unsigned.slice(0, dot)
  );
  const fracDigits = dot < 0 ? "" : unsigned.slice(dot + 1);
  if (intDigits.length > MAX_MONEY_INTEGER_DIGITS) {
    throw new Error("ATHENA_BILLING_MONEY_VALUE_INVALID");
  }
  if (fracDigits.length > exponent) {
    throw new Error("ATHENA_BILLING_MONEY_SCALE_INVALID");
  }
  const paddedFrac = fracDigits.padEnd(exponent, "0");
  const body = exponent === 0 ? intDigits : `${intDigits}.${paddedFrac}`;
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
  if (
    normalized.value.startsWith("-") ||
    digitsAreZero(intDigits + fracDigits)
  ) {
    throw new Error("ATHENA_BILLING_MONEY_NON_POSITIVE");
  }
  return normalized;
}

function moneyToMinorUnits(money: BillingMoney): {
  currency: string;
  exponent: number;
  minor: bigint;
} {
  const normalized = normalizeBillingMoney(money);
  const exponent = exponentForCurrency(normalized.currency);
  const negative = normalized.value.startsWith("-");
  const unsigned = negative ? normalized.value.slice(1) : normalized.value;
  const dot = unsigned.indexOf(".");
  const intDigits = dot < 0 ? unsigned : unsigned.slice(0, dot);
  const fracDigits = (dot < 0 ? "" : unsigned.slice(dot + 1)).padEnd(
    exponent,
    "0"
  );
  const digits = `${intDigits}${fracDigits}`;
  const minor = BigInt(digits.length === 0 ? "0" : digits);
  return {
    currency: normalized.currency,
    exponent,
    minor: negative ? -minor : minor,
  };
}

function moneyFromMinorUnits(input: {
  currency: string;
  exponent: number;
  minor: bigint;
}): BillingMoney {
  const negative = input.minor < 0n;
  const unsigned = negative ? -input.minor : input.minor;
  const digits = unsigned.toString().padStart(input.exponent + 1, "0");
  const split = digits.length - input.exponent;
  const intDigits = stripLeadingZeros(digits.slice(0, split));
  const fracDigits = digits.slice(split);
  const value =
    input.exponent === 0
      ? intDigits
      : `${intDigits}.${fracDigits}`;
  return {
    currency: input.currency,
    value: negative ? `-${value}` : value,
  };
}

export function addBillingMoney(
  left: BillingMoney,
  right: BillingMoney
): BillingMoney {
  const a = moneyToMinorUnits(left);
  const b = moneyToMinorUnits(right);
  if (a.currency !== b.currency) {
    throw new Error("ATHENA_BILLING_MONEY_CURRENCY_MISMATCH");
  }
  return moneyFromMinorUnits({
    currency: a.currency,
    exponent: a.exponent,
    minor: a.minor + b.minor,
  });
}

export function scaleBillingMoney(
  money: BillingMoney,
  quantity: number
): BillingMoney {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("ATHENA_BILLING_QUANTITY_INVALID");
  }
  const a = moneyToMinorUnits(money);
  return moneyFromMinorUnits({
    currency: a.currency,
    exponent: a.exponent,
    minor: a.minor * BigInt(quantity),
  });
}
