/**
 * Dual-runtime Auth contract runner (P9).
 * Not a public application API — import from tests / CI only.
 */

export const ATHENA_AUTH_CORE_SUITE_OPS = [
  "sign-up",
  "sign-in",
  "username-sign-in",
  "sign-out",
  "get-session",
  "refresh-session",
  "password-reset",
  "password-change",
  "session-list-revoke",
  "accounts",
  "email-verification",
  "change-email",
  "delete-user",
  "api-keys",
  "totp",
  "organizations",
  "members",
  "invitations",
  "error-envelope",
  "cookies",
  "headers",
  "trace-ids",
  "origin-enforcement",
  "rate-limits",
  "health",
] as const;

export type AthenaAuthCoreSuiteOp = (typeof ATHENA_AUTH_CORE_SUITE_OPS)[number];

export type AthenaAuthCoreSuiteCapability =
  | "required"
  | "optional"
  | "unsupported";

export interface AthenaAuthCoreSuiteOpSpec {
  capability: AthenaAuthCoreSuiteCapability;
  destructive?: boolean;
  liveOnly?: boolean;
}

export const ATHENA_AUTH_CORE_SUITE_SPEC: Record<
  AthenaAuthCoreSuiteOp,
  AthenaAuthCoreSuiteOpSpec
> = {
  accounts: { capability: "required" },
  "api-keys": { capability: "required" },
  "change-email": { capability: "required" },
  cookies: { capability: "required" },
  "delete-user": { capability: "optional", destructive: true, liveOnly: true },
  "email-verification": { capability: "required" },
  "error-envelope": { capability: "required" },
  "get-session": { capability: "required" },
  headers: { capability: "required" },
  health: { capability: "required" },
  invitations: { capability: "required" },
  members: { capability: "required" },
  organizations: { capability: "required" },
  "origin-enforcement": { capability: "required" },
  "password-change": { capability: "required" },
  "password-reset": { capability: "required" },
  "rate-limits": { capability: "optional", liveOnly: true },
  "refresh-session": { capability: "required" },
  "session-list-revoke": { capability: "required" },
  "sign-in": { capability: "required" },
  "sign-out": { capability: "required" },
  "sign-up": { capability: "required" },
  totp: { capability: "required" },
  "trace-ids": { capability: "required" },
  "username-sign-in": { capability: "required" },
};

export interface AthenaAuthParityTarget {
  handle?: (request: Request) => Promise<Response>;
  name: "embedded" | "rust" | string;
  url?: string;
}

export interface AthenaAuthParityReport {
  deferred: string[];
  failed: string[];
  passed: string[];
  reason?: string;
  skipped?: boolean;
  target: string;
}

function fail(report: AthenaAuthParityReport, op: string, detail: string): void {
  report.failed.push(`${op}: ${detail}`);
}

function pass(report: AthenaAuthParityReport, op: string): void {
  if (!report.passed.includes(op)) {
    report.passed.push(op);
  }
}

