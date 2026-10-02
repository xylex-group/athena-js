import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRustRouteConstants,
  scanRustRouteSource,
} from "./auth-route-inventory.mjs";

test("scans Rust route literals, constants, macros, and admin tuples", () => {
  const routes = scanRustRouteSource(`
const FOO: &str = "/foo";
pub const BAR: &str = "/bar";
AuthRoute::get("/literal", "literal_handler");
AuthRoute::get("/single-argument");
AuthRoute::post(FOO, "foo_handler");
get "/macro" => macro_handler;
(
    HttpMethod::Post,
    BAR,
    "admin_bar",
    "admin.bar",
),
`);

  assert.deepEqual(
    routes.map(({ method, path, operation }) => ({ method, operation, path })),
    [
      { method: "GET", operation: "literal_handler", path: "/literal" },
      {
        method: "GET",
        operation: "/single-argument",
        path: "/single-argument",
      },
      { method: "POST", operation: "foo_handler", path: "/foo" },
      { method: "GET", operation: "macro_handler", path: "/macro" },
      { method: "POST", operation: "admin.bar", path: "/bar" },
    ]
  );
});

test("retains duplicate method and path registrations for diagnostics", () => {
  const routes = scanRustRouteSource(`
AuthRoute::get("/same", "first");
AuthRoute::get("/same", "second");
`);
  assert.equal(routes.length, 2);
  assert.equal(routes[0].key, routes[1].key);
});

test("resolves qualified route constants from a shared repository map", () => {
  const constants = collectRustRouteConstants(`
pub mod core_paths {
  pub const OK: &str = "/ok";
  pub const UPDATE_USER: &str = "/update-user";
}
const WELL_KNOWN_WEBAUTHN_PATH: &str = "/.well-known/webauthn";
`);
  const routes = scanRustRouteSource(
    `
AuthRoute::get(core_paths::OK, "ok");
AuthRoute::post(core_paths::UPDATE_USER, "update_user");
router.route(WELL_KNOWN_WEBAUTHN_PATH, axum::routing::get(handler));
`,
    "server/auth_route_labels.rs",
    constants
  );
  assert.deepEqual(
    routes.map(({ key }) => key),
    ["GET /ok", "POST /update-user", "GET /.well-known/webauthn"]
  );
});
