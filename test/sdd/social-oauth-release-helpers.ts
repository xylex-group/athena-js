import { createServer } from "node:net";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import type { StartedOAuthFixture } from "../fixtures/oauth-provider/index.ts";

export const RELEASE_SECRET = "athena-social-oauth-release-secret-32!!";

export function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

export async function listenPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

export function testProviderConfig(fixture: StartedOAuthFixture) {
  return {
    clientId: fixture.clientId,
    clientSecret: fixture.clientSecret,
    issuer: fixture.issuer,
  };
}

export function createFixtureSocialRuntime(input: {
  fixture: StartedOAuthFixture;
  origin: string;
  second?: boolean;
}) {
  const providers: Record<string, ReturnType<typeof testProviderConfig>> = {
    testProvider: testProviderConfig(input.fixture),
  };
  if (input.second) {
    providers.testProviderB = {
      clientId: input.fixture.secondClientId,
      clientSecret: input.fixture.secondClientSecret,
      issuer: input.fixture.issuer,
    };
  }
  return createAthenaAuthRuntime({
    autoMigrate: false,
    config: normalizeAthenaAuthConfig({
      basePath: "/api/auth",
      mode: "local",
      secret: RELEASE_SECRET,
      security: {
        trustedOrigins: [input.origin],
      },
      social: { providers },
    }),
    hasher: createTestHasher(),
    secret: RELEASE_SECRET,
  });
}

export function cookieHeader(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : [];
  if (cookies.length > 0) {
    return cookies
      .map((entry) => entry.split(";", 1)[0])
      .filter(Boolean)
      .join("; ");
  }
  const single = response.headers.get("set-cookie");
  return single ? (single.split(";", 1)[0] ?? "") : "";
}

export async function followProviderAuthorization(
  authorizeUrl: string,
  scenario?: string
): Promise<{ code: string; state: string }> {
  const url = new URL(authorizeUrl);
  if (scenario) {
    url.searchParams.set("scenario", scenario);
  }
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location");
  if (!location) {
    throw new Error(`provider authorize missing Location (${response.status})`);
  }
  const dest = new URL(location);
  return {
    code: dest.searchParams.get("code") ?? "",
    state: dest.searchParams.get("state") ?? "",
  };
}

export function assertNoBearerInLocation(location: string | null): void {
  if (!location) {
    return;
  }
  if (/(?:^|[?&])(?:token|session|bearer)=/i.test(location)) {
    throw new Error(`Location must not contain a session bearer: ${location}`);
  }
}
