import "server-only";

import { createClient } from "@xylex-group/athena/server";

export const athena = createClient({
  auth: {
    mode: "local",
  },
  databaseUrl:
    process.env.DATABASE_URL ??
    process.env.ATHENA_TEST_DATABASE_URL ??
    "postgres://athena:athena@127.0.0.1:5432/athena",
  url: process.env.ATHENA_URL ?? "https://athena.example.com",
});
