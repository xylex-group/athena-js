import type { AthenaAuthDatabase } from "./database.ts";
import { MemoryAuthStores } from "./memory-stores.ts";
import { ATHENA_AUTH_SQLITE_SCHEMA } from "./sqlite-schema.ts";
import type {
  AuthAccountRow,
  AuthMemberRow,
  AuthOrganizationRow,
  AuthSessionRow,
  AuthUserRow,
  AuthVerificationRow,
} from "./models.ts";
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
}
