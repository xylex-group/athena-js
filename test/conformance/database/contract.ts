/**
 * Backend-neutral database capability contract.
 * Every advertised `true` layer must have an executable proof.
 * Every advertised `false` layer must fail closed (no HTTP fallback).
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaClientCapabilities } from "../../../src/cloudflare/types.ts";
import type { AthenaResult } from "../../../src/client-result.ts";
import type { AthenaRpcPayload } from "../../../src/gateway/types.ts";

export interface DatabaseConformanceCompileProof {
  text: string;
  values: unknown[];
}

export interface DatabaseConformanceHarness {
  capabilities: AthenaClientCapabilities;
  client?: {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => Promise<AthenaResult>;
      select: (columns?: string) => Promise<AthenaResult>;
    };
    query: (sql: string) => Promise<AthenaResult>;
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<AthenaResult>;
  };
  compileFetch?: (payload: {
    table_name: string;
    conditions?: Array<{ column: string; operator: string; value: unknown }>;
  }) => DatabaseConformanceCompileProof;
  compileRelation?: () => DatabaseConformanceCompileProof;
  compileRpc?: (payload: AthenaRpcPayload) => DatabaseConformanceCompileProof;
  fetchNested?: () => Promise<{ message?: string; ok: boolean }>;
  name: string;
}

const LAYER_KEYS = [
  "flatCrud",
  "findManyAst",
  "query",
  "relations",
  "rpc",
] as const;

export function runDatabaseConformance(
  harness: DatabaseConformanceHarness
): void {
  const layers = harness.capabilities.db.layers;
  const prefix = `conformance/${harness.name}`;

  test(`${prefix}: advertised layers are booleans`, () => {
    for (const key of LAYER_KEYS) {
      assert.equal(typeof layers[key], "boolean", key);
    }
  });

  test(`${prefix}: capability truth has a proof for every true layer`, () => {
    if (layers.flatCrud) {
      assert.ok(
        harness.client || harness.compileFetch,
        `${prefix} flatCrud requires a client or compileFetch proof`
      );
    }
    if (layers.query) {
      assert.ok(
        harness.client || harness.compileFetch,
        `${prefix} query requires a client or compileFetch proof`
      );
    }
    if (layers.rpc) {
      assert.ok(
        harness.compileRpc,
        `${prefix} rpc:true requires compileRpc proof`
      );
    }
    if (layers.findManyAst || layers.relations) {
      assert.ok(
        harness.compileRelation || harness.fetchNested,
        `${prefix} AST/relations require compile or fetch proof`
      );
    }
  });

  if (layers.flatCrud && harness.compileFetch) {
    test(`${prefix}: flat fetch compiles bound predicates`, () => {
      const compiled = harness.compileFetch?.({
        conditions: [{ column: "email", operator: "eq", value: "a@b.c" }],
        table_name: "users",
      });
      assert.ok(compiled);
      assert.match(compiled.text, /SELECT /);
      assert.match(compiled.text, /\$1|\?/);
      assert.deepEqual(compiled.values, ["a@b.c"]);
    });
  }

  if (layers.flatCrud && harness.client) {
    test(`${prefix}: insert is executable`, async () => {
      const result = await harness.client?.from("users").insert({
        email: "conformance@example.com",
      });
      assert.equal(result?.error, null, result?.error?.message);
    });

    test(`${prefix}: select is executable`, async () => {
      const result = await harness.client?.from("users").select("id");
      assert.equal(result?.error, null, result?.error?.message);
    });
  }

  if (layers.query && harness.client) {
    test(`${prefix}: raw query is executable`, async () => {
      const result = await harness.client?.query("SELECT 1 AS ok");
      assert.equal(result?.error, null, result?.error?.message);
    });
  }

  if (layers.rpc) {
    test(`${prefix}: rpc identifiers are quoted and args are bound`, () => {
      const compile = harness.compileRpc;
      assert.ok(compile);
      const compiled = compile({
        args: { seed: "1); DROP TABLE users;--" },
        function: "score",
        schema: "app",
      });
      assert.equal(
        compiled.text,
        'SELECT * FROM "app"."score"("seed" => $1)'
      );
      assert.equal(compiled.text.includes("DROP TABLE"), false);
      assert.deepEqual(compiled.values, ["1); DROP TABLE users;--"]);
    });
  } else if (harness.client) {
    test(`${prefix}: rpc is fail-closed`, async () => {
      const result = await harness.client?.rpc("nope", {});
      assert.ok(result?.error, "rpc:false must return a stable error");
      assert.match(
        String(result?.error.message ?? ""),
        /unsupported|not supported|RPC/i
      );
    });
  }

  if ((layers.findManyAst || layers.relations) && harness.compileRelation) {
    test(`${prefix}: relation / AST compile is executable`, () => {
      const compiled = harness.compileRelation?.();
      assert.ok(compiled);
      assert.ok(compiled.text.length > 0);
      assert.doesNotMatch(compiled.text, /unsupported/i);
    });
  }

  if ((layers.findManyAst || layers.relations) && harness.fetchNested) {
    test(`${prefix}: nested relation fetch is not unsupported`, async () => {
      const response = await harness.fetchNested?.();
      assert.ok(response);
      assert.equal(response.ok, true, response.message);
      assert.doesNotMatch(String(response.message ?? ""), /unsupported/i);
    });
  }
}
