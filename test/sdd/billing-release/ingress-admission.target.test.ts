/**
 * RED: production Billing ingress requires a binding token before DB/provider work.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { combinedBillingSql, readSrc } from "./helpers.ts";

test("bare webhook routes do not fall through without a connection binding", () => {
  const handlers = readSrc("next", "billing-ingress-handlers.ts");
  assert.match(handlers, /allowBareWebhookIngress/);
  assert.doesNotMatch(handlers, /if \(token == null\) \{\s*return undefined;/);
});

test("admission exists before compileHttpWebhookIngress / ingest", () => {
  const handlers = readSrc("next", "billing-ingress-handlers.ts");
  assert.match(handlers, /BillingIngressAdmission|admitBillingIngress/);
  const admit = handlers.search(/admitBillingIngress|BillingIngressAdmission/);
  const compile = handlers.indexOf("compileHttpWebhookIngress");
  assert.ok(admit >= 0 && admit < compile);
});

test("hashed ingress bindings are the lookup identity", () => {
  const sql = combinedBillingSql();
  assert.match(sql, /billing_webhook_ingress_bindings/);
  assert.match(sql, /token_hash/);
  assert.equal(
    readSrc("billing", "import", "postgres.ts").includes(
      "metadata->>'webhookIngressToken'"
    ),
    false
  );
});

test("ingress handlers do not resolve connections through raw pool executors", () => {
  const handlers = readSrc("next", "billing-ingress-handlers.ts");
  assert.equal(handlers.includes("createBillingSqlExecutor(pool)"), false);
  assert.equal(handlers.includes("getPool()"), false);
});
