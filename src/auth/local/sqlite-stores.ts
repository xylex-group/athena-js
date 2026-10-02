import type { AthenaAuthDatabase } from "./database.ts";
import { MemoryAuthStores } from "./memory-stores.ts";
import { ATHENA_AUTH_SQLITE_SCHEMA } from "./sqlite-schema.ts";
import type {
  AuthAccountRow,
  AuthFederatedIdentityRow,
  AuthIdentityConnectionRow,
  AuthMemberRow,
  AuthOrganizationRow,
  AuthSessionRow,
  AuthUserRow,
  AuthVerificationRow,
} from "./models.ts";
import type {
  CreateAuthFederatedIdentityInput,
  CreateAuthIdentityConnectionInput,
  UpdateAuthIdentityConnectionInput,
} from "./identity-connections/types.ts";
import type { CreateSessionInput, CreateUserInput } from "./stores.ts";

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function flag(value: boolean | number | null | undefined): number {
  return value ? 1 : 0;
}

export async function applyAthenaAuthSqliteSchema(
  database: AthenaAuthDatabase,
): Promise<void> {
  for (const sql of ATHENA_AUTH_SQLITE_SCHEMA) {
    await database.query(sql);
  }
}

/**
 * Persistence over SQLite-authored tables. Methods keep the MemoryAuthStores
 * contract so handlers can run without PostgreSQL SQL.
 */
export class SqliteAuthStores extends MemoryAuthStores {
  constructor(private readonly database: AthenaAuthDatabase) {
    super();
  }

  static async connect(database: AthenaAuthDatabase): Promise<SqliteAuthStores> {
    await applyAthenaAuthSqliteSchema(database);
    const stores = new SqliteAuthStores(database);
    await stores.hydrate();
    return stores;
  }

  async hydrate(): Promise<void> {
    const users = await this.database.query<AuthUserRow>(
      "SELECT * FROM athena_auth_user",
    );
    for (const row of users.rows) {
      this.users.set(row.id, {
        ...row,
        banned: Boolean(row.banned),
        email_verified: Boolean(row.email_verified),
        two_factor_enabled: Boolean(row.two_factor_enabled),
      });
    }
    const sessions = await this.database.query<AuthSessionRow>(
      "SELECT * FROM athena_auth_session",
    );
    for (const row of sessions.rows) {
      this.sessions.set(row.token, {
        ...row,
        active: Boolean(row.active),
      });
    }
    const accounts = await this.database.query<AuthAccountRow>(
      "SELECT * FROM athena_auth_account",
    );
    for (const row of accounts.rows) {
      this.accounts.set(row.id, row);
    }
    const verifications = await this.database.query<AuthVerificationRow>(
      "SELECT * FROM athena_auth_verification",
    );
    for (const row of verifications.rows) {
      this.verifications.set(row.id, row);
    }
    const organizations = await this.database.query<AuthOrganizationRow>(
      "SELECT * FROM athena_auth_organization",
    );
    for (const row of organizations.rows) {
      this.organizations.set(row.id, row);
    }
    const members = await this.database.query<AuthMemberRow>(
      "SELECT * FROM athena_auth_member",
    );
    for (const row of members.rows) {
      this.members.set(row.id, row);
    }
    const connections = await this.database.query<AuthIdentityConnectionRow>(
      "SELECT * FROM athena_auth_identity_connection"
    );
    for (const row of connections.rows) {
      this.identityConnections.set(row.id, {
        ...row,
        authentication_required: Boolean(row.authentication_required),
        domains: parseJsonArray(row.domains),
        enabled: Boolean(row.enabled),
        jit_enabled: Boolean(row.jit_enabled),
      });
    }
    const identities = await this.database.query<AuthFederatedIdentityRow>(
      "SELECT * FROM athena_auth_federated_identity"
    );
    for (const row of identities.rows) {
      this.federatedIdentities.set(row.id, row);
    }
    const userRoles = await this.database.query<{ role_key: string; user_id: string }>(
      "SELECT user_id, role_key FROM athena_auth_user_role",
    );
    for (const row of userRoles.rows) {
      try {
        await this.authorization.assignUserRole(row.user_id, row.role_key);
      } catch {
        // Catalog roles are MemoryAuthorizationStore builtins; unknown keys stay unassigned.
      }
    }
    const memberRoles = await this.database.query<{
      member_id: string;
      role_key: string;
    }>("SELECT member_id, role_key FROM athena_auth_member_role");
    for (const row of memberRoles.rows) {
      const member = this.members.get(row.member_id);
      try {
        await this.authorization.assignMemberRole(
          row.member_id,
          row.role_key,
          undefined,
          member?.organization_id,
        );
      } catch {
        // Same catalog boundary as user roles.
      }
    }
  }

