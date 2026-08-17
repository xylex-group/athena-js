import { createAthenaAuthSessionBridgeHandlers } from "@xylex-group/athena/next/server";

/**
 * Same-origin app-host session cookie bridge for Athena Auth.
 * Mount at /api/athena-auth/session (default bridge route).
 */
export const { POST, DELETE } = createAthenaAuthSessionBridgeHandlers();
