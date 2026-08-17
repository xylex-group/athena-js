import {
  ATHENA_AUTH_INIT_ADVISORY_LOCK,
  ATHENA_AUTH_RUNTIME_KEY_PURPOSE,
  ATHENA_AUTH_TABLES,
} from "../contract/index.ts";
import type { AthenaAuthDatabase } from "./database.ts";

export interface AthenaAuthRuntimeKey {
  activatedAt: string;
  createdAt: string;
  keyId: string;
  material: string;
  purpose: string;
  retiredAt: string | null;
}

function randomKeyMaterial(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function resolveRuntimeKey(
  db: AthenaAuthDatabase,
  explicitSecret?: string
): Promise<AthenaAuthRuntimeKey> {
  if (explicitSecret) {
    return {
      activatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      keyId: "configured",
      material: explicitSecret,
      purpose: ATHENA_AUTH_RUNTIME_KEY_PURPOSE,
      retiredAt: null,
    };
  }

  return db.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [
      ATHENA_AUTH_INIT_ADVISORY_LOCK,
    ]);
    const existing = await tx.query<{
      activated_at: Date | string;
      created_at: Date | string;
      key_id: string;
      key_material: string;
      purpose: string;
      retired_at: Date | string | null;
    }>(
      `SELECT key_id, purpose, key_material, created_at, activated_at, retired_at
       FROM ${ATHENA_AUTH_TABLES.runtimeKey}
       WHERE purpose = $1 AND retired_at IS NULL
       ORDER BY activated_at ASC
       LIMIT 1`,
      [ATHENA_AUTH_RUNTIME_KEY_PURPOSE]
    );
    const row = existing.rows[0];
    if (row) {
      return {
        activatedAt: new Date(row.activated_at).toISOString(),
        createdAt: new Date(row.created_at).toISOString(),
        keyId: row.key_id,
        material: row.key_material,
        purpose: row.purpose,
        retiredAt: row.retired_at ? new Date(row.retired_at).toISOString() : null,
      };
    }

    const keyId = crypto.randomUUID();
    const material = randomKeyMaterial();
    const inserted = await tx.query<{
      activated_at: Date | string;
      created_at: Date | string;
      key_id: string;
      key_material: string;
      purpose: string;
      retired_at: Date | string | null;
    }>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.runtimeKey}
        (key_id, purpose, key_material)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING key_id, purpose, key_material, created_at, activated_at, retired_at`,
      [keyId, ATHENA_AUTH_RUNTIME_KEY_PURPOSE, material]
    );
    const created = inserted.rows[0];
    if (created) {
      return {
        activatedAt: new Date(created.activated_at).toISOString(),
        createdAt: new Date(created.created_at).toISOString(),
        keyId: created.key_id,
        material: created.key_material,
        purpose: created.purpose,
        retiredAt: null,
      };
    }

    const raced = await tx.query<{
      activated_at: Date | string;
      created_at: Date | string;
      key_id: string;
      key_material: string;
      purpose: string;
    }>(
      `SELECT key_id, purpose, key_material, created_at, activated_at
       FROM ${ATHENA_AUTH_TABLES.runtimeKey}
       WHERE purpose = $1 AND retired_at IS NULL
       ORDER BY activated_at ASC
       LIMIT 1`,
      [ATHENA_AUTH_RUNTIME_KEY_PURPOSE]
    );
    const winner = raced.rows[0];
    if (!winner) {
      throw new Error("Failed to bootstrap Athena Auth runtime key");
    }
    return {
      activatedAt: new Date(winner.activated_at).toISOString(),
      createdAt: new Date(winner.created_at).toISOString(),
      keyId: winner.key_id,
      material: winner.key_material,
      purpose: winner.purpose,
      retiredAt: null,
    };
  });
}
