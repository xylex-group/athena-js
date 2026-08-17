import type { AthenaSessionData } from "./session-data.ts";
import { toSessionData } from "./session-data.ts";
import type {
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthUser,
} from "./types.ts";

export interface DerivedSessionView<
  TData extends AthenaSessionData | AthenaAuthSessionResponse | null =
    | AthenaSessionData
    | null,
> {
  data: TData;
  isAuthenticated: boolean;
  organization: AthenaSessionData["organization"] | null;
  organizationId: string | null;
  session: AthenaAuthSession | null;
  user: AthenaAuthUser | null;
}

/**
 * Derive convenience fields from a transport or normalized session payload.
 *
 * Browser path: activeId === rawActiveId (no server organization repair).
 */
export function deriveSessionView(
  data: AthenaAuthSessionResponse | AthenaSessionData | null | undefined
): DerivedSessionView<AthenaSessionData | null> {
  if (!data) {
    return {
      data: null,
      isAuthenticated: false,
      organization: null,
      organizationId: null,
      session: null,
      user: null,
    };
  }

  const normalized: AthenaSessionData =
    "organization" in data && data.organization
      ? (data as AthenaSessionData)
      : toSessionData(data as AthenaAuthSessionResponse);

  return {
    data: normalized,
    isAuthenticated: Boolean(normalized.user?.id),
    organization: normalized.organization,
    organizationId: normalized.organization.activeId,
    session: normalized.session,
    user: normalized.user,
  };
}
