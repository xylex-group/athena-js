"use client";

import { createAthenaBrowserClient } from "@xylex-group/athena/next/client";
import { athenaPublicConfig } from "./athena-public-config.ts";

/**
 * Application-owned browser singleton. The SDK factory does not cache.
 */
export const athena = createAthenaBrowserClient(athenaPublicConfig);
