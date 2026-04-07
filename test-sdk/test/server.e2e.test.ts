import { strict as assert } from "assert";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import dotenv from "dotenv";
import { createAthenaTestSdkServer } from "../src/server.ts";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const ATHENA_URL =
  process.env.ATHENA_URL_E2E ??
  process.env.ATHENA_URL ??
  "http://localhost:4052";
const ATHENA_API_KEY =
  process.env.ATHENA_API_KEY_E2E ?? process.env.ATHENA_API_KEY ?? "x";
const ATHENA_CLIENT =
  process.env.ATHENA_CLIENT_E2E ??
  process.env.ATHENA_CLIENT ??
  "athena_logging";
const ATHENA_TABLE = process.env.ATHENA_TABLE_E2E ?? "test";

async function startServer() {
  const appServer = createAthenaTestSdkServer({
    config: {
      athenaUrl: ATHENA_URL,
      athenaApiKey: ATHENA_API_KEY,
      athenaClient: ATHENA_CLIENT,
    },
  });

  return await new Promise<{
    close: () => Promise<void>;
    baseUrl: string;
  }>((resolve) => {
    const server = appServer.expressApp.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) closeReject(error);
              else closeResolve();
            });
          }),
      });
    });
  });
}

async function httpJson<T>(
  baseUrl: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!text) {
    throw new Error(`Expected JSON response for ${method} ${path}`);
  }
  const json = JSON.parse(text) as T;
  return { response, json };
}

test("test-sdk e2e: GET /health returns sdk status payload", async () => {
  const server = await startServer();
  try {
    const { response, json } = await httpJson<{
      ok: boolean;
      sdk: string;
      responseTimeMs: number;
    }>(server.baseUrl, "GET", "/health");

    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.sdk, "athena-js");
    assert.equal(typeof json.responseTimeMs, "number");
  } finally {
    await server.close();
  }
});

test("test-sdk e2e: GET /table/:name reads rows from live Athena", async () => {
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{ data: unknown[] | null }>(
      server.baseUrl,
      "GET",
      `/table/${ATHENA_TABLE}?limit=1&offset=0`,
    );

    assert.equal(
      response.status,
      200,
      `expected live Athena table read to succeed for table '${ATHENA_TABLE}' via ${ATHENA_URL}`,
    );
    assert.ok(Array.isArray(json.data), "expected data to be an array");
  } finally {
    await server.close();
  }
});

test("test-sdk e2e: validation errors are normalized with code and details", async () => {
  const server = await startServer();

  try {
    const { response, json } = await httpJson<{
      error: {
        code: string;
        message: string;
        details: Record<string, unknown> | null;
      };
      responseTimeMs: number;
    }>(server.baseUrl, "GET", "/table/characters?limit=not-a-number");

    assert.equal(response.status, 400);
    assert.equal(json.error.code, "VALIDATION_ERROR");
    assert.equal(json.error.details?.field, "limit");
  } finally {
    await server.close();
  }
});

test("test-sdk e2e: Athena gateway failures are surfaced with ATHENA_GATEWAY_ERROR", async () => {
  const server = await startServer();

  try {
    const missingFunctionName = `missing_rpc_${Date.now()}`;
    const { response, json } = await httpJson<{
      error: {
        code: string;
        message: string;
        details: {
          gatewayStatus: number;
          gatewayErrorDetails: Record<string, unknown> | null;
        };
      };
    }>(server.baseUrl, "POST", `/rpc/${missingFunctionName}`, {
      args: { role: "admin" },
    });

    assert.ok(
      response.status >= 400,
      "expected rpc call to fail through Athena gateway",
    );
    assert.equal(json.error.code, "ATHENA_GATEWAY_ERROR");
    assert.ok(json.error.message.length > 0);
    assert.ok(
      json.error.details.gatewayStatus === response.status ||
        json.error.details.gatewayStatus === 0,
      "expected gatewayStatus to match upstream status or 0 when upstream is unreachable",
    );
    assert.ok(
      json.error.details.gatewayErrorDetails === null ||
        typeof json.error.details.gatewayErrorDetails === "object",
    );
  } finally {
    await server.close();
  }
});
