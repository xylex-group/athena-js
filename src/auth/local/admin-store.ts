import {
  ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
  ATHENA_AUTH_TABLES,
} from "../contract/index.ts";
import type { MemoryAuthStores } from "./memory-stores.ts";
import type { AthenaAuthDatabase } from "./database.ts";
import type {
  AthenaAuthAdminCreateUserInput,
  AthenaAuthAdminListUsersInput,
  AthenaAuthAdminListUsersResult,
  AthenaAuthAdminStore,
  AthenaAuthAdminUpdateUserInput,
} from "./admin-contract.ts";
import { clampAdminListLimit, clampAdminListOffset } from "./admin-contract.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import { parseMetadata } from "./models.ts";

function hydrateUser(row: AuthUserRow | undefined): AuthUserRow | undefined {
  return row ? { ...row, metadata: parseMetadata(row.metadata) } : undefined;
}

export class PostgresAdminAuthStore implements AthenaAuthAdminStore {
  constructor(private readonly db: AthenaAuthDatabase) {}

  async getUser(userId: string): Promise<AuthUserRow | undefined> {
    const result = await this.db.query<AuthUserRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.users} WHERE id = $1`,
      [userId]
    );
    return hydrateUser(result.rows[0]);
  }

  async getUserByEmail(email: string): Promise<AuthUserRow | undefined> {
    const result = await this.db.query<AuthUserRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.users} WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    return hydrateUser(result.rows[0]);
  }

  async listUsers(
    input: AthenaAuthAdminListUsersInput
  ): Promise<AthenaAuthAdminListUsersResult> {
    const limit = clampAdminListLimit(input.limit);
    const offset = clampAdminListOffset(input.offset);
    const params: unknown[] = [];
    const where: string[] = [];

    if (input.query?.trim()) {
      params.push(`%${input.query.trim()}%`);
      const index = params.length;
      where.push(
        `(email ILIKE $${index} OR name ILIKE $${index} OR username ILIKE $${index} OR id ILIKE $${index})`
      );
    }
    if (input.role?.trim()) {
      params.push(input.role.trim());
      where.push(`role = $${params.length}`);
    }
    if (typeof input.banned === "boolean") {
      params.push(input.banned);
      where.push(`banned = $${params.length}`);
    }

    const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.query<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM ${ATHENA_AUTH_TABLES.users} ${predicate}`,
      params
    );

    const pageParams = [...params, limit, offset];
    const rows = await this.db.query<AuthUserRow>(
      `SELECT * FROM ${ATHENA_AUTH_TABLES.users}
       ${predicate}
       ORDER BY created_at DESC, id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams
    );

    return {
      limit,
      offset,
      total: Number(count.rows[0]?.total ?? 0),
      users: rows.rows.map((row) => hydrateUser(row) ?? row),
    };
  }

  async createUser(
    input: AthenaAuthAdminCreateUserInput & {
      id: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<AuthUserRow> {
    return this.db.transaction(async (tx) => {
      const result = await tx.query<AuthUserRow>(
        `INSERT INTO ${ATHENA_AUTH_TABLES.users}
          (id, email, name, email_verified, username, role, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING *`,
        [
          input.id,
          input.email,
          input.name ?? null,
          input.emailVerified ?? false,
          input.username ?? null,
          input.role ?? "user",
          JSON.stringify(input.metadata ?? {}),
        ]
      );
      const row = hydrateUser(result.rows[0]);
      if (!row) {
        throw new Error("Failed to create admin user");
      }
      const passwordHash =
        typeof input.metadata?.password_hash === "string"
          ? input.metadata.password_hash
          : undefined;
      if (passwordHash) {
        await tx.query(
          `INSERT INTO ${ATHENA_AUTH_TABLES.accounts}
            (id, account_id, provider_id, user_id, password)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            crypto.randomUUID(),
            row.id,
            ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
            row.id,
            passwordHash,
          ]
        );
      }
      return row;
    });
  }

  async updateUser(input: AthenaAuthAdminUpdateUserInput): Promise<AuthUserRow> {
    const result = await this.db.query<AuthUserRow>(
      `UPDATE ${ATHENA_AUTH_TABLES.users}
       SET
         name = CASE WHEN $2::boolean THEN $3 ELSE name END,
         email = COALESCE($4, email),
         email_verified = COALESCE($5, email_verified),
         image = CASE WHEN $6::boolean THEN $7 ELSE image END,
         role = CASE WHEN $8::boolean THEN $9 ELSE role END,
         banned = COALESCE($10, banned),
         ban_reason = CASE WHEN $11::boolean THEN $12 ELSE ban_reason END,
         ban_expires = CASE WHEN $13::boolean THEN $14 ELSE ban_expires END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        input.userId,
        input.name !== undefined,
        input.name ?? null,
        input.email ?? null,
        input.emailVerified ?? null,
        input.image !== undefined,
        input.image ?? null,
        input.role !== undefined,
        input.role ?? null,
        input.banned ?? null,
        input.banReason !== undefined,
        input.banReason ?? null,
        input.banExpires !== undefined,
        input.banExpires?.toISOString() ?? null,
      ]
    );
    const row = hydrateUser(result.rows[0]);
    if (!row) {
      throw new Error("User not found");
    }
    return row;
  }

  async deleteSession(token: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.sessions} WHERE token = $1`,
      [token]
    );
    return result.rowCount > 0;
  }

  async deleteUser(userId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.users} WHERE id = $1`,
      [userId]
    );
    return result.rowCount > 0;
  }

  async deleteUserSessions(userId: string, exceptToken?: string): Promise<number> {
    const result = exceptToken
      ? await this.db.query(
          `DELETE FROM ${ATHENA_AUTH_TABLES.sessions} WHERE user_id = $1 AND token <> $2`,
          [userId, exceptToken]
        )
      : await this.db.query(
          `DELETE FROM ${ATHENA_AUTH_TABLES.sessions} WHERE user_id = $1`,
          [userId]
        );
    return result.rowCount;
  }

  async createImpersonationSession(input: {
    activeOrganizationId?: string | null;
    expiresAt: Date;
    id: string;
    impersonatedBy: string;
    ipAddress?: string | null;
    token: string;
    userAgent?: string | null;
    userId: string;
  }): Promise<AuthSessionRow> {
    const result = await this.db.query<AuthSessionRow>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.sessions}
        (id, user_id, token, expires_at, ip_address, user_agent, impersonated_by, active_organization_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.token,
        input.expiresAt.toISOString(),
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.impersonatedBy,
        input.activeOrganizationId ?? null,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to create impersonation session");
    }
    return row;
  }
}

export class MemoryAdminAuthStore implements AthenaAuthAdminStore {
  constructor(private readonly stores: MemoryAuthStores) {}

  getUser(userId: string) {
    return this.stores.getUserById(userId);
  }

  getUserByEmail(email: string) {
    return this.stores.getUserByEmail(email);
  }

  async listUsers(
    input: AthenaAuthAdminListUsersInput
  ): Promise<AthenaAuthAdminListUsersResult> {
    const limit = clampAdminListLimit(input.limit);
    const offset = clampAdminListOffset(input.offset);
    const query = input.query?.trim().toLowerCase();
    const role = input.role?.trim();
    const rows = [...this.stores.users.values()]
      .filter((user) => {
        if (role && user.role !== role) {
          return false;
        }
        if (typeof input.banned === "boolean" && user.banned !== input.banned) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [user.email, user.name, user.username, user.id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((left, right) => {
        const time =
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        return time !== 0 ? time : left.id.localeCompare(right.id);
      });
    return {
      limit,
      offset,
      total: rows.length,
      users: rows.slice(offset, offset + limit),
    };
  }

  async createUser(
    input: AthenaAuthAdminCreateUserInput & {
      id: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    const user = await this.stores.createUser({
      email: input.email,
      emailVerified: input.emailVerified,
      id: input.id,
      metadata: input.metadata,
      name: input.name,
      username: input.username,
    });
    if (input.role) {
      await this.stores.updateUser(user.id, { role: input.role });
    }
    const passwordHash =
      typeof input.metadata?.password_hash === "string"
        ? input.metadata.password_hash
        : undefined;
    if (passwordHash) {
      try {
        await this.stores.createAccount({
          accountId: user.id,
          id: crypto.randomUUID(),
          password: passwordHash,
          providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
          userId: user.id,
        });
      } catch (error) {
        await this.stores.deleteUser(user.id);
        throw error;
      }
    }
    return (await this.stores.getUserById(user.id)) ?? user;
  }

  updateUser(input: AthenaAuthAdminUpdateUserInput) {
    return this.stores.updateUser(input.userId, {
      banExpires: input.banExpires,
      banReason: input.banReason,
      banned: input.banned,
      email: input.email,
      emailVerified: input.emailVerified,
      image: input.image,
      name: input.name,
      role: input.role,
    });
  }

  deleteSession(token: string) {
    return this.stores.deleteSession(token);
  }

  async deleteUser(userId: string) {
    const existing = await this.stores.getUserById(userId);
    if (!existing) {
      return false;
    }
    await this.stores.deleteUser(userId);
    return true;
  }

  deleteUserSessions(userId: string, exceptToken?: string) {
    return this.stores.deleteUserSessions(userId, exceptToken);
  }

  createImpersonationSession(input: {
    activeOrganizationId?: string | null;
    expiresAt: Date;
    id: string;
    impersonatedBy: string;
    ipAddress?: string | null;
    token: string;
    userAgent?: string | null;
    userId: string;
  }) {
    return this.stores.createSession(input);
  }
}
