import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_DEFAULT_VIEW,
  AUTH_ROUTES,
  AUTH_VIEW_BY_SEGMENT,
  createAuthRoutes,
  isAuthMode,
  resolveAuthModeRedirect,
  resolveAuthViewFromSegment,
  shouldRedirectAuthenticatedAuthMode,
  shouldRedirectAuthenticatedAuthView,
} from "../src/utils/auth-routes.ts";

test("resolveAuthViewFromSegment defaults and maps known segments", () => {
  assert.equal(resolveAuthViewFromSegment(undefined), AUTH_DEFAULT_VIEW);
  assert.equal(resolveAuthViewFromSegment("sign-in"), "sign-in");
  assert.equal(resolveAuthViewFromSegment("sign-up"), "sign-up");
  assert.equal(
    resolveAuthViewFromSegment("forgot-password"),
    "forgot-password"
  );
  assert.equal(
    resolveAuthViewFromSegment("forget-password"),
    "forgot-password"
  );
  assert.equal(resolveAuthViewFromSegment("reset-password"), "reset-password");
  assert.equal(
    resolveAuthViewFromSegment("reset-email-sent"),
    "reset-email-sent"
  );
  assert.equal(resolveAuthViewFromSegment("check-email"), "check-email");
  assert.equal(
    resolveAuthViewFromSegment("accept-invitation"),
    "accept-invitation"
  );
  assert.equal(resolveAuthViewFromSegment("logout"), "logout");
  assert.equal(resolveAuthViewFromSegment("unknown"), null);
});

test("shouldRedirectAuthenticatedAuthView only for guest-only screens", () => {
  assert.equal(shouldRedirectAuthenticatedAuthView("sign-in"), true);
  assert.equal(shouldRedirectAuthenticatedAuthView("sign-up"), true);
  assert.equal(shouldRedirectAuthenticatedAuthView("forgot-password"), true);
  assert.equal(shouldRedirectAuthenticatedAuthView("reset-password"), false);
  assert.equal(shouldRedirectAuthenticatedAuthView("logout"), false);
  assert.equal(shouldRedirectAuthenticatedAuthView("check-email"), false);
});

test("AUTH_VIEW_BY_SEGMENT covers primary segments", () => {
  assert.equal(AUTH_VIEW_BY_SEGMENT["sign-in"], "sign-in");
  assert.equal(AUTH_VIEW_BY_SEGMENT["forget-password"], "forgot-password");
});

test("auth mode helpers", () => {
  assert.equal(isAuthMode("login"), true);
  assert.equal(isAuthMode("nope"), false);
  assert.equal(shouldRedirectAuthenticatedAuthMode("login"), true);
  assert.equal(shouldRedirectAuthenticatedAuthMode("logout"), false);
  assert.equal(resolveAuthModeRedirect("signup"), AUTH_ROUTES.signUp);
  assert.equal(resolveAuthModeRedirect("unknown"), null);
});

test("createAuthRoutes merges overrides", () => {
  const routes = createAuthRoutes({ signIn: "/custom/login" });
  assert.equal(routes.signIn, "/custom/login");
  assert.equal(routes.signUp, AUTH_ROUTES.signUp);
});
