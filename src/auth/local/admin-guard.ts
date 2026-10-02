import { AthenaAuthRuntimeError } from "../runtime-error.ts";
import { isAthenaAdminRole } from "./admin-contract.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";

export async function requireAthenaAdmin(
  request: Request,
  requireSession: (request: Request) => Promise<{
    session: AuthSessionRow;
    token: string;
    user: AuthUserRow;
  }>
) {
  const resolved = await requireSession(request);
  if (!isAthenaAdminRole(resolved.user.role)) {
    throw AthenaAuthRuntimeError.forbidden("Administrator access required");
  }
  return resolved;
}
