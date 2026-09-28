import { randomBytes } from "node:crypto";
import {
  isBillingWebhookIngressBindingToken,
  resolveBillingIngressEndpoints,
} from "../../../ingestion/urls.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type { BillingSqlExecutor } from "../../../subject/repository.ts";
import type { BillingProviderName } from "../../../types.ts";
import { resolveBillingCredential } from "../../credentials.ts";
import { resolveBillingEnvironment } from "../../environment.ts";
import {
  createPersistedProviderBinding,
} from "../providers/connection-binding.ts";
import {
  configuredProviderSlotEntries,
  normalizeBillingProviderConfiguration,
} from "../providers/configuration/index.ts";
import type { BillingConnectionIdentity } from "./identity.ts";
import {
  type BillingConnectionIntent,
  createBillingConnectionIntent,
  convergeBillingConnections,
} from "./coordinator.ts";
import { createBillingConvergenceController } from "./convergence-controller.ts";

export interface MaterializedBillingConnection {
  accountReference: string;
  classicWebhookUrl?: string;
  credentialReference: string;
  eventsWebhookUrl?: string;
  id: string;
  provider: BillingProviderName;
  webhookIngressToken?: string;
}

export interface MaterializeConfiguredBillingConnectionsResult {
  connections: readonly MaterializedBillingConnection[];
}

export interface ConfiguredBillingConnectionIntent {
  accountReference: string;
  credentialKind: string;
  credentialReference: string;
  environment: "test" | "live";
  identity: BillingConnectionIdentity;
  provider: BillingProviderName;
  /**
   * Provider-confirmed remote account identity (e.g. a Mollie organization
   * id returned by discovery). Null until verification — never invent one
   * from config. `accountReference` stays the local upsert identity.
   */
  providerAccountId: string | null;
}

function configuredBillingProviderConnectionIntents(input: {
  applicationId: string;
  configuredProviders?: BillingProviderConfigMap;
  provider?: BillingProviderName;
  testMode?: boolean;
}): readonly BillingConnectionIntent[] {
  const applicationId = input.applicationId.trim();
  if (applicationId.length === 0) {
    return [];
  }
  const environment = resolveBillingEnvironment({
    testMode: input.testMode,
  }).name;
  const configured = normalizeBillingProviderConfiguration({
    configuredProviders: input.configuredProviders,
    environment,
  });
  return configuredProviderSlotEntries(configured)
    .filter(
      (slot) => input.provider == null || slot.provider === input.provider,
    )
    .map((slot) =>
      createBillingConnectionIntent({
        applicationId,
        environment,
        slot,
      }),
    );
}

export function configuredBillingConnectionIntents(input: {
  applicationId: string;
  configuredProviders?: BillingProviderConfigMap;
  provider?: BillingProviderName;
  testMode?: boolean;
}): readonly ConfiguredBillingConnectionIntent[] {
  const environment = resolveBillingEnvironment({
    testMode: input.testMode,
  }).name;
  const providerIntents = configuredBillingProviderConnectionIntents(input);
  const intents: ConfiguredBillingConnectionIntent[] = [];
  for (const providerIntent of providerIntents) {
    intents.push({
      accountReference: providerIntent.localIdentity.accountReference,
      credentialKind: providerIntent.slot.credentialKind,
      credentialReference: providerIntent.slot.credentialReference,
      environment,
      identity: {
        credentialReference: providerIntent.slot.credentialReference,
        environment,
        provider: providerIntent.provider,
        ...(providerIntent.slot.key == null
          ? {}
          : { scopeKey: providerIntent.slot.key }),
      },
      provider: providerIntent.provider,
      providerAccountId: null,
    });
  }
  return intents;
}

const CONFIGURED_CONNECTION_INIT = Symbol.for(
  "@xylex-group/athena.billingConfiguredConnectionInit"
);

type ConfiguredConnectionInitCache = ReturnType<
  typeof createBillingConvergenceController<MaterializeConfiguredBillingConnectionsResult>
>;

function configuredConnectionInitCache(): ConfiguredConnectionInitCache {
  const holder = globalThis as typeof globalThis & {
    [CONFIGURED_CONNECTION_INIT]?: ConfiguredConnectionInitCache;
  };
  holder[CONFIGURED_CONNECTION_INIT] ??=
    createBillingConvergenceController<MaterializeConfiguredBillingConnectionsResult>();
  return holder[CONFIGURED_CONNECTION_INIT];
}