  override async createUser(input: CreateUserInput): Promise<AuthUserRow> {
    const row = await super.createUser(input);
    await this.database.query(
      `INSERT INTO athena_auth_user (
        id, email, name, image, username, display_username, email_verified,
        metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.email,
        row.name,
        row.image,
        row.username,
        row.display_username,
        flag(row.email_verified),
        JSON.stringify(row.metadata ?? {}),
        iso(row.created_at),
        iso(row.updated_at),
      ],
    );
    return row;
  }

  override async createSession(input: CreateSessionInput): Promise<AuthSessionRow> {
    const row = await super.createSession(input);
    await this.database.query(
      `INSERT INTO athena_auth_session (
        id, user_id, token, expires_at, ip_address, user_agent, impersonated_by,
        active_organization_id, active, authenticated_at, authentication_methods,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.token,
        iso(row.expires_at),
        row.ip_address,
        row.user_agent,
        row.impersonated_by,
        row.active_organization_id,
        flag(row.active),
        iso(row.authenticated_at),
        JSON.stringify(row.authentication_methods),
        iso(row.created_at),
        iso(row.updated_at),
      ],
    );
    return row;
  }

  override async createAccount(input: {
    accountId: string;
    id: string;
    password?: string;
    providerId: string;
    userId: string;
  }): Promise<AuthAccountRow> {
    const row = await super.createAccount(input);
    await this.database.query(
      `INSERT INTO athena_auth_account (
        id, user_id, provider_id, account_id, password, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.provider_id,
        row.account_id,
        row.password,
        iso(row.created_at),
        iso(row.updated_at),
      ],
    );
    return row;
  }

  override async createVerification(input: {
    expiresAt: Date;
    id: string;
    identifier: string;
    value: string;
  }): Promise<AuthVerificationRow> {
    const row = await super.createVerification(input);
    await this.database.query(
      `INSERT INTO athena_auth_verification (
        id, identifier, value, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.identifier,
        row.value,
        iso(row.expires_at),
        iso(row.created_at),
        iso(row.updated_at),
      ],
    );
    return row;
  }

  override async createOrganization(input: {
    createdByUserId: string;
    id: string;
    name: string;
    slug: string;
  }): Promise<AuthOrganizationRow> {
    const row = await super.createOrganization(input);
    await this.database.query(
      `INSERT INTO athena_auth_organization (
        id, name, slug, logo, metadata, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.slug,
        row.logo,
        JSON.stringify(row.metadata ?? {}),
        row.created_by_user_id,
        iso(row.created_at),
        iso(row.updated_at),
      ],
    );
    return row;
  }

  override async addMember(input: {
    assignedBy?: string;
    id: string;
    organizationId: string;
    role: string;
    userId: string;
  }): Promise<AuthMemberRow> {
    const row = await super.addMember(input);
    await this.database.query(
      `INSERT INTO athena_auth_member (
        id, organization_id, user_id, role, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.organization_id, row.user_id, row.role, iso(row.created_at)],
    );
    await this.database.query(
      `INSERT INTO athena_auth_member_role (member_id, role_key) VALUES (?, ?)`,
      [row.id, row.role],
    );
    return row;
  }

