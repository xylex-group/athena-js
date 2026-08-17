"use client";

import { createClient } from "@xylex-group/athena";

export function AthenaClientProbe() {
  void createClient({
    url: "https://athena.example.com",
    key: "public",
  });

  return null;
}
