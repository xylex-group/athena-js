import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryRequestV1 } from "../query/contract-v1.ts";
import {
  assertCompiledQueryV1,
  type AthenaCanonicalQueryCompiler,
  type AthenaCompiledQuery,
  type AthenaCompiledQueryTarget,
} from "./compiler.ts";

/**
 * Optional host adapter: spawn the Rust `athena-query-compile-v1` binary.
 * Not a TypeScript SQL compiler and not a root package native dependency.
 */
export function createProcessCanonicalQueryCompiler(input: {
  command?: string;
  args?: readonly string[];
  cwd?: string;
}): AthenaCanonicalQueryCompiler {
  const command = input.command ?? "cargo";
  const args = input.args ?? [
    "run",
    "-q",
    "-p",
    "athena-query",
    "--bin",
    "athena-query-compile-v1",
    "--",
  ];
  const cwd =
    input.cwd ??
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  return {
    async compile(
      request: QueryRequestV1,
      target: AthenaCompiledQueryTarget,
    ): Promise<AthenaCompiledQuery> {
      const payload = JSON.stringify({ request, target });
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(command, [...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          out += chunk;
        });
        child.stderr.on("data", (chunk) => {
          err += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve(out);
          } else {
            reject(new Error(err.trim() || `athena-query compile failed (${code})`));
          }
        });
        child.stdin.end(payload);
      });
      return assertCompiledQueryV1(JSON.parse(stdout));
    },
  };
}
