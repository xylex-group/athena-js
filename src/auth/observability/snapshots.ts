import {
  sanitizeAuthApiKey,
  sanitizeAuthInvitation,
  sanitizeAuthMember,
  sanitizeAuthOrganization,
  sanitizeAuthPasskey,
  sanitizeAuthSession,
  sanitizeAuthUser,
} from "../domain/payloads.ts";

export {
  sanitizeAuthApiKey,
  sanitizeAuthInvitation,
  sanitizeAuthMember,
  sanitizeAuthOrganization,
  sanitizeAuthPasskey,
  sanitizeAuthSession,
  sanitizeAuthUser,
};

export interface AthenaAuthAuditTombstone {
  deleted: true;
  id: string;
  organizationId?: string;
  userId?: string;
}

export interface AthenaAuthSessionRevokeReceipt {
  id: string;
  revoked: true;
  userId: string;
}

export function toAuthAuditTombstone(input: {
  id: string;
  organizationId?: string;
  userId?: string;
}): AthenaAuthAuditTombstone {
  const tombstone: AthenaAuthAuditTombstone = {
    deleted: true,
    id: input.id,
  };
  if (input.organizationId !== undefined) {
    tombstone.organizationId = input.organizationId;
  }
  if (input.userId !== undefined) {
    tombstone.userId = input.userId;
  }
  return tombstone;
}

export function toAuthSessionRevokeReceipt(input: {
  id: string;
  userId: string;
}): AthenaAuthSessionRevokeReceipt {
  return {
    id: input.id,
    revoked: true,
    userId: input.userId,
  };
}

export function splitPrimaryAndRest<T>(
  items: readonly T[]
): { primary: T; rest: T[] } | undefined {
  const [primary, ...rest] = items;
  if (primary === undefined) {
    return;
  }
  return { primary, rest };
}
