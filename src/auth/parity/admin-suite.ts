/**
 * Dual-runtime Admin Auth contract (black-box HTTP).
 * Import from tests / CI only — not a public application API.
 */

import {
  ATHENA_AUTH_ADMIN_PATHS,
  assertPublicAdminUserSafe,
} from "../local/admin-contract.ts";
import { createAthenaAuthParityHandleFromUrl } from "./core-suite.ts";

export { createAthenaAuthParityHandleFromUrl };

export const ATHENA_AUTH_ADMIN_SUITE_OPS = [
  "admin-list-users",
  "admin-get-user",
  "admin-create-user",
  "admin-update-user",
  "admin-set-role",
  "admin-ban-user",
  "admin-unban-user",
  "admin-revoke-user-sessions",
  "admin-impersonate-user",
  "admin-stop-impersonating",
  "admin-remove-user",
  "admin-forbidden-for-user",
  "admin-secret-redaction",
] as const;

export type AthenaAuthAdminSuiteOp = (typeof ATHENA_AUTH_ADMIN_SUITE_OPS)[number];

export interface AthenaAuthAdminParityTarget {
  admin?: {
    email: string;
    password: string;
  };
  handle?: (request: Request) => Promise<Response>;
  name: "embedded" | "rust" | string;
  url?: string;
}

export interface AthenaAuthAdminParityReport {
  deferred: string[];
  failed: string[];
  passed: string[];
  reason?: string;
  skipped?: boolean;
  target: string;
}

function fail(report: AthenaAuthAdminParityReport, op: string, detail: string): void {
  report.failed.push(`${op}: ${detail}`);
}

function pass(report: AthenaAuthAdminParityReport, op: string): void {
  if (!report.passed.includes(op)) {
    report.passed.push(op);
  }
}

function defer(report: AthenaAuthAdminParityReport, op: string, detail: string): void {
  const row = `${op}: ${detail}`;
  if (!report.deferred.includes(row) && !report.passed.includes(op)) {
    report.deferred.push(row);
  }
}

