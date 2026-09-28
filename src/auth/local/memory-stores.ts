import { MemoryAuthorizationStore } from "../../runtime/authorization/memory.ts";
import {
  mapLegacyUserRole,
  resolveMemberAssignmentRole,
} from "../../runtime/authorization/templates.ts";
import { resolveAuthenticationContext } from "./authentication-context.ts";
import type {
  AuthAccountRow,
  AuthInvitationRow,
  AuthMemberRow,
  AuthOrganizationRow,
  AuthPasskeyRow,
  AuthSessionRow,
  AuthUserRow,
  AuthVerificationRow,
} from "./models.ts";
import type {
  AuthApiKeyRow,
  AuthTwoFactorRow,
  CreateSessionInput,
  CreateUserInput,
  UpdateUserPatch,
} from "./stores.ts";

function now(): Date {
  return new Date();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryAuthStores {
  readonly authorization = new MemoryAuthorizationStore();
  readonly accounts = new Map<string, AuthAccountRow>();
  readonly invitations = new Map<string, AuthInvitationRow>();
  readonly members = new Map<string, AuthMemberRow>();
  readonly organizations = new Map<string, AuthOrganizationRow>();
  readonly sessions = new Map<string, AuthSessionRow>();
  readonly users = new Map<string, AuthUserRow>();
  readonly verifications = new Map<string, AuthVerificationRow>();
  readonly apiKeys = new Map<string, AuthApiKeyRow>();
  readonly twoFactors = new Map<string, AuthTwoFactorRow>();
  readonly rateLimits = new Map<string, { count: number; resetAt: number }>();
  readonly verificationReplacementLocks = new Map<string, Promise<void>>();
  readonly passkeys = new Map<string, AuthPasskeyRow>();
  readonly passkeyRegistrationTransactions = new Map<
    string,
    {
      challenge_hash: string;
      consumed_at: Date | string | null;
      context: string | null;
      created_at: Date | string;
      expires_at: Date | string;
      id: string;
      mode: string;
      rp_id: string;
      user_handle: string;
    }
  >();

  async getUserById(id: string): Promise<AuthUserRow | undefined> {
    const row = this.users.get(id);
    return row ? clone(row) : undefined;
  }

  async getUserByEmail(email: string): Promise<AuthUserRow | undefined> {
    const needle = email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if ((user.email ?? "").trim().toLowerCase() === needle) {
        return clone(user);
      }
    }
  }

  async getUserByUsername(username: string): Promise<AuthUserRow | undefined> {
    for (const user of this.users.values()) {
      if (user.username === username) {
        return clone(user);
      }
    }
  }

  async listUsers(): Promise<AuthUserRow[]> {
    return [...this.users.values()].map((row) => clone(row));
  }

  async createUser(input: CreateUserInput): Promise<AuthUserRow> {
    if (input.email && (await this.getUserByEmail(input.email))) {
      const error = new Error("duplicate key value violates unique constraint");
      (error as { code?: string }).code = "23505";
      throw error;
    }
    const created = now();
    const row: AuthUserRow = {
      ban_expires: null,
      ban_reason: null,
      banned: false,
      created_at: created,
      display_username: input.displayUsername ?? null,
      email: input.email ?? null,
      email_verified: input.emailVerified ?? false,
      id: input.id,
      image: input.image ?? null,
      last_sign_in_at: null,
      metadata: input.metadata ?? {},
      name: input.name ?? null,
      role: null,
      two_factor_enabled: false,
      updated_at: created,
      username: input.username ?? null,
    };
    this.users.set(row.id, row);
    await this.authorization.assignUserRole(
      row.id,
      mapLegacyUserRole(row.role)
    );
    return clone(row);
  }

  async updateUser(id: string, patch: UpdateUserPatch): Promise<AuthUserRow> {
    const existing = this.users.get(id);
    if (!existing) {
      throw new Error("User not found");
    }
    const next: AuthUserRow = {
      ...existing,
      ban_expires:
        patch.banExpires === undefined
          ? existing.ban_expires
          : patch.banExpires,
      ban_reason:
        patch.banReason === undefined ? existing.ban_reason : patch.banReason,
      banned: patch.banned ?? existing.banned,
      email: patch.email ?? existing.email,
      email_verified: patch.emailVerified ?? existing.email_verified,
      image: patch.image === undefined ? existing.image : patch.image,
      last_sign_in_at: patch.lastSignInAt ?? existing.last_sign_in_at,
      metadata: patch.metadata ?? existing.metadata,
      name: patch.name === undefined ? existing.name : patch.name,
      role: patch.role === undefined ? existing.role : patch.role,
      two_factor_enabled: patch.twoFactorEnabled ?? existing.two_factor_enabled,
      updated_at: now(),
    };
    this.users.set(id, next);
    if (patch.role !== undefined) {
      await this.authorization.assignUserRole(
        id,
        mapLegacyUserRole(patch.role)
      );
    }
    return clone(next);
  }

  async hasAuthorizationAssignment(userId: string): Promise<boolean> {
    return this.authorization.hasUserAssignment(userId);
  }

  async resolveEffectiveRights(input: {
    activeOrganizationId?: string | null;
    userId: string;
  }): Promise<readonly string[]> {
    const rights = await this.authorization.resolveEffectiveRights({
      activeOrganizationId: input.activeOrganizationId,
      getMember: (organizationId, memberUserId) =>
        this.getMember(organizationId, memberUserId),
      userId: input.userId,
    });
    return [...rights];
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
    for (const [key, session] of this.sessions) {
      if (session.user_id === id) {
        this.sessions.delete(key);
      }
    }
    for (const [key, account] of this.accounts) {
      if (account.user_id === id) {
        this.accounts.delete(key);
      }
    }
    for (const [key, member] of this.members) {
      if (member.user_id === id) {
        this.members.delete(key);
      }
    }
    this.twoFactors.delete(id);
    for (const [key, apiKey] of this.apiKeys) {
      if (apiKey.user_id === id) {
        this.apiKeys.delete(key);
      }
    }
  }

  async createSession(input: CreateSessionInput): Promise<AuthSessionRow> {
    const created = now();
    const authentication = resolveAuthenticationContext(
      {
        authenticatedAt: input.authenticatedAt,
        methods: input.authenticationMethods ?? [],
      },
      created
    );
    const row: AuthSessionRow = {
      active: true,
      active_organization_id: input.activeOrganizationId ?? null,
      authenticated_at: authentication.authenticatedAt,
      authentication_methods: [...authentication.methods],
      created_at: created,
      expires_at: input.expiresAt,
      id: input.id,
      impersonated_by: input.impersonatedBy ?? null,
      ip_address: input.ipAddress ?? null,
      token: input.token,
      updated_at: created,
      user_agent: input.userAgent ?? null,
      user_id: input.userId,
    };
    this.sessions.set(row.token, row);
    return clone(row);
  }

  async getSessionByToken(token: string): Promise<AuthSessionRow | undefined> {
    const row = this.sessions.get(token);
    if (!row?.active || new Date(row.expires_at).getTime() <= Date.now()) {
      return;
    }
    return clone(row);
  }

  async updateSessionExpiry(token: string, expiresAt: Date): Promise<void> {
    const row = this.sessions.get(token);
    if (!row) {
      return;
    }
    row.expires_at = expiresAt;
    row.updated_at = now();
  }

  async setSessionActiveOrganization(
    token: string,
    organizationId: string | null
  ): Promise<void> {
    const row = this.sessions.get(token);
    if (!row) {
      return;
    }
    row.active_organization_id = organizationId;
    row.updated_at = now();
  }

  async clearUserActiveOrganization(
    userId: string,
    organizationId: string
  ): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (
        session.user_id === userId &&
        session.active_organization_id === organizationId
      ) {
        session.active_organization_id = null;
        session.updated_at = now();
        count += 1;
      }
    }
    return count;
  }

  async clearOrganizationActiveSessions(
    organizationId: string
  ): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.active_organization_id === organizationId) {
        session.active_organization_id = null;
        session.updated_at = now();
        count += 1;
      }
    }
    return count;
  }

  async listUserSessions(userId: string): Promise<AuthSessionRow[]> {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.user_id === userId &&
          session.active &&
          new Date(session.expires_at).getTime() > Date.now()
      )
      .map((session) => clone(session));
  }

  async deleteSession(token: string): Promise<boolean> {
    return this.sessions.delete(token);
  }

  async deleteUserSessions(
    userId: string,
    exceptToken?: string
  ): Promise<number> {
    let count = 0;
    for (const [token, session] of this.sessions) {
      if (session.user_id === userId && token !== exceptToken) {
        this.sessions.delete(token);
        count += 1;
      }
    }
    return count;
  }

  async createAccount(input: {
    accountId: string;
    id: string;
    password?: string;
    providerId: string;
    userId: string;
  }): Promise<AuthAccountRow> {
    const created = now();
    const row: AuthAccountRow = {
      access_token: null,
      access_token_expires_at: null,
      account_id: input.accountId,
      created_at: created,
      id: input.id,
      id_token: null,
      password: input.password ?? null,
      provider_id: input.providerId,
      refresh_token: null,
      refresh_token_expires_at: null,
      scope: null,
      updated_at: created,
      user_id: input.userId,
    };
    this.accounts.set(row.id, row);
    return clone(row);
  }

  async listAccounts(userId: string): Promise<AuthAccountRow[]> {
    return [...this.accounts.values()]
      .filter((account) => account.user_id === userId)
      .map((account) => clone(account));
  }

  async findAccountByProvider(
    providerId: string,
    accountId: string
  ): Promise<AuthAccountRow | undefined> {
    for (const account of this.accounts.values()) {
      if (
        account.provider_id === providerId &&
        account.account_id === accountId
      ) {
        return clone(account);
      }
    }
  }

  async deleteAccount(id: string): Promise<void> {
    this.accounts.delete(id);
  }

  async createVerification(input: {
    expiresAt: Date;
    id: string;
    identifier: string;
    value: string;
  }): Promise<AuthVerificationRow> {
    const created = now();
    const row: AuthVerificationRow = {
      created_at: created,
      expires_at: input.expiresAt,
      id: input.id,
      identifier: input.identifier,
      updated_at: created,
      value: input.value,
    };
    this.verifications.set(row.value, row);
    return clone(row);
  }

  async replaceVerificationByIdentifier(input: {
    expiresAt: Date;
    id: string;
    identifier: string;
    value: string;
  }): Promise<AuthVerificationRow> {
    const previous = this.verificationReplacementLocks.get(input.identifier);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous ? previous.then(() => current) : current;
    this.verificationReplacementLocks.set(input.identifier, queued);
    await previous;
    try {
      await this.deleteVerificationsByIdentifier(input.identifier);
      return await this.createVerification(input);
    } finally {
      release();
      if (this.verificationReplacementLocks.get(input.identifier) === queued) {
        this.verificationReplacementLocks.delete(input.identifier);
      }
    }
  }

  async deleteVerificationsByIdentifier(identifier: string): Promise<number> {
    let deleted = 0;
    for (const [value, row] of this.verifications) {
      if (row.identifier === identifier) {
        this.verifications.delete(value);
        deleted += 1;
      }
    }
    return deleted;
  }

  async consumeVerification(
    value: string
  ): Promise<AuthVerificationRow | undefined> {
    const row = this.verifications.get(value);
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      this.verifications.delete(value);
      return;
    }
    this.verifications.delete(value);
    return clone(row);
  }

  async consumeRateLimit(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<boolean> {
    const current = Date.now();
    const existing = this.rateLimits.get(key);
    if (!existing || existing.resetAt <= current) {
      this.rateLimits.set(key, { count: 1, resetAt: current + windowMs });
      return true;
    }
    if (existing.count >= limit) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  async clearRateLimit(key: string): Promise<void> {
    this.rateLimits.delete(key);
  }

  async isRateLimited(key: string, limit: number): Promise<boolean> {
    const existing = this.rateLimits.get(key);
    return Boolean(
      existing && existing.resetAt > Date.now() && existing.count >= limit
    );
  }

  async getVerification(
    value: string
  ): Promise<AuthVerificationRow | undefined> {
    const row = this.verifications.get(value);
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      return;
    }
    return clone(row);
  }

  async consumeVerificationByIdentifierAndValue(
    identifier: string,
    value: string
  ): Promise<AuthVerificationRow | undefined> {
    const row = this.verifications.get(value);
    if (
      !row ||
      row.identifier !== identifier ||
      new Date(row.expires_at).getTime() <= Date.now()
    ) {
      return;
    }
    this.verifications.delete(value);
    return clone(row);
  }

  async expirePasskeyVerifications(now: Date): Promise<number> {
    const cutoff = now.getTime();
    let deleted = 0;
    for (const [key, row] of [...this.verifications.entries()]) {
      if (
        row.identifier.startsWith("passkey:") &&
        new Date(row.expires_at).getTime() <= cutoff
      ) {
        this.verifications.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async createOrganization(input: {
    createdByUserId: string;
    id: string;
    name: string;
    slug: string;
  }): Promise<AuthOrganizationRow> {
    if (await this.getOrganizationBySlug(input.slug)) {
      const error = new Error("duplicate key value violates unique constraint");
      (error as { code?: string }).code = "23505";
      throw error;
    }
    const created = now();
    const row: AuthOrganizationRow = {
      created_at: created,
      created_by_user_id: input.createdByUserId,
      id: input.id,
      logo: null,
      metadata: {},
      name: input.name,
      slug: input.slug,
      updated_at: created,
    };
    this.organizations.set(row.id, row);
    return clone(row);
  }

  async getOrganization(id: string): Promise<AuthOrganizationRow | undefined> {
    const row = this.organizations.get(id);
    return row ? clone(row) : undefined;
  }

  async getOrganizationBySlug(
    slug: string
  ): Promise<AuthOrganizationRow | undefined> {
    for (const organization of this.organizations.values()) {
      if (organization.slug === slug) {
        return clone(organization);
      }
    }
  }

  async listOrganizationsForUser(
    userId: string
  ): Promise<AuthOrganizationRow[]> {
    const orgIds = [...this.members.values()]
      .filter((member) => member.user_id === userId)
      .map((member) => member.organization_id);
    return orgIds
      .map((id) => this.organizations.get(id))
      .filter((row): row is AuthOrganizationRow => Boolean(row))
      .map((row) => clone(row));
  }

  async updateOrganization(
    id: string,
    patch: { logo?: string | null; name?: string; slug?: string }
  ): Promise<AuthOrganizationRow> {
    const existing = this.organizations.get(id);
    if (!existing) {
      throw new Error("Organization not found");
    }
    const next: AuthOrganizationRow = {
      ...existing,
      logo: patch.logo === undefined ? existing.logo : patch.logo,
      name: patch.name ?? existing.name,
      slug: patch.slug ?? existing.slug,
      updated_at: now(),
    };
    this.organizations.set(id, next);
    return clone(next);
  }

  async deleteOrganization(id: string): Promise<void> {
    this.organizations.delete(id);
    for (const [key, apiKey] of this.apiKeys) {
      if (apiKey.organization_id === id) {
        this.apiKeys.delete(key);
      }
    }
    for (const [key, member] of this.members) {
      if (member.organization_id === id) {
        this.members.delete(key);
      }
    }
    for (const [key, invitation] of this.invitations) {
      if (invitation.organization_id === id) {
        this.invitations.delete(key);
      }
    }
  }

  async addMember(input: {
    assignedBy?: string;
    id: string;
    organizationId: string;
    role: string;
    userId: string;
  }): Promise<AuthMemberRow> {
    const created = now();
    const row: AuthMemberRow = {
      created_at: created,
      id: input.id,
      organization_id: input.organizationId,
      role: input.role,
      user_id: input.userId,
    };
    this.members.set(row.id, row);
    await this.authorization.assignMemberRole(
      row.id,
      resolveMemberAssignmentRole(row.role),
      input.assignedBy,
      input.organizationId
    );
    return clone(row);
  }

  async getMember(
    organizationId: string,
    userId: string
  ): Promise<AuthMemberRow | undefined> {
    for (const member of this.members.values()) {
      if (
        member.organization_id === organizationId &&
        member.user_id === userId
      ) {
        return clone(member);
      }
    }
  }

  async listMembers(organizationId: string): Promise<AuthMemberRow[]> {
    return [...this.members.values()]
      .filter((member) => member.organization_id === organizationId)
      .map((member) => clone(member));
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: string
  ): Promise<AuthMemberRow | undefined> {
    for (const member of this.members.values()) {
      if (
        member.organization_id === organizationId &&
        member.user_id === userId
      ) {
        member.role = role;
        await this.authorization.assignMemberRole(
          member.id,
          resolveMemberAssignmentRole(role),
          undefined,
          organizationId
        );
        return clone(member);
      }
    }
  }

  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    for (const [key, member] of this.members) {
      if (
        member.organization_id === organizationId &&
        member.user_id === userId
      ) {
        this.members.delete(key);
        return true;
      }
    }
    return false;
  }

  async createInvitation(input: {
    email: string;
    expiresAt: Date;
    id: string;
    inviterId: string;
    organizationId: string;
    role: string;
  }): Promise<AuthInvitationRow> {
    const created = now();
    const row: AuthInvitationRow = {
      created_at: created,
      email: input.email,
      expires_at: input.expiresAt,
      id: input.id,
      inviter_id: input.inviterId,
      organization_id: input.organizationId,
      role: input.role,
      status: "pending",
    };
    this.invitations.set(row.id, row);
    return clone(row);
  }

  async getInvitation(id: string): Promise<AuthInvitationRow | undefined> {
    const row = this.invitations.get(id);
    return row ? clone(row) : undefined;
  }

  async listInvitations(organizationId: string): Promise<AuthInvitationRow[]> {
    return [...this.invitations.values()]
      .filter((invitation) => invitation.organization_id === organizationId)
      .map((invitation) => clone(invitation));
  }

  async listInvitationsForEmail(email: string): Promise<AuthInvitationRow[]> {
    const needle = email.toLowerCase();
    return [...this.invitations.values()]
      .filter((invitation) => invitation.email?.toLowerCase() === needle)
      .map((invitation) => clone(invitation));
  }

  async updateInvitationStatus(
    id: string,
    status: string
  ): Promise<AuthInvitationRow | undefined> {
    const row = this.invitations.get(id);
    if (!row) {
      return;
    }
    row.status = status;
    return clone(row);
  }

  async getVerificationByValue(
    value: string
  ): Promise<AuthVerificationRow | undefined> {
    const row = this.verifications.get(value);
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      return;
    }
    return clone(row);
  }

  async createTwoFactor(input: {
    backupCodes?: string;
    id: string;
    secret: string;
    userId: string;
  }): Promise<AuthTwoFactorRow> {
    const created = now();
    const row: AuthTwoFactorRow = {
      backup_codes: input.backupCodes ?? null,
      created_at: created,
      id: input.id,
      secret: input.secret,
      updated_at: created,
      user_id: input.userId,
    };
    this.twoFactors.set(input.userId, row);
    return clone(row);
  }

  async getTwoFactorByUserId(
    userId: string
  ): Promise<AuthTwoFactorRow | undefined> {
    const row = this.twoFactors.get(userId);
    return row ? clone(row) : undefined;
  }

  async updateTwoFactorBackupCodes(
    userId: string,
    backupCodes: string
  ): Promise<void> {
    const row = this.twoFactors.get(userId);
    if (row) {
      row.backup_codes = backupCodes;
      row.updated_at = now();
    }
  }

  async deleteTwoFactor(userId: string): Promise<void> {
    this.twoFactors.delete(userId);
  }

  async createApiKey(input: AuthApiKeyRow): Promise<AuthApiKeyRow> {
    this.apiKeys.set(input.id, { ...input });
    return clone(input);
  }

  async getApiKeyByHash(hash: string): Promise<AuthApiKeyRow | undefined> {
    for (const key of this.apiKeys.values()) {
      if (key.key === hash) {
        return clone(key);
      }
    }
  }

  async getApiKeyById(id: string): Promise<AuthApiKeyRow | undefined> {
    const row = this.apiKeys.get(id);
    return row ? clone(row) : undefined;
  }

  async listApiKeys(userId: string): Promise<AuthApiKeyRow[]> {
    return [...this.apiKeys.values()]
      .filter((key) => key.user_id === userId)
      .map((key) => clone(key));
  }

  async deleteApiKey(id: string): Promise<boolean> {
    return this.apiKeys.delete(id);
  }

  async deleteExpiredApiKeys(): Promise<number> {
    let count = 0;
    const nowMs = Date.now();
    for (const [id, key] of this.apiKeys) {
      if (key.expires_at && new Date(key.expires_at).getTime() <= nowMs) {
        this.apiKeys.delete(id);
        count += 1;
      }
    }
    return count;
  }

  async touchApiKey(id: string): Promise<void> {
    const row = this.apiKeys.get(id);
    if (row) {
      row.last_request = now();
      row.updated_at = now();
    }
  }

  async consumeApiKey(id: string): Promise<AuthApiKeyRow | undefined> {
    const row = this.apiKeys.get(id);
    if (
      !row?.enabled ||
      (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) ||
      (row.remaining !== null && row.remaining <= 0)
    ) {
      return undefined;
    }
    row.last_request = now();
    row.updated_at = now();
    if (row.remaining !== null) {
      row.remaining -= 1;
    }
    return clone(row);
  }

  async updateApiKey(
    id: string,
    patch: {
      enabled?: boolean;
      metadata?: string | null;
      name?: string | null;
      permissions?: string | null;
    }
  ): Promise<AuthApiKeyRow | undefined> {
    const row = this.apiKeys.get(id);
    if (!row) {
      return;
    }
    if (patch.enabled !== undefined) {
      row.enabled = patch.enabled;
    }
    if (patch.metadata !== undefined) {
      row.metadata = patch.metadata;
    }
    if (patch.name !== undefined) {
      row.name = patch.name;
    }
    if (patch.permissions !== undefined) {
      row.permissions = patch.permissions;
    }
    row.updated_at = now();
    return clone(row);
  }
}

export type { AthenaAuthStores } from "./store-contract.ts";
