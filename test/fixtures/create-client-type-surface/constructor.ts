/**
 * Packed-package constructor surface. Compiled with tsc against the
 * published `@xylex-group/athena` tarball (not package source).
 */
import { createClient } from "@xylex-group/athena/server";

createClient({
  app: {
    name: "test",
    url: "https://example.com",
  },
  auth: {
    autoMigrate: true,
    passkey: {
      onboarding: true,
    },
    social: {
      providers: {
        github: {
          clientId: "id",
          clientSecret: "secret",
        },
      },
    },
  },
  databaseUrl: "postgres://localhost/test",
  diagnostics: "auto",
});
