import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  isAthenaDevelopmentDiagnosticsEnvironment,
  isQuietAthenaDiagnosticsEnvironment,
  resolveAthenaClientDiagnostics,
} from "../src/diagnostics.ts";

test("isQuietAthenaDiagnosticsEnvironment detects production and OpenNext", () => {
  assert.equal(
    isQuietAthenaDiagnosticsEnvironment({ NODE_ENV: "production" }),
    true
  );
  assert.equal(
    isQuietAthenaDiagnosticsEnvironment({ OPENNEXT_BUILD: "1" }),
    true
  );
  assert.equal(
    isQuietAthenaDiagnosticsEnvironment({
      NEXT_PHASE: "phase-production-build",
    }),
    true
  );
  assert.equal(
    isQuietAthenaDiagnosticsEnvironment({ NODE_ENV: "development" }),
    false
  );
});

test("development diagnostics require an explicit development signal", () => {
  assert.equal(
    isAthenaDevelopmentDiagnosticsEnvironment({ NODE_ENV: "development" }),
    true
  );
  assert.equal(
    isAthenaDevelopmentDiagnosticsEnvironment({ NODE_ENV: "test" }),
    true
  );
  assert.equal(isAthenaDevelopmentDiagnosticsEnvironment({}), false);
  assert.equal(
    isAthenaDevelopmentDiagnosticsEnvironment({
      NODE_ENV: "development",
      OPENNEXT_BUILD: "1",
    }),
    false
  );
});

test("resolveAthenaClientDiagnostics respects explicit flags", () => {
  const resolved = resolveAthenaClientDiagnostics({
    debugAst: true,
    diagnostics: false,
    env: { NODE_ENV: "production" },
  });
  assert.equal(resolved.debugAst, true);
  assert.equal(resolved.findManyAst, false);
  assert.equal(resolved.traceQueries, false);
});

test("resolveAthenaClientDiagnostics diagnostics true enables defaults", () => {
  const resolved = resolveAthenaClientDiagnostics({
    diagnostics: true,
    env: { NODE_ENV: "development" },
  });
  assert.equal(resolved.debugAst, true);
  assert.equal(resolved.findManyAst, true);
  assert.equal(resolved.traceQueries, true);
});

test("resolveAthenaClientDiagnostics auto stays quiet in production", () => {
  const resolved = resolveAthenaClientDiagnostics({
    diagnostics: "auto",
    env: { NODE_ENV: "production" },
  });
  assert.equal(resolved.debugAst, false);
  assert.equal(resolved.findManyAst, false);
  assert.equal(resolved.traceQueries, false);
});

test("resolveAthenaClientDiagnostics auto + OPENNEXT_BUILD stays quiet", () => {
  const resolved = resolveAthenaClientDiagnostics({
    debugAst: undefined,
    diagnostics: "auto",
    env: { NODE_ENV: "development", OPENNEXT_BUILD: "true" },
  });
  assert.equal(resolved.debugAst, false);
  assert.equal(resolved.findManyAst, false);
});

test("resolveAthenaClientDiagnostics exposes raw query warning behavior", () => {
  assert.equal(
    resolveAthenaClientDiagnostics({
      env: { NODE_ENV: "production" },
    }).rawQueryDiagnostics,
    false
  );
  assert.equal(
    resolveAthenaClientDiagnostics({
      env: { NODE_ENV: "development" },
    }).rawQueryDiagnostics,
    true
  );
  assert.equal(
    resolveAthenaClientDiagnostics({ env: {} }).rawQueryDiagnostics,
    false
  );
  assert.equal(
    resolveAthenaClientDiagnostics({
      diagnostics: true,
      env: {},
    }).rawQueryDiagnostics,
    true
  );
});
