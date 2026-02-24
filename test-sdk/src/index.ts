import express from "express";
import { createClient } from "@xylex-group/athena";

const app = express();
app.use(express.json());

const ATHENA_URL = process.env.ATHENA_URL ?? "https://athena-db.com";
const ATHENA_API_KEY = process.env.ATHENA_API_KEY ?? "";

const client = createClient(ATHENA_URL, ATHENA_API_KEY);

app.get("/health", (_req, res) => {
  res.json({ ok: true, sdk: "athena-js" });
});

app.get("/table/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const { limit = "10", offset = "0" } = req.query;

    const { data, error, status } = await client
      .from(name)
      .limit(Number(limit))
      .offset(Number(offset))
      .select();

    if (error) {
      return res.status(status || 500).json({ error });
    }
    res.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/table/:name/by/:column/:value", async (req, res) => {
  try {
    const { name, column, value } = req.params;

    const { data, error, status } = await client
      .from(name)
      .eq(column, value)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(status || 500).json({ error });
    }
    res.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/table/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const body = req.body;

    const mutation = client.from(name).insert(body);
    const { data, error, status } = await mutation.select();

    if (error) {
      return res.status(status || 500).json({ error });
    }
    res.status(201).json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.patch("/table/:name/by/:column/:value", async (req, res) => {
  try {
    const { name, column, value } = req.params;
    const body = req.body;

    const mutation = client.from(name).eq(column, value).update(body);
    const { data, error, status } = await mutation.select();

    if (error) {
      return res.status(status || 500).json({ error });
    }
    res.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete("/table/:name/:resourceId", async (req, res) => {
  try {
    const { name, resourceId } = req.params;

    const { data, error, status } = await client
      .from(name)
      .delete({ resourceId });

    if (error) {
      return res.status(status || 500).json({ error });
    }
    res.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Test SDK server running at http://localhost:${PORT}`);
  console.log(`Environment: ATHENA_URL=${ATHENA_URL}`);
  if (!ATHENA_API_KEY) {
    console.warn("ATHENA_API_KEY not set — requests to Athena will fail");
  }
});
