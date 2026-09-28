import { AthenaConfigurationError } from "../../../config/errors.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import { fingerprintBillingSigningSecret } from "../ownership.ts";
import {
  openBillingWebhookSecret,
  sealBillingWebhookSecret,
} from "./envelope.ts";
import type { BillingWebhookSecretStore } from "./types.ts";

export function createPostgresBillingWebhookSecretStore(input: {
  masterKey: string;
  sql: BillingSqlExecutor;
}): BillingWebhookSecretStore {
  const masterKey = input.masterKey.trim();
  if (masterKey.length === 0) {
    throw new AthenaConfigurationError(
      "ATHENA_BILLING_INGESTION_CONFIG_INVALID",
      "Encrypted billing webhook secrets require ATHENA_BILLING_WEBHOOK_MASTER_KEY (or billing.ingestion.webhooks.secretMasterKey).",
      "billing"
    );
  }
  const sql = input.sql;
  return {
    async resolve(connectionId) {
      const result = await sql.query(
        `
SELECT fingerprint, ciphertext, status
FROM athena_internal.billing_webhook_signing_secrets
WHERE connection_id = $1::uuid AND status IN ('current', 'previous')
ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END, created_at DESC
`,
        [connectionId]
      );
      let current: string | undefined;
      const previous: string[] = [];
      for (const row of result.rows) {
        const secret = openBillingWebhookSecret(
          String(row.ciphertext),
          masterKey
        );
        if (row.status === "current" && current == null) {
          current = secret;
          continue;
        }
        if (row.status === "previous") {
          previous.push(secret);
        }
      }
      return {
        previous,
        ...(current ? { current } : {}),
      };
    },
    async rotate(inputRotate) {
      await replaceConnectionSecrets(sql, masterKey, inputRotate.connectionId, [
        { secret: inputRotate.current, status: "current" },
        ...inputRotate.previous.map((secret) => ({
          secret,
          status: "previous" as const,
        })),
      ]);
    },
    async storeCurrent(storeInput) {
      const existing = await sql.query(
        `
SELECT fingerprint, ciphertext, status
FROM athena_internal.billing_webhook_signing_secrets
WHERE connection_id = $1::uuid AND status IN ('current', 'previous')
`,
        [storeInput.connectionId]
      );
      const next: { secret: string; status: "current" | "previous" }[] = [
        { secret: storeInput.secret, status: "current" },
      ];
      for (const row of existing.rows) {
        if (String(row.fingerprint) === storeInput.fingerprint) {
          continue;
        }
        const secret = openBillingWebhookSecret(
          String(row.ciphertext),
          masterKey
        );
        if (row.status === "current") {
          next.push({ secret, status: "previous" });
        }
      }
      await replaceConnectionSecrets(
        sql,
        masterKey,
        storeInput.connectionId,
        next
      );
    },
  };
}

async function replaceConnectionSecrets(
  sql: BillingSqlExecutor,
  masterKey: string,
  connectionId: string,
  secrets: readonly { secret: string; status: "current" | "previous" }[]
): Promise<void> {
  await sql.query(
    `
UPDATE athena_internal.billing_webhook_signing_secrets
SET status = 'retired', retired_at = now()
WHERE connection_id = $1::uuid AND status IN ('current', 'previous')
`,
    [connectionId]
  );
  for (const entry of secrets) {
    const fingerprint = fingerprintBillingSigningSecret(entry.secret);
    const ciphertext = sealBillingWebhookSecret(entry.secret, masterKey);
    await sql.query(
      `
INSERT INTO athena_internal.billing_webhook_signing_secrets (
	connection_id, key_version, fingerprint, ciphertext, status, created_at
) VALUES ($1::uuid, 1, $2, $3, $4, now())
ON CONFLICT (connection_id, fingerprint) DO UPDATE SET
	ciphertext = EXCLUDED.ciphertext,
	status = EXCLUDED.status,
	retired_at = NULL,
	key_version = EXCLUDED.key_version
`,
      [connectionId, fingerprint, ciphertext, entry.status]
    );
  }
}