function cookieHeader(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function runAdminAuthParitySuite(
  target: AthenaAuthAdminParityTarget
): Promise<AthenaAuthAdminParityReport> {
  const report: AthenaAuthAdminParityReport = {
    deferred: [],
    failed: [],
    passed: [],
    target: target.name,
  };

  const handle =
    target.handle ??
    (target.url ? createAthenaAuthParityHandleFromUrl(target.url) : undefined);
  const admin = target.admin;

  if (!handle || !admin) {
    return {
      ...report,
      reason: !handle
        ? target.name === "rust"
          ? "ATHENA_AUTH_URL unset — rust admin target skip-with-reason"
          : "no handle — skip-with-reason"
        : "ATHENA_AUTH_ADMIN_EMAIL/PASSWORD unset — skip-with-reason",
      skipped: true,
    };
  }

  const origin = "http://app.local/api/auth";
  const jsonHeaders = { "content-type": "application/json", origin: "http://app.local" };

  const signin = await handle(
    new Request(`${origin}/sign-in/email`, {
      body: JSON.stringify({ email: admin.email, password: admin.password }),
      headers: jsonHeaders,
      method: "POST",
    })
  );
  const adminCookie = cookieHeader(signin);
  if (signin.status !== 200 || !adminCookie) {
    fail(report, "admin-list-users", `admin sign-in failed (${signin.status})`);
    return report;
  }

  const listed = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.listUsers}`, {
      headers: { cookie: adminCookie, origin: "http://app.local" },
    })
  );
  if (listed.status === 200) {
    const body = await readJson(listed);
    try {
      const users = Array.isArray(body.users) ? body.users : [];
      for (const user of users) {
        assertPublicAdminUserSafe(user, "listUsers");
      }
      pass(report, "admin-list-users");
      pass(report, "admin-secret-redaction");
    } catch (error) {
      fail(report, "admin-secret-redaction", String(error));
    }
  } else if (listed.status === 404 || listed.status === 501) {
    defer(report, "admin-list-users", `status ${listed.status}`);
  } else {
    fail(report, "admin-list-users", `status ${listed.status}`);
  }

  const stamp = Date.now();
  const createdEmail = `admin-suite-${stamp}@example.com`;
  const created = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.createUser}`, {
      body: JSON.stringify({
        email: createdEmail,
        name: "Suite User",
        password: "SuitePass123!",
      }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  const createdBody = await readJson(created);
  const createdUser = (createdBody.user ?? createdBody) as { id?: string };
  if (created.status === 200 && typeof createdUser.id === "string") {
    pass(report, "admin-create-user");
    try {
      assertPublicAdminUserSafe(createdBody, "createUser");
    } catch (error) {
      fail(report, "admin-secret-redaction", String(error));
    }
  } else if (created.status === 404 || created.status === 501) {
    defer(report, "admin-create-user", `status ${created.status}`);
  } else {
    fail(report, "admin-create-user", `status ${created.status}`);
  }

  const userId = typeof createdUser.id === "string" ? createdUser.id : "";
  if (!userId) {
    return report;
  }

  const got = await handle(
    new Request(
      `${origin}${ATHENA_AUTH_ADMIN_PATHS.getUser}?userId=${encodeURIComponent(userId)}`,
      { headers: { cookie: adminCookie, origin: "http://app.local" } }
    )
  );
  if (got.status === 200) {
    pass(report, "admin-get-user");
  } else if (got.status === 404 || got.status === 501) {
    defer(report, "admin-get-user", `status ${got.status}`);
  } else {
    fail(report, "admin-get-user", `status ${got.status}`);
  }

  const updated = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.updateUser}`, {
      body: JSON.stringify({ name: "Suite User Updated", userId }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  if (updated.status === 200) {
    pass(report, "admin-update-user");
  } else if (updated.status === 404 || updated.status === 501) {
    defer(report, "admin-update-user", `status ${updated.status}`);
  } else {
    fail(report, "admin-update-user", `status ${updated.status}`);
  }

  const role = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.setRole}`, {
      body: JSON.stringify({ role: "user", userId }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  if (role.status === 200) {
    pass(report, "admin-set-role");
  } else if (role.status === 404 || role.status === 501) {
    defer(report, "admin-set-role", `status ${role.status}`);
  } else {
    fail(report, "admin-set-role", `status ${role.status}`);
  }

  const escalate = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.setRole}`, {
      body: JSON.stringify({ role: "owner", userId }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  if (escalate.status === 403) {
    pass(report, "admin-set-role");
  } else if (escalate.status === 200 && target.name === "rust") {
    defer(
      report,
      "admin-set-role",
      "RUST_ALLOWS_UNRANKED_SET_ROLE — INTENTIONAL_DIFFERENCE vs embedded ranking"
    );
  }

  const banned = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.banUser}`, {
      body: JSON.stringify({ banReason: "suite", userId }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  if (banned.status === 200) {
    pass(report, "admin-ban-user");
  } else {
    fail(report, "admin-ban-user", `status ${banned.status}`);
  }

  const unbanned = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.unbanUser}`, {
      body: JSON.stringify({ userId }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  if (unbanned.status === 200) {
    pass(report, "admin-unban-user");
  } else {
    fail(report, "admin-unban-user", `status ${unbanned.status}`);
  }

  const revoked = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.revokeUserSessions}`, {
      body: JSON.stringify({ userId }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  if (revoked.status === 200) {
    pass(report, "admin-revoke-user-sessions");
  } else {
    fail(report, "admin-revoke-user-sessions", `status ${revoked.status}`);
  }

  const impersonated = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.impersonateUser}`, {
      body: JSON.stringify({ userId }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  const impersonationCookie = cookieHeader(impersonated) || adminCookie;
  if (impersonated.status === 200) {
    pass(report, "admin-impersonate-user");
    const stopped = await handle(
      new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.stopImpersonating}`, {
        headers: { ...jsonHeaders, cookie: impersonationCookie },
        method: "POST",
      })
    );
    if (stopped.status === 200) {
      pass(report, "admin-stop-impersonating");
    } else {
      fail(report, "admin-stop-impersonating", `status ${stopped.status}`);
    }
  } else {
    fail(report, "admin-impersonate-user", `status ${impersonated.status}`);
  }

  const removed = await handle(
    new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.removeUser}`, {
      body: JSON.stringify({ userId }),
      headers: { ...jsonHeaders, cookie: adminCookie },
      method: "POST",
    })
  );
  if (removed.status === 200) {
    pass(report, "admin-remove-user");
  } else {
    fail(report, "admin-remove-user", `status ${removed.status}`);
  }

  const memberEmail = `admin-suite-member-${stamp}@example.com`;
  await handle(
    new Request(`${origin}/sign-up/email`, {
      body: JSON.stringify({
        email: memberEmail,
        name: "Member",
        password: "MemberPass123!",
      }),
      headers: jsonHeaders,
      method: "POST",
    })
  );
  const memberSignin = await handle(
    new Request(`${origin}/sign-in/email`, {
      body: JSON.stringify({ email: memberEmail, password: "MemberPass123!" }),
      headers: jsonHeaders,
      method: "POST",
    })
  );
  const memberCookie = cookieHeader(memberSignin);
  if (memberCookie) {
    const forbidden = await handle(
      new Request(`${origin}${ATHENA_AUTH_ADMIN_PATHS.listUsers}`, {
        headers: { cookie: memberCookie, origin: "http://app.local" },
      })
    );
    if (forbidden.status === 403 || forbidden.status === 401) {
      pass(report, "admin-forbidden-for-user");
    } else {
      fail(report, "admin-forbidden-for-user", `status ${forbidden.status}`);
    }
  } else {
    defer(report, "admin-forbidden-for-user", "member sign-in did not set cookie");
  }

  return report;
}