/**
 * Process-global materialize identity. Environment is part of the key so
 * test and live do not share a cached result. Generation is not: HMR must
 * reuse the in-flight/completed promise instead of opening another Neon
 * connection during Next compile.
 */
export function configuredBillingConnectionInitKey(input: {
  applicationId: string;
  databaseIdentity?: string;
  provider?: BillingProviderName;
  testMode?: boolean;
}): string {
  const environment = resolveBillingEnvironment({
    testMode: input.testMode,
  }).name;
  return `${input.applicationId.trim()}\0${input.databaseIdentity ?? ""}\0${environment}\0${input.provider ?? "*"}`;
}

/**
 * One initialization attempt per process runtime. Concurrent startup callers
 * share it. Failed attempts remain observable, while recovery explicitly
 * starts a later generation.
 */
export function singleFlightConfiguredBillingConnectionMaterialize(
  key: string,
  run: () => Promise<MaterializeConfiguredBillingConnectionsResult>
): Promise<MaterializeConfiguredBillingConnectionsResult> {
  return configuredConnectionInitCache().start(key, run);
}

export function retryConfiguredBillingConnectionMaterialize(
  key: string,
  run: () => Promise<MaterializeConfiguredBillingConnectionsResult>,
  project?: (
    result: MaterializeConfiguredBillingConnectionsResult,
  ) => Promise<void> | void,
): Promise<MaterializeConfiguredBillingConnectionsResult> {
  const current = configuredConnectionInitCache().current(key);
  if (current?.state === "running") {
    const runningGeneration = current.generation;
    return current.promise
      .catch(() => undefined)
      .then(() => {
        const settled = configuredConnectionInitCache().current(key);
        if (runningGeneration === 1 && settled?.generation === 1) {
          return configuredConnectionInitCache().retry(key, run);
        }
        return settled?.promise ?? configuredConnectionInitCache().retry(key, run);
      })
      .then(async (result) => {
        await project?.(result);
        return result;
      });
  }
  return configuredConnectionInitCache()
    .retry(key, run)
    .then(async (result) => {
      await project?.(result);
      return result;
    });
}

export function configuredBillingConnectionConvergenceGeneration(
  key: string
): number {
  return configuredConnectionInitCache().current(key)?.generation ?? 0;
}

function upsertConfiguredConnectionSql(input: {
  accountReference: string;
  applicationId: string;
  credentialKind: string;
  credentialReference: string;
  environment: "test" | "live";
  provider: BillingProviderName;
  providerAccountId: string | null;
  webhookIngressToken: string;
}): { params: readonly unknown[]; sql: string } {
  return {
    params: [
      input.applicationId,
      input.provider,
      input.environment,
      input.environment,
      input.credentialKind,
      input.credentialReference,
      input.providerAccountId,
      input.accountReference,
      input.webhookIngressToken,
    ],
    sql: `
INSERT INTO billing.billing_provider_connections (
	owner_kind,
	owner_id,
	provider,
	mode,
	environment,
	status,
	credential_kind,
	credential_reference,
	provider_account_id,
	account_reference,
	scopes,
	config,
	metadata
)
VALUES (
	'tenant',
	$1,
	$2,
	$3,
	$4,
	'active',
	$5,
	$6,
	$7,
	$8,
	'[]'::jsonb,
	'{}'::jsonb,
	jsonb_build_object(
		'managedBy', 'application_config',
		'webhookIngressToken', $9::text
	)
)
ON CONFLICT (owner_kind, owner_id, provider, environment, credential_reference)
WHERE deleted_at IS NULL
DO UPDATE SET
	status = 'active',
	credential_kind = EXCLUDED.credential_kind,
	credential_reference = EXCLUDED.credential_reference,
	mode = EXCLUDED.mode,
	environment = EXCLUDED.environment,
	provider_account_id = COALESCE(
		EXCLUDED.provider_account_id,
		billing.billing_provider_connections.provider_account_id
	),
	account_reference = EXCLUDED.account_reference,
	scopes = EXCLUDED.scopes,
	config = EXCLUDED.config,
	metadata = COALESCE(billing.billing_provider_connections.metadata, '{}'::jsonb)
		|| jsonb_build_object('managedBy', 'application_config')
		|| jsonb_build_object(
			'webhookIngressToken',
			COALESCE(
				NULLIF(
					billing.billing_provider_connections.metadata->>'webhookIngressToken',
					''
				),
				EXCLUDED.metadata->>'webhookIngressToken'
			)
		),
	updated_at = now()
RETURNING id::text AS id,
	metadata->>'webhookIngressToken' AS webhook_ingress_token
`,
  };
}

