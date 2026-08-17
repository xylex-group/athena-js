import type { JSONWebKeySet } from "jose";
import { fetchRefusingRedirects } from "../reject-redirects.ts";
import type { JwksFetchOptions } from "./types.ts";

export async function fetchJwks(
  jwksFetch: JwksFetchOptions["jwksFetch"]
): Promise<JSONWebKeySet> {
  const jwks =
    typeof jwksFetch === "string"
      ? await fetchRefusingRedirects<JSONWebKeySet>(jwksFetch, {
          headers: {
            Accept: "application/json",
          },
        }).then(async (res) => {
          if (res.error) {
            throw new Error(
              `Jwks failed: ${res.error.message ?? res.error.statusText}`
            );
          }
          return res.data;
        })
      : await jwksFetch();
  if (!jwks) {
    throw new Error("No jwks found");
  }
  return jwks;
}
