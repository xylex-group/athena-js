import { createServer, type Server } from "node:http";
import { handleAuthorization } from "./authorization.ts";
import { createOAuthFixtureKeys, handleJwks } from "./jwks.ts";
import { handleToken } from "./token.ts";
import type { OAuthFixtureConfig, OAuthFixtureStore } from "./types.ts";
import { handleUserInfo } from "./userinfo.ts";

export interface StartedOAuthFixture {
  clientId: string;
  clientSecret: string;
  close: () => Promise<void>;
  issuer: string;
  secondClientId: string;
  secondClientSecret: string;
  url: string;
}

function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function startOAuthProviderFixture(options?: {
  host?: string;
  port?: number;
}): Promise<StartedOAuthFixture> {
  const host = options?.host ?? "127.0.0.1";
  const keys = await createOAuthFixtureKeys();
  const store: OAuthFixtureStore = {
    codes: new Map(),
    refreshTokens: new Map(),
    tokens: new Map(),
  };
  let issuer = "";
  const config: OAuthFixtureConfig = {
    clientId: "athena-test",
    clientSecret: "athena-test-secret",
    issuer: "",
    secondClientId: "athena-test-b",
    secondClientSecret: "athena-test-secret-b",
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", issuer);
        const method = (req.method ?? "GET").toUpperCase();
        const body = await readBody(req);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === "string") {
            headers.set(key, value);
          } else if (Array.isArray(value)) {
            headers.set(key, value.join(", "));
          }
        }
        const web = new Request(url, {
          body:
            body.length > 0 && method !== "GET" && method !== "HEAD"
              ? new Uint8Array(body)
              : undefined,
          headers,
          method,
        });
        let response: Response;
        if (url.pathname === "/oauth/authorize" && method === "GET") {
          response = handleAuthorization(url, store, {
            ...config,
            issuer,
          });
        } else if (url.pathname === "/oauth/token" && method === "POST") {
          response = await handleToken(web, store, { ...config, issuer }, keys);
        } else if (url.pathname === "/oauth/userinfo" && method === "GET") {
          response = handleUserInfo(web, store);
        } else if (url.pathname === "/oauth/jwks" && method === "GET") {
          response = handleJwks(keys);
        } else if (
          url.pathname === "/.well-known/openid-configuration" &&
          method === "GET"
        ) {
          response = Response.json({
            authorization_endpoint: `${issuer}/oauth/authorize`,
            id_token_signing_alg_values_supported: ["RS256"],
            issuer,
            jwks_uri: `${issuer}/oauth/jwks`,
            token_endpoint: `${issuer}/oauth/token`,
            userinfo_endpoint: `${issuer}/oauth/userinfo`,
          });
        } else {
          response = new Response("not found", { status: 404 });
        }
        const outHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          outHeaders[key] = value;
        });
        res.writeHead(response.status, outHeaders);
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(error instanceof Error ? error.message : String(error));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(options?.port ?? 0, host, () => resolve());
    server.on("error", reject);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address
      ? address.port
      : (options?.port ?? 0);
  issuer = `http://${host}:${port}`;
  config.issuer = issuer;

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    issuer,
    secondClientId: config.secondClientId ?? "athena-test-b",
    secondClientSecret: config.secondClientSecret ?? "athena-test-secret-b",
    url: issuer,
  };
}