/**
 * Disable managed connections in the other billing environment.
 * Call only after the candidate connection's remote webhook registration is
 * confirmed — materialize must not do this, or Mollie still posting the old
 * binding token 404s before the replacement URL is live.
 */
export async function supersedeOtherEnvironmentBillingConnections(input: {
  applicationId: string;
  credentialReference: string;
  environment: "test" | "live";
  id: string;
  provider: BillingProviderName;
  sql: BillingSqlExecutor;
}): Promise<void> {
  const statement = supersedeOtherEnvironmentSql(input);
  await input.sql.query(statement.sql, statement.params);
}

function supersedeOtherEnvironmentSql(input: {
  applicationId: string;
  credentialReference: string;
  environment: "test" | "live";
  id: string;
  provider: BillingProviderName;
}): { params: readonly unknown[]; sql: string } {
  return {
    params: [
      input.environment,
      input.credentialReference,
      input.applicationId,
      input.provider,
      input.id,
      input.credentialReference,
      input.environment,
    ],
    sql: `
UPDATE billing.billing_provider_connections
SET status = 'disabled',
	updated_at = now(),
	metadata = COALESCE(metadata, '{}'::jsonb)
		|| jsonb_build_object(
			'managedBy', 'application_config',
			'supersededByEnvironment', $1::text,
			'supersededByCredentialReference', $2::text
		)
WHERE deleted_at IS NULL
  AND status = 'active'
  AND owner_kind = 'tenant'
  AND owner_id = $3
  AND lower(provider) = lower($4)
  AND id::text <> $5
  AND (
    credential_reference = $6
    OR (
      position(':' in credential_reference) = 0
      AND environment <> $7
    )
  )
`,
  };
}

function mintWebhookIngressToken(): string {
  return randomBytes(24).toString("base64url");
}

function assertNoSecretMaterial(value: unknown, label: string): void {
  if (typeof value !== "string") {
    return;
  }
  const lowered = value.toLowerCase();
  if (
    lowered.startsWith("access_") ||
    lowered.startsWith("live_") ||
    lowered.startsWith("test_") ||
    lowered.startsWith("sk_") ||
    lowered.includes("secret")
  ) {
    throw new Error(
      `Configured billing connection ${label} must not contain credential material.`
    );
  }
}

function assertConfiguredIntentCredentials(input: {
  configuredProviders?: BillingProviderConfigMap;
  intents: readonly ConfiguredBillingConnectionIntent[];
}): void {
  for (const intent of input.intents) {
    const binding = createPersistedProviderBinding({
      configuredProviders: input.configuredProviders,
      connectionId: intent.accountReference,
      credentialReference: intent.credentialReference,
      provider: intent.provider,
    });
    resolveBillingCredential({
      binding,
      provider: intent.provider,
      slot: intent.credentialReference,
      testMode: intent.environment === "test",
    });
  }
}

