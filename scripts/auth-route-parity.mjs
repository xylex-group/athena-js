/**
 * Mechanical Athena Auth route + operation inventory.
 * Compares Rust AuthRoute tables to the JS SDK endpoint union and
 * embedded local-runtime path matches. Live source is authoritative.
 *
 * Emits:
 *   contracts/auth/routes.generated.json
 *   src/auth/contract/operations.generated.ts
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "../..");

const RUST_ROOTS = [
  path.join(repoRoot, "services/athena-auth/crates/api/src"),
  path.join(repoRoot, "services/athena-auth/crates/core/src"),
];

const JS_LOCAL_ROOT = path.join(packageRoot, "src/auth/local");
const JS_TYPES = path.join(packageRoot, "src/auth/types.ts");

const NONPORTABLE = new Set([
  "GET /reference/openapi.json",
  "GET /admin/docs.html",
  "GET /admin/api-config.json",
  "GET /schema-debug",
  "GET /schema-debug.html",
]);

/**
 * Rust serves these but the AuthRoute:: string scanner misses const /
 * ADMIN_ROUTES table registration. Overlay support only — do not invent
 * routes that the dedicated service does not actually expose.
 */
const RUST_SERVED_OVERLAY = [
  "GET /ok",
  "GET /health",
  "GET /.well-known/webauthn",
  "POST /update-user",
  "GET /admin/email-event-type/list",
  "GET /admin/email-failure/get",
  "GET /admin/email-failure/list",
  "GET /admin/email-template/get",
  "GET /admin/email-template/list",
  "GET /admin/email/get",
  "GET /admin/email/list",
  "POST /admin/email-failure/create",
  "POST /admin/email-failure/delete",
  "POST /admin/email-failure/update",
  "POST /admin/email-template/create",
  "POST /admin/email-template/delete",
  "POST /admin/email-template/send",
  "POST /admin/email-template/update",
  "POST /admin/email/create",
  "POST /admin/email/delete",
  "POST /admin/email/update",
];

const PUBLIC_PATHS = new Set([
  "/ok",
  "/health",
  "/error",
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/username",
  "/sign-in/social",
  "/callback/{provider}",
  "/forget-password",
  "/reset-password",
  "/reset-password/{token}",
  "/verify-email",
  "/send-verification-email",
  "/change-email/verify",
  "/delete-user/verify",
  "/delete-user/callback",
  "/.well-known/jwks.json",
  "/.well-known/openid-configuration",
  "/.well-known/webauthn",
  "/token",
  "/reference/openapi.json",
  "/passkey/verify-authentication",
  "/session/bridge/exchange",
]);

/** Session present → identified credentials; absent → discoverable. */
const OPTIONAL_SESSION_PATHS = new Set([
  "/passkey/generate-authenticate-options",
]);

const NON_MUTATING_POST = new Set([
  "/get-session",
  "/organization/has-permission",
  "/organization/check-slug",
  "/two-factor/get-totp-uri",
  "/api-key/verify",
  "/api-key/get",
]);

