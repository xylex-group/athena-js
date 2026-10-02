import { AthenaAuthRuntimeError } from "../errors.ts";
import type { AthenaAuthStores } from "../store-contract.ts";

export async function requireIdentityConnectionForEmail(
  stores: AthenaAuthStores,
  email: string | null | undefined,
  connectionId?: string
): Promise<void> {
  const domain = email?.split("@").at(-1)?.toLowerCase();
  if (!domain) return;
  const connection = await stores.findIdentityConnectionByDomain(domain);
  if (
    connection?.authentication_required &&
    connection.id !== connectionId
  ) {
    throw AthenaAuthRuntimeError.forbidden(
      "This organization requires single sign-on"
    );
  }
}