export async function materializeConfiguredBillingConnections(input: {
  applicationId: string;
  appUrl?: string | null;
  configuredProviders?: BillingProviderConfigMap;
  publicBaseUrl?: string | null;
  provider?: BillingProviderName;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<MaterializeConfiguredBillingConnectionsResult> {
  const applicationId = input.applicationId.trim();
  const testMode = resolveBillingEnvironment({
    testMode: input.testMode,
  }).testMode;
  const intents = configuredBillingConnectionIntents({
    applicationId,
    configuredProviders: input.configuredProviders,
    provider: input.provider,
    testMode,
  });
  const providerIntents = configuredBillingProviderConnectionIntents({
    applicationId,
    configuredProviders: input.configuredProviders,
    provider: input.provider,
    testMode,
  });
  assertConfiguredIntentCredentials({
    configuredProviders: input.configuredProviders,
    intents,
  });
  for (const intent of intents) {
    assertNoSecretMaterial(intent.credentialReference, "credential_reference");
    assertNoSecretMaterial(intent.accountReference, "account_reference");
  }
  if (intents.length > 0) {
    const duplicates = await input.sql.query(
      `SELECT owner_kind, owner_id, provider, environment, credential_reference, COUNT(*)::int AS n
			 FROM billing.billing_provider_connections
			 WHERE deleted_at IS NULL
			 GROUP BY owner_kind, owner_id, provider, environment, credential_reference
			 HAVING COUNT(*) > 1
			 LIMIT 1`
    );
    if (duplicates.rows[0]) {
      throw new Error(
        "ATHENA_BILLING: duplicate owner-slot connections exist; run an explicit remediation migration before materialize."
      );
    }
  }
  const intentsBySlot = new Map(
    intents.map((intent) => [
      `${intent.provider}\0${intent.environment}\0${intent.credentialReference}`,
      intent,
    ]),
  );
  const converged = await convergeBillingConnections({
    applicationId,
    environment: resolveBillingEnvironment({ testMode }).name,
    intents: providerIntents,
    repository: {
      upsertDeclared: async (providerIntent) => {
        const intent = intentsBySlot.get(
          `${providerIntent.provider}\0${providerIntent.environment}\0${providerIntent.slot.credentialReference}`,
        );
        if (intent == null) {
          throw new Error(
            `Missing configured connection intent for "${providerIntent.slot.credentialReference}".`,
          );
        }
        if (
          intent.providerAccountId !== null &&
          intent.providerAccountId.length > 0
        ) {
          const collision = await input.sql.query(
            `SELECT owner_id
				 FROM billing.billing_provider_connections
				 WHERE provider_account_id = $1
				   AND deleted_at IS NULL
				   AND owner_id <> $2
				 LIMIT 1`,
            [intent.providerAccountId, applicationId],
          );
          if (collision.rows[0]) {
            throw new Error(
              "Provider account is already bound to another billing owner.",
            );
          }
        }
        const mintedWebhookIngressToken = mintWebhookIngressToken();
        assertNoSecretMaterial(
          mintedWebhookIngressToken,
          "webhook_ingress_token",
        );
        const statement = upsertConfiguredConnectionSql({
          accountReference: intent.accountReference,
          applicationId,
          credentialKind: intent.credentialKind,
          credentialReference: intent.credentialReference,
          environment: intent.environment,
          provider: intent.provider,
          providerAccountId: intent.providerAccountId,
          webhookIngressToken: mintedWebhookIngressToken,
        });
        const result = await input.sql.query(statement.sql, statement.params);
        const row = result.rows[0];
        const id = row?.id;
        const webhookIngressToken = row?.webhook_ingress_token;
        if (typeof id !== "string" || id.length === 0) {
          throw new Error(
            "Configured billing connection materialization did not return an id.",
          );
        }
        if (
          typeof webhookIngressToken !== "string" ||
          webhookIngressToken.length === 0
        ) {
          throw new Error(
            "Configured billing connection materialization did not return a webhook ingress token.",
          );
        }
        assertNoSecretMaterial(webhookIngressToken, "webhook_ingress_token");
        if (!isBillingWebhookIngressBindingToken(webhookIngressToken)) {
          throw new Error(
            "Configured billing connection materialization returned an invalid webhook ingress token.",
          );
        }
        const ingressEndpoints = resolveBillingIngressEndpoints({
          appUrl: input.appUrl,
          publicBaseUrl: input.publicBaseUrl,
          webhookIngressToken,
        });
        return {
          accountReference: intent.accountReference,
          ...(ingressEndpoints
            ? {
                classicWebhookUrl: ingressEndpoints.classicUrl,
                eventsWebhookUrl: ingressEndpoints.eventsUrl,
              }
            : {}),
          credentialReference: intent.credentialReference,
          id,
          provider: intent.provider,
          webhookIngressToken,
        };
      },
    },
  });
  return { connections: converged.connections };
}

/** Declared `billing.providers` converge here; apps must not call createConnection(). */
export const DECLARED_BILLING_PROVIDER_MATERIALIZES_WITHOUT_CREATE_CONNECTION =
  true as const;