const OPERATION_IDS = {
  "GET /.well-known/jwks.json": "jwt.jwks",
  "GET /.well-known/openid-configuration": "oidc.discovery",
  "GET /.well-known/webauthn": "passkey.relatedOrigins",
  "GET /ok": "health.ok",
  "GET /health": "health.health",
  "HEAD /ok": "health.ok.head",
  "GET /get-session": "session.get",
  "POST /get-session": "session.get.post",
  "POST /sign-up/email": "user.create",
  "POST /sign-in/email": "session.issue.email",
  "POST /sign-in/username": "session.issue.username",
  "POST /sign-in/social": "session.issue.social",
  "POST /session/bridge/issue": "session.bridge.issue",
  "POST /session/bridge/exchange": "session.bridge.exchange",
  "POST /sign-out": "session.revoke.current",
  "POST /forget-password": "user.password.forget",
  "POST /reset-password": "user.password.reset",
  "GET /reset-password/{token}": "user.password.reset.token",
  "POST /change-password": "user.password.change",
  "POST /set-password": "user.password.set",
  "POST /update-user": "user.update",
  "POST /delete-user": "user.delete",
  "GET /delete-user/verify": "user.delete.verify",
  "POST /change-email": "user.email.update",
  "GET /change-email/verify": "user.email.verify.change",
  "POST /change-email/verify": "user.email.verify.change.post",
  "GET /verify-email": "user.email.verify",
  "POST /send-verification-email": "user.email.verify.send",
  "GET /list-sessions": "session.list",
  "POST /revoke-session": "session.revoke",
  "POST /revoke-sessions": "session.revoke.all",
  "POST /revoke-other-sessions": "session.revoke.others",
  "GET /list-accounts": "account.list",
  "POST /link-social": "account.link",
  "POST /unlink-account": "account.unlink",
  "GET /callback/{provider}": "social.callback",
  "POST /organization/create": "organization.create",
  "GET /organization/list": "organization.list",
  "GET /organization/get-full-organization": "organization.get",
  "POST /organization/update": "organization.update",
  "POST /organization/delete": "organization.delete",
  "POST /organization/set-active": "organization.setActive",
  "POST /organization/leave": "organization.leave",
  "POST /organization/check-slug": "organization.checkSlug",
  "GET /organization/get-active-member": "member.active",
  "GET /organization/list-members": "member.list",
  "POST /organization/add-member": "member.add",
  "POST /organization/remove-member": "member.remove",
  "POST /organization/update-member-role": "member.role.update",
  "POST /organization/has-permission": "organization.hasPermission",
  "POST /organization/invite-member": "invitation.create",
  "POST /organization/invite-member-reminder": "invitation.reminder",
  "GET /organization/list-invitations": "invitation.list",
  "GET /organization/list-user-invitations": "invitation.listUser",
  "GET /organization/get-invitation": "invitation.get",
  "POST /organization/accept-invitation": "invitation.accept",
  "POST /organization/reject-invitation": "invitation.reject",
  "POST /organization/cancel-invitation": "invitation.cancel",
  "POST /api-key/create": "apiKey.create",
  "GET /api-key/list": "apiKey.list",
  "GET /api-key/get": "apiKey.get",
  "POST /api-key/get": "apiKey.get.post",
  "POST /api-key/update": "apiKey.update",
  "POST /api-key/delete": "apiKey.delete",
  "POST /api-key/verify": "apiKey.verify",
  "POST /api-key/delete-all-expired-api-keys": "apiKey.deleteExpired",
  "POST /two-factor/enable": "twoFactor.enable",
  "POST /two-factor/disable": "twoFactor.disable",
  "POST /two-factor/get-totp-uri": "twoFactor.getUri",
  "POST /two-factor/verify-totp": "twoFactor.verifyEnable",
  "POST /two-factor/generate-backup-codes": "twoFactor.backupCodes.generate",
  "POST /two-factor/verify-backup-code": "twoFactor.backupCodes.consume",
  "POST /two-factor/send-otp": "twoFactor.emailOtp.send",
  "POST /two-factor/verify-otp": "twoFactor.emailOtp.verify",
  "GET /passkey/generate-register-options": "passkey.register.options",
  "POST /passkey/verify-registration": "passkey.register.verify",
  "POST /passkey/generate-authenticate-options": "passkey.authenticate.options",
  "POST /passkey/verify-authentication": "passkey.authenticate.verify",
  "GET /passkey/list-user-passkeys": "passkey.list",
  "POST /passkey/update-passkey": "passkey.update",
  "POST /passkey/delete-passkey": "passkey.delete",
  "POST /token": "jwt.token",
  "POST /refresh-token": "jwt.refresh",
  "POST /get-access-token": "jwt.accessToken",
  "GET /email/list": "email.list",
  "POST /send-security-alert": "email.securityAlert",
  "POST /send-sign-in-email": "email.signIn",
};

const DOMAIN_EVENTS = {
  "POST /sign-up/email": "user.create",
  "POST /update-user": "user.update",
  "POST /delete-user": "user.delete",
  "POST /change-email": "user.email.update",
  "GET /verify-email": "user.email.verify",
  "POST /change-password": "user.password.change",
  "POST /reset-password": "user.password.reset",
  "POST /sign-in/email": "session.issue",
  "POST /sign-in/username": "session.issue",
  "POST /sign-in/social": "session.issue",
  "POST /passkey/verify-authentication": "session.issue",
  "POST /sign-out": "session.revoke",
  "POST /revoke-session": "session.revoke",
  "POST /revoke-sessions": "session.revoke",
  "POST /revoke-other-sessions": "session.revoke",
  "POST /organization/set-active": "session.activeOrganization.update",
  "POST /organization/create": "organization.create",
  "POST /organization/update": "organization.update",
  "POST /organization/delete": "organization.delete",
  "POST /organization/add-member": "organization.member.add",
  "POST /organization/remove-member": "organization.member.remove",
  "POST /organization/leave": "organization.member.remove",
  "POST /organization/update-member-role": "organization.member.role.update",
  "POST /organization/invite-member": "organization.invitation.create",
  "POST /organization/invite-member-reminder": "organization.member.invite.reminder",
  "POST /organization/accept-invitation": "organization.invitation.accept",
  "POST /organization/reject-invitation": "organization.invitation.reject",
  "POST /organization/cancel-invitation": "organization.invitation.cancel",
  "POST /api-key/create": "apiKey.create",
  "POST /api-key/update": "apiKey.update",
  "POST /api-key/delete": "apiKey.delete",
  "POST /passkey/verify-registration": "passkey.register",
  "POST /passkey/update-passkey": "passkey.update",
  "POST /passkey/delete-passkey": "passkey.delete",
  "POST /two-factor/enable": "twoFactor.enable",
  "POST /two-factor/verify-totp": "twoFactor.enable",
  "POST /two-factor/disable": "twoFactor.disable",
  "POST /link-social": "account.link",
  "POST /unlink-account": "account.unlink",
  "POST /send-security-alert": "user.security.alert",
  "POST /send-sign-in-email": "user.sign-in.email",
};

