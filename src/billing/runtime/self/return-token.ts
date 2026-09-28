import { createHash, randomBytes } from "node:crypto";

export {
  ATHENA_BILLING_RETURN_QUERY,
  appendBillingReturnToken,
} from "./return-query.ts";

export function hashBillingReturnNonce(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createBillingReturnNonce(): {
  hash: string;
  token: string;
} {
  const token = randomBytes(32).toString("base64url");
  return { hash: hashBillingReturnNonce(token), token };
}