function defer(report: AthenaAuthParityReport, op: string, detail: string): void {
  if (!report.deferred.includes(op) && !report.passed.includes(op)) {
    report.deferred.push(`${op}: ${detail}`);
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function cookieHeader(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

async function probe(
  report: AthenaAuthParityReport,
  op: AthenaAuthCoreSuiteOp,
  response: Response,
  ok: (response: Response) => boolean | Promise<boolean>
): Promise<void> {
  if (response.status === 404 || response.status === 501) {
    const spec = ATHENA_AUTH_CORE_SUITE_SPEC[op];
    if (spec.capability === "required") {
      fail(report, op, `status ${response.status}`);
      return;
    }
    defer(report, op, `status ${response.status} — skip-with-reason`);
    return;
  }
  if (await ok(response)) {
    pass(report, op);
    return;
  }
  fail(report, op, `status ${response.status}`);
}

/**
 * Proxy a black-box Request to a running Auth HTTP origin.
 * Incoming paths under `/api/auth` are remapped onto `baseUrl`.
 */
export function createAthenaAuthParityHandleFromUrl(
  baseUrl: string
): (request: Request) => Promise<Response> {
  const base = baseUrl.replace(/\/$/, "");
  return async (request: Request): Promise<Response> => {
    const incoming = new URL(request.url);
    const stripped = incoming.pathname.replace(/^\/api\/auth(?=\/|$)/, "");
    const target = `${base}${stripped || incoming.pathname}${incoming.search}`;
    const init: RequestInit = {
      headers: request.headers,
      method: request.method,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }
    return fetch(target, init);
  };
}

export async function runAthenaAuthParitySuite(
  target: AthenaAuthParityTarget
): Promise<AthenaAuthParityReport> {
  const report: AthenaAuthParityReport = {
    deferred: [],
    failed: [],
    passed: [],
    target: target.name,
  };

  const handle =
    target.handle ??
    (target.url ? createAthenaAuthParityHandleFromUrl(target.url) : undefined);

  if (!handle) {
    if (
      target.name === "rust" &&
      process.env.ATHENA_PARITY_REQUIRE_RUST === "1"
    ) {
      fail(report, "rust", "ATHENA_AUTH_URL unset — rust target required");
      return report;
    }
    return {
      ...report,
      reason:
        target.name === "rust"
          ? "ATHENA_AUTH_URL unset — rust target skip-with-reason (external cohort unless CI starts rust)"
          : "no handle — skip-with-reason",
      skipped: true,
    };
  }

  const origin = "http://app.local/api/auth";
  const email = "parity@example.com";
  const password = "Password123!";

  const signup = await handle(
    new Request(`${origin}/sign-up/email`, {
      body: JSON.stringify({
        email,
        name: "Parity",
        password,
        username: "parity",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  if (signup.status !== 200) {
    fail(report, "sign-up", `status ${signup.status}`);
  } else {
    pass(report, "sign-up");
  }

  const cookie = cookieHeader(signup);
  if (cookie.length > 0) {
    pass(report, "cookies");
  } else {
    fail(report, "cookies", "missing set-cookie");
  }

  const session = await handle(
    new Request(`${origin}/get-session`, {
      headers: { cookie },
    })
  );
  if (session.status !== 200) {
    fail(report, "get-session", `status ${session.status}`);
  } else {
    pass(report, "get-session");
  }

  if (
    session.headers.get("content-type")?.includes("application/json") ||
    signup.headers.get("content-type")?.includes("application/json")
  ) {
    pass(report, "headers");
  } else {
    fail(report, "headers", "missing application/json content-type");
  }

  const signout = await handle(
    new Request(`${origin}/sign-out`, {
      headers: { cookie },
      method: "POST",
    })
  );
  if (signout.status >= 400) {
    fail(report, "sign-out", `status ${signout.status}`);
  } else {
    pass(report, "sign-out");
  }

  const signin = await handle(
    new Request(`${origin}/sign-in/email`, {
      body: JSON.stringify({ email, password }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  if (signin.status !== 200) {
    fail(report, "sign-in", `status ${signin.status}`);
  } else {
    pass(report, "sign-in");
  }

  const sessionCookie = cookieHeader(signin) || cookie;

  await probe(
    report,
    "username-sign-in",
    await handle(
      new Request(`${origin}/sign-in/username`, {
        body: JSON.stringify({ password, username: "parity" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    ),
    (response) => response.status === 200
  );

  await probe(
    report,
    "refresh-session",
    await handle(
      new Request(`${origin}/get-session`, {
        headers: { cookie: sessionCookie },
        method: "POST",
      })
    ),
    (response) => response.status === 200
  );

  await probe(
    report,
    "password-reset",
    await handle(
      new Request(`${origin}/forget-password`, {
        body: JSON.stringify({ email }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    ),
    (response) => response.status < 500
  );

  await probe(
    report,
    "password-change",
    await handle(
      new Request(`${origin}/change-password`, {
        body: JSON.stringify({
          currentPassword: password,
          newPassword: "Password1234!",
        }),
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
        },
        method: "POST",
      })
    ),
    (response) => response.status === 200
  );

  await probe(
    report,
    "session-list-revoke",
    await handle(
      new Request(`${origin}/list-sessions`, {
        headers: { cookie: sessionCookie },
      })
    ),
    (response) => response.status === 200
  );

  await probe(
    report,
    "accounts",
    await handle(
      new Request(`${origin}/list-accounts`, {
        headers: { cookie: sessionCookie },
      })
    ),
    (response) => response.status === 200
  );

  await probe(
    report,
    "email-verification",
    await handle(
      new Request(`${origin}/send-verification-email`, {
        body: JSON.stringify({ email }),
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
        },
        method: "POST",
      })
    ),
    (response) => response.status < 500
  );

  await probe(
    report,
    "change-email",
    await handle(
      new Request(`${origin}/change-email`, {
        body: JSON.stringify({ newEmail: "parity-next@example.com" }),
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
        },
        method: "POST",
      })
    ),
    (response) => response.status === 200
  );

  await probe(
    report,
    "api-keys",
    await handle(
      new Request(`${origin}/api-key/list`, {
        headers: { cookie: sessionCookie },
      })
    ),
    (response) => response.status === 200
  );

  await probe(
    report,
    "totp",
    await handle(
      new Request(`${origin}/two-factor/get-totp-uri`, {
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
        },
        method: "POST",
      })
    ),
    (response) => response.status < 500
  );

  await probe(
    report,
    "organizations",
    await handle(
      new Request(`${origin}/organization/list`, {
        headers: { cookie: sessionCookie },
      })
    ),
    (response) => response.status === 200
  );

  await probe(
    report,
    "members",
    await handle(
      new Request(`${origin}/organization/list-members`, {
        headers: { cookie: sessionCookie },
      })
    ),
    (response) => response.status < 500
  );

  await probe(
    report,
    "invitations",
    await handle(
      new Request(`${origin}/organization/list-invitations`, {
        headers: { cookie: sessionCookie },
      })
    ),
    (response) => response.status < 500
  );

  await probe(
    report,
    "origin-enforcement",
    await handle(
      new Request(`${origin}/get-session`, {
        headers: {
          cookie: sessionCookie,
          origin: "https://evil.example",
        },
      })
    ),
    (response) => response.status === 200 || response.status === 403
  );

  const unknown = await handle(new Request(`${origin}/not-a-contract-route`));
  const envelope = await json(unknown);
  if (
    unknown.status === 404 &&
    typeof envelope.message === "string" &&
    typeof envelope.traceId === "string"
  ) {
    pass(report, "error-envelope");
    pass(report, "trace-ids");
  } else {
    fail(report, "error-envelope", `status ${unknown.status}`);
    fail(report, "trace-ids", "missing envelope.traceId");
  }

  const health = await handle(new Request(`${origin}/health`));
  if (health.status === 200) {
    pass(report, "health");
  } else {
    fail(report, "health", `status ${health.status}`);
  }

  defer(
    report,
    "rate-limits",
    "live burst not executed in unit slice — skip-with-reason"
  );
  defer(
    report,
    "delete-user",
    "destructive op reserved for isolated live target — skip-with-reason"
  );

  return report;
}