function walk(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return acc;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.(rs|ts)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function rustRoutes() {
  const routes = new Map();
  const pattern =
    /AuthRoute::(get|post|put|delete|patch)\(\s*"([^"]+)"/g;
  const constPattern = /AuthRoute::(get|post)\(\s*([A-Z0-9_]+)/g;
  const constValues = {
    TOKEN_PATH: "/token",
    JWKS_PATH: "/.well-known/jwks.json",
    DISCOVERY_PATH: "/.well-known/openid-configuration",
    OK: "/ok",
    ERROR: "/error",
    HEALTH: "/health",
    OPENAPI_SPEC: "/reference/openapi.json",
    UPDATE_USER: "/update-user",
    DELETE_USER: "/delete-user",
    CHANGE_EMAIL: "/change-email",
    DELETE_USER_CALLBACK: "/delete-user/callback",
  };

  for (const root of RUST_ROOTS) {
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(pattern)) {
        const key = `${match[1].toUpperCase()} ${match[2]}`;
        routes.set(key, { file: path.relative(repoRoot, file), key });
      }
      for (const match of text.matchAll(
        /\b(get|post|put|delete|patch)\s+"(\/[^"]+)"\s*=>/g
      )) {
        const key = `${match[1].toUpperCase()} ${match[2]}`;
        routes.set(key, { file: path.relative(repoRoot, file), key });
      }
      for (const match of text.matchAll(constPattern)) {
        const resolved = constValues[match[2]];
        if (resolved) {
          const key = `${match[1].toUpperCase()} ${resolved}`;
          routes.set(key, { file: path.relative(repoRoot, file), key });
        }
      }
    }
  }

  for (const key of RUST_SERVED_OVERLAY) {
    if (!routes.has(key)) {
      routes.set(key, { file: "overlay:rust-served", key });
    }
  }
  return routes;
}

function jsSdkPaths() {
  const text = readFileSync(JS_TYPES, "utf8");
  const start = text.indexOf("export type AthenaAuthEndpointPath");
  const slice = text.slice(start, text.indexOf(";", start));
  const paths = [...slice.matchAll(/"(\/[^"]+)"/g)].map((match) => match[1]);
  return new Set(paths);
}

function jsLocalRoutes() {
  const routes = new Set();
  for (const file of walk(JS_LOCAL_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/if\s*\(([\s\S]*?)\)\s*\{/g)) {
      const cond = match[1];
      const paths = [...cond.matchAll(/path === "([^"]+)"/g)].map((item) => item[1]);
      const methods = [...cond.matchAll(/method === "([A-Z]+)"/g)].map(
        (item) => item[1]
      );
      for (const routePath of paths) {
        for (const method of methods) {
          routes.add(`${method} ${routePath}`);
        }
      }
    }
  }
  return routes;
}

function pathOnly(route) {
  return route.split(" ").slice(1).join(" ");
}

