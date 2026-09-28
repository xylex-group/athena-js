"use client";

import { createAthenaBrowserClient } from "@xylex-group/athena/next/client";

export const athena = createAthenaBrowserClient({
  topology: {
    discover: "next",
    prefer: "local",
  },
});
