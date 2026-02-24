import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
import express from "express";
import chalk from "chalk";
import { createClient } from "@xylex-group/athena";

const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.on("finish", () => {
    const headers = res.getHeaders();
    const headerLines = Object.entries(headers)
      .map(([k, v]) => chalk.dim(`    ${k}: `) + String(v))
      .join("\n");
    console.log(chalk.gray("  ↳ Response headers:\n") + headerLines);
  });
  next();
});

const ATHENA_URL = process.env.ATHENA_URL ?? "https://mirror3.athena-db.com";
const ATHENA_API_KEY = process.env.ATHENA_API_KEY ?? "";
const ATHENA_CLIENT = process.env.ATHENA_CLIENT ?? "athena_logging";
const DEBUG_ATHENA_REQUESTS = process.env.DEBUG_ATHENA_REQUESTS === "1";

const athenaClient = createClient(ATHENA_URL, ATHENA_API_KEY, {
  client: "athena_logging",
  backend: { type: "athena" },
});

if (DEBUG_ATHENA_REQUESTS) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (url && String(url).includes(ATHENA_URL)) {
      const headers = (init?.headers as Record<string, string>) ?? {};
      console.log(chalk.magenta("  → Athena request:"), url);
      console.log(
        chalk.magenta("    x-athena-client:"),
        headers["x-athena-client"] ??
          headers["X-Athena-Client"] ??
          chalk.dim("(not set)"),
      );
    }
    return origFetch(input, init);
  };
}

function logRequest(
  method: string,
  path: string,
  status: number,
  responseTimeMs: number,
) {
  const methodColor =
    method === "GET"
      ? chalk.green
      : method === "POST"
        ? chalk.blue
        : method === "PATCH"
          ? chalk.yellow
          : method === "DELETE"
            ? chalk.red
            : chalk.gray;
  const statusColor =
    status >= 200 && status < 300
      ? chalk.green
      : status >= 400
        ? chalk.red
        : chalk.yellow;
  const speedColor =
    responseTimeMs < 100
      ? chalk.green
      : responseTimeMs < 500
        ? chalk.yellow
        : chalk.red;
  console.log(
    `${methodColor(method.padEnd(6))} ${chalk.cyan(path)} ${statusColor(String(status))} ${speedColor(`${responseTimeMs}ms`)}`,
  );
}

app.get("/", (_req, res) => {
  const start = performance.now();
  const elapsed = Math.round(performance.now() - start);
  res.json({ ok: true, sdk: "athena-js", responseTimeMs: elapsed });
  logRequest("GET", "/", 200, elapsed);
});

app.get("/table/:name", async (req, res) => {
  const path = req.path;
  const start = performance.now();
  try {
    const { name } = req.params;
    const { limit = "10", offset = "0" } = req.query;

    const { data, error, status } = await athenaClient
      .from(name)
      .limit(Number(limit))
      .offset(Number(offset))
      .select();

    const elapsed = Math.round(performance.now() - start);

    if (error) {
      logRequest("GET", path, status || 500, elapsed);
      return res.status(status || 500).json({ error, responseTimeMs: elapsed });
    }
    logRequest("GET", path, 200, elapsed);
    res.json({ data, responseTimeMs: elapsed });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    logRequest("GET", path, 500, elapsed);
    res.status(500).json({ error: message, responseTimeMs: elapsed });
  }
});

app.get("/table/:name/by/:column/:value", async (req, res) => {
  const path = req.path;
  const start = performance.now();
  try {
    const { name, column, value } = req.params;

    const { data, error, status } = await athenaClient
      .from(name)
      .eq(column, value)
      .maybeSingle();

    const elapsed = Math.round(performance.now() - start);

    if (error) {
      logRequest("GET", path, status || 500, elapsed);
      return res.status(status || 500).json({ error, responseTimeMs: elapsed });
    }
    logRequest("GET", path, 200, elapsed);
    res.json({ data, responseTimeMs: elapsed });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    logRequest("GET", path, 500, elapsed);
    res.status(500).json({ error: message, responseTimeMs: elapsed });
  }
});

app.post("/table/:name", async (req, res) => {
  const path = req.path;
  const start = performance.now();
  try {
    const { name } = req.params;
    const body = req.body;

    const mutation = athenaClient.from(name).insert(body);
    const { data, error, status } = await mutation.select();

    const elapsed = Math.round(performance.now() - start);

    if (error) {
      logRequest("POST", path, status || 500, elapsed);
      return res.status(status || 500).json({ error, responseTimeMs: elapsed });
    }
    logRequest("POST", path, 201, elapsed);
    res.status(201).json({ data, responseTimeMs: elapsed });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    logRequest("POST", path, 500, elapsed);
    res.status(500).json({ error: message, responseTimeMs: elapsed });
  }
});

app.patch("/table/:name/by/:column/:value", async (req, res) => {
  const path = req.path;
  const start = performance.now();
  try {
    const { name, column, value } = req.params;
    const body = req.body;

    const mutation = athenaClient.from(name).eq(column, value).update(body);
    const { data, error, status } = await mutation.select();

    const elapsed = Math.round(performance.now() - start);

    if (error) {
      logRequest("PATCH", path, status || 500, elapsed);
      return res.status(status || 500).json({ error, responseTimeMs: elapsed });
    }
    logRequest("PATCH", path, 200, elapsed);
    res.json({ data, responseTimeMs: elapsed });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    logRequest("PATCH", path, 500, elapsed);
    res.status(500).json({ error: message, responseTimeMs: elapsed });
  }
});

app.delete("/table/:name/:resourceId", async (req, res) => {
  const path = req.path;
  const start = performance.now();
  try {
    const { name, resourceId } = req.params;

    const { data, error, status } = await athenaClient
      .from(name)
      .delete({ resourceId });

    const elapsed = Math.round(performance.now() - start);

    if (error) {
      logRequest("DELETE", path, status || 500, elapsed);
      return res.status(status || 500).json({ error, responseTimeMs: elapsed });
    }
    logRequest("DELETE", path, 200, elapsed);
    res.json({ data, responseTimeMs: elapsed });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    logRequest("DELETE", path, 500, elapsed);
    res.status(500).json({ error: message, responseTimeMs: elapsed });
  }
});

const portArg = process.argv.find((a) => a.startsWith("--port"));
const portFromArg = portArg
  ? Number(
      portArg.includes("=")
        ? portArg.split("=")[1]
        : process.argv[process.argv.indexOf(portArg) + 1],
    )
  : undefined;
const PORT = portFromArg ?? (Number(process.env.PORT) || 3000);
app.listen(PORT, () => {
  console.log(chalk.bold.cyan("\n  Athena Test SDK"));
  console.log(chalk.gray("  ————————"));
  console.log(
    chalk.green("  ●") +
      ` Server: ${chalk.underline(`http://localhost:${PORT}`)}`,
  );
  console.log(chalk.gray(`  ● ATHENA_URL: ${ATHENA_URL}`));
  if (!ATHENA_API_KEY) {
    console.log(chalk.yellow("  ⚠ ATHENA_API_KEY not set — requests may fail"));
  }
  console.log("");
});