function kebabToCamelDot(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function defaultOperationId(method, routePath) {
  const segments = routePath
    .replace(/^\//, "")
    .split("/")
    .map((segment) => (segment.startsWith("{") ? "by" : kebabToCamelDot(segment)));
  const last = segments.at(-1) ?? "unknown";
  const ns = segments.slice(0, -1).join(".");
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    return ns ? `${ns}.${last}` : last;
  }
  return ns ? `${ns}.${last}` : last;
}

function classifyCapability(routePath) {
  if (routePath.startsWith("/passkey") || routePath === "/.well-known/webauthn") {
    return "passkeys";
  }
  if (
    routePath.startsWith("/callback") ||
    routePath === "/sign-in/social" ||
    routePath === "/link-social" ||
    routePath === "/unlink-account"
  ) {
    return "social";
  }
  if (routePath.startsWith("/api-key") || routePath.startsWith("/admin/api-key")) {
    return "apiKeys";
  }
  if (routePath.startsWith("/two-factor")) {
    return "twoFactor";
  }
  if (
    routePath.includes("invitation") ||
    routePath.includes("invite-member")
  ) {
    return "invitations";
  }
  if (routePath.startsWith("/organization")) {
    return "organizations";
  }
  if (
    routePath.startsWith("/admin/email") ||
    routePath.startsWith("/email/") ||
    routePath === "/send-verification-email" ||
    routePath === "/send-security-alert" ||
    routePath === "/send-sign-in-email"
  ) {
    return "email";
  }
  if (
    routePath === "/.well-known/jwks.json" ||
    routePath === "/token" ||
    routePath === "/refresh-token" ||
    routePath === "/get-access-token"
  ) {
    return "jwt";
  }
  if (routePath === "/.well-known/openid-configuration") {
    return "oidc";
  }
  if (routePath === "/ok" || routePath === "/health") {
    return "health";
  }
  if (routePath === "/list-accounts") {
    return "accounts";
  }
  if (
    routePath.includes("session") ||
    routePath === "/sign-out" ||
    routePath === "/get-session"
  ) {
    return "sessions";
  }
  if (
    routePath.startsWith("/sign-") ||
    routePath.includes("password") ||
    routePath.includes("change-email") ||
    routePath.includes("verify-email") ||
    routePath.includes("delete-user") ||
    routePath === "/update-user"
  ) {
    return "password";
  }
  if (routePath.startsWith("/admin")) {
    return "admin";
  }
  return "sessions";
}

function classifyAuth(routePath) {
  if (routePath.startsWith("/admin")) {
    return "admin";
  }
  if (OPTIONAL_SESSION_PATHS.has(routePath)) {
    return "optional-session";
  }
  if (PUBLIC_PATHS.has(routePath)) {
    return "public";
  }
  return "session";
}

function isMutation(method, routePath) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }
  if (method === "POST" && NON_MUTATING_POST.has(routePath)) {
    return false;
  }
  return true;
}

function classifyOperation(key, rust, local) {
  const method = key.split(" ")[0];
  const routePath = pathOnly(key);
  const operation = {
    id: OPERATION_IDS[key] ?? defaultOperationId(method, routePath),
    method,
    path: routePath,
    capability: classifyCapability(routePath),
    rust: rust.has(key) ? "supported" : "unsupported",
    embedded: local.has(key) ? "supported" : "unsupported",
    auth: classifyAuth(routePath),
    mutation: isMutation(method, routePath),
  };
  if (DOMAIN_EVENTS[key]) {
    operation.domainEvent = DOMAIN_EVENTS[key];
  }
  if (NONPORTABLE.has(key)) {
    operation.nonportable = true;
  }
  return operation;
}

export function buildAuthRouteInventory() {
  const rust = rustRoutes();
  const local = jsLocalRoutes();
  const sdk = jsSdkPaths();
  const rustKeys = [...rust.keys()].sort();
  const unionKeys = [...new Set([...rustKeys, ...local])].sort();
  const operations = unionKeys.map((key) => classifyOperation(key, rust, local));
  const missingInLocal = rustKeys.filter(
    (key) => !NONPORTABLE.has(key) && !local.has(key)
  );
  const extraLocal = [...local].filter((key) => !rust.has(key)).sort();
  const sdkMissing = rustKeys
    .map(pathOnly)
    .filter(
      (routePath) =>
        !routePath.includes("{") &&
        !sdk.has(routePath) &&
        !NONPORTABLE.has(`GET ${routePath}`) &&
        !NONPORTABLE.has(`POST ${routePath}`)
    );

  return {
    generatedAt: new Date().toISOString(),
    rustCount: rustKeys.length,
    localCount: local.size,
    sdkPathCount: sdk.size,
    operationCount: operations.length,
    rust: rustKeys,
    local: [...local].sort(),
    operations,
    missingInLocal,
    extraLocal,
    sdkMissing: [...new Set(sdkMissing)].sort(),
    nonportable: [...NONPORTABLE].sort(),
  };
}

function emitOperationsTs(operations) {
  const body = JSON.stringify(operations, null, 2);
  return `/**
 * Generated by scripts/auth-route-parity.mjs. Do not edit.
 * Wave 0 Auth Finality operation catalog (live rust + embedded scan).
 */
import type { AthenaAuthOperationDefinition } from "./operations.ts";

export const ATHENA_AUTH_OPERATIONS: AthenaAuthOperationDefinition[] = ${body};
`;
}

const inventory = buildAuthRouteInventory();
const outDir = path.join(packageRoot, "contracts/auth");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "routes.generated.json"),
  `${JSON.stringify(inventory, null, 2)}\n`
);
writeFileSync(
  path.join(packageRoot, "src/auth/contract/operations.generated.ts"),
  emitOperationsTs(inventory.operations)
);

if (process.argv.includes("--print")) {
  process.stdout.write(
    `${JSON.stringify(
      {
        rustCount: inventory.rustCount,
        localCount: inventory.localCount,
        operationCount: inventory.operationCount,
        missingInLocal: inventory.missingInLocal,
        extraLocal: inventory.extraLocal,
        sdkMissing: inventory.sdkMissing,
      },
      null,
      2
    )}\n`
  );
}