  override async createIdentityConnection(
    input: CreateAuthIdentityConnectionInput
  ): Promise<AuthIdentityConnectionRow> {
    const row = await super.createIdentityConnection(input);
    await this.database.query(
      `INSERT INTO athena_auth_identity_connection (
        id, organization_id, connection_type, name, issuer, client_id, resource_uri, token_endpoint_auth_method,
        credential_ref, enabled, domains, jit_enabled, jit_default_role_id,
        authentication_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.organization_id,
        row.connection_type,
        row.name,
        row.issuer,
        row.client_id,
        row.resource_uri,
        row.token_endpoint_auth_method,
        row.credential_ref,
        flag(row.enabled),
        JSON.stringify(row.domains),
        flag(row.jit_enabled),
        row.jit_default_role_id,
        flag(row.authentication_required),
        iso(row.created_at),
        iso(row.updated_at),
      ]
    );
    return row;
  }

  override async updateIdentityConnection(
    id: string,
    patch: UpdateAuthIdentityConnectionInput
  ): Promise<AuthIdentityConnectionRow | undefined> {
    const row = await super.updateIdentityConnection(id, patch);
    if (!row) return;
    await this.database.query(
      `UPDATE athena_auth_identity_connection SET
        name = ?, client_id = ?, resource_uri = ?, token_endpoint_auth_method = ?, credential_ref = ?, enabled = ?, domains = ?,
        jit_enabled = ?, jit_default_role_id = ?, authentication_required = ?,
        updated_at = ? WHERE id = ?`,
      [
        row.name,
        row.client_id,
        row.resource_uri,
        row.token_endpoint_auth_method,
        row.credential_ref,
        flag(row.enabled),
        JSON.stringify(row.domains),
        flag(row.jit_enabled),
        row.jit_default_role_id,
        flag(row.authentication_required),
        iso(row.updated_at),
        id,
      ]
    );
    return row;
  }

  override async disableIdentityConnection(id: string): Promise<boolean> {
    const disabled = await super.disableIdentityConnection(id);
    if (disabled) {
      await this.database.query(
        "UPDATE athena_auth_identity_connection SET enabled = 0, updated_at = ? WHERE id = ?",
        [new Date().toISOString(), id]
      );
    }
    return disabled;
  }

  override async linkFederatedIdentity(
    input: CreateAuthFederatedIdentityInput
  ): Promise<AuthFederatedIdentityRow> {
    const row = await super.linkFederatedIdentity(input);
    await this.database.query(
      `INSERT OR IGNORE INTO athena_auth_federated_identity (
        id, connection_id, issuer, subject, user_id, last_authenticated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.connection_id,
        row.issuer,
        row.subject,
        row.user_id,
        row.last_authenticated_at
          ? iso(row.last_authenticated_at)
          : null,
        iso(row.created_at),
        iso(row.updated_at),
      ]
    );
    const existing = await this.database.query<AuthFederatedIdentityRow>(
      `SELECT * FROM athena_auth_federated_identity
       WHERE connection_id = ? AND issuer = ? AND subject = ?`,
      [row.connection_id, row.issuer, row.subject]
    );
    if (existing.rows[0]?.user_id !== input.userId) {
      throw new Error("federated identity is already linked");
    }
    this.federatedIdentities.set(existing.rows[0].id, existing.rows[0]);
    return existing.rows[0];
  }

  override async touchFederatedIdentity(id: string, at: Date): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE athena_auth_federated_identity
       SET last_authenticated_at = ?, updated_at = ? WHERE id = ?`,
      [at.toISOString(), new Date().toISOString(), id]
    );
    const touched = (result.rowCount ?? 0) > 0;
    if (touched) await super.touchFederatedIdentity(id, at);
    return touched;
  }
}

function parseJsonArray(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}
