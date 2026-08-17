/**
 * Canonical topology matrix. Tests execute this fixture via resolveAthenaRuntime.
 * Docs may quote it; they are not the authority.
 */

import type {
  AthenaAuthRuntime,
  AthenaDbTransport,
  AthenaRuntimeEnvironment,
  AthenaStorageTransport,
} from "./resolve.ts";

export interface AthenaTopologyMatrixInput {
  auth?: false | { mode?: string; url?: string | null } | null;
  databaseUrl?: string | null;
  db?: { d1?: unknown; pgUri?: string | null };
  env?: Record<string, string | undefined>;
  mode?: string | null;
  storage?: { r2?: unknown; url?: string | null };
  url?: string | null;
}

export interface AthenaTopologyMatrixExpect {
  auth: AthenaAuthRuntime;
  db: AthenaDbTransport;
  storage: AthenaStorageTransport;
}

export interface AthenaTopologyMatrixRow {
  environment: AthenaRuntimeEnvironment;
  expect: AthenaTopologyMatrixExpect;
  id: string;
  input: AthenaTopologyMatrixInput;
  throws?: string;
  trustedNode?: boolean;
}

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_topology";

export const ATHENA_TOPOLOGY_MATRIX: readonly AthenaTopologyMatrixRow[] = [
  {
    environment: "node",
    expect: { auth: "embedded", db: "postgres", storage: "none" },
    id: "node-database-url-embedded-auth",
    input: { databaseUrl: SAMPLE_PG, env: {} },
    trustedNode: true,
  },
  {
    environment: "node",
    expect: { auth: "disabled", db: "postgres", storage: "none" },
    id: "node-auth-false-keeps-postgres",
    input: { auth: false, databaseUrl: SAMPLE_PG, env: {} },
    trustedNode: true,
  },
  {
    environment: "node",
    expect: { auth: "remote", db: "postgres", storage: "none" },
    id: "node-auth-url-wins",
    input: {
      auth: { url: "https://auth.example.com" },
      databaseUrl: SAMPLE_PG,
      env: {},
    },
    trustedNode: true,
  },
  {
    environment: "node",
    expect: { auth: "remote", db: "postgres", storage: "none" },
    id: "node-explicit-remote-auth",
    input: {
      auth: { mode: "remote" },
      databaseUrl: SAMPLE_PG,
      env: {},
    },
    trustedNode: true,
  },
  {
    environment: "node",
    expect: { auth: "embedded", db: "postgres", storage: "none" },
    id: "node-explicit-local-auth",
    input: {
      auth: { mode: "local" },
      databaseUrl: SAMPLE_PG,
      env: {},
    },
    trustedNode: true,
  },
  {
    environment: "node",
    expect: { auth: "remote", db: "gateway", storage: "none" },
    id: "node-hosted-url-key",
    input: { env: {}, url: "https://gw.example.com" },
    trustedNode: true,
  },
  {
    environment: "node",
    expect: { auth: "embedded", db: "gateway", storage: "none" },
    id: "node-forced-gateway-keeps-inferred-auth",
    input: { databaseUrl: SAMPLE_PG, env: {}, mode: "gateway" },
    trustedNode: true,
  },
  {
    environment: "node",
    expect: { auth: "embedded", db: "postgres", storage: "http" },
    id: "node-postgres-http-storage",
    input: {
      databaseUrl: SAMPLE_PG,
      env: {},
      storage: { url: "https://storage.example.com" },
    },
    trustedNode: true,
  },
  {
    environment: "browser",
    expect: { auth: "remote", db: "gateway", storage: "none" },
    id: "browser-never-selects-postgres",
    input: { databaseUrl: SAMPLE_PG, env: {} },
    trustedNode: false,
  },
  {
    environment: "browser",
    expect: { auth: "remote", db: "gateway", storage: "none" },
    id: "browser-hosted-url",
    input: { env: {}, url: "https://gw.example.com" },
    trustedNode: false,
  },
  {
    environment: "browser",
    expect: { auth: "embedded", db: "gateway", storage: "none" },
    id: "browser-explicit-local-auth-fails",
    input: { auth: { mode: "local" }, databaseUrl: SAMPLE_PG, env: {} },
    throws: "ATHENA_AUTH_LOCAL_NODE_REQUIRED",
    trustedNode: false,
  },
  {
    environment: "react-native",
    expect: { auth: "remote", db: "gateway", storage: "none" },
    id: "react-native-never-selects-postgres",
    input: { databaseUrl: SAMPLE_PG, env: {} },
    trustedNode: false,
  },
  {
    environment: "cloudflare",
    expect: { auth: "remote", db: "d1", storage: "none" },
    id: "cloudflare-d1",
    input: { db: { d1: { binding: true } }, env: {} },
    trustedNode: false,
  },
  {
    environment: "cloudflare",
    expect: { auth: "remote", db: "d1", storage: "r2" },
    id: "cloudflare-d1-r2",
    input: {
      db: { d1: { binding: true } },
      env: {},
      storage: { r2: { binding: true } },
    },
    trustedNode: false,
  },
];
