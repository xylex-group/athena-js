"use client";

import { createClient } from "@xylex-group/athena";

export function AthenaClientProbe() {
  void createClient({
    key: "public",
    url: "https://athena.example.com",
  });

  return null;
}
