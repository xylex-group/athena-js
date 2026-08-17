/**
 * Delete a users row by app-level resource_id, then fall back to primary key id.
 * Matches apps/cloudflare-edge route semantics.
 *
 * `.delete()` returns a thenable MutationQuery — always await it.
 */
export async function deleteUserByIdOrResourceId(
  athena: {
    from: (table: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        delete: () => PromiseLike<{
          count: number | null;
          error: { message: string } | null;
        }>;
      };
    };
  },
  id: string
): Promise<{
  count: number | null;
  error: string | null;
  matched: "resource_id" | "id" | "none";
}> {
  const byResource = await athena.from("users").eq("resource_id", id).delete();
  if (byResource.error) {
    return {
      count: byResource.count,
      error: byResource.error.message,
      matched: "resource_id",
    };
  }
  if ((byResource.count ?? 0) > 0) {
    return {
      count: byResource.count,
      error: null,
      matched: "resource_id",
    };
  }

  const byId = await athena.from("users").eq("id", id).delete();
  if (byId.error) {
    return {
      count: byId.count,
      error: byId.error.message,
      matched: "id",
    };
  }
  return {
    count: byId.count,
    error: null,
    matched: (byId.count ?? 0) > 0 ? "id" : "none",
  };
}
