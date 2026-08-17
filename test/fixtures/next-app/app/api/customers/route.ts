import { createServerAthena } from "../../lib/athena-server.ts";

/**
 * Example App Router Route Handler using the request-scoped server factory.
 */
export async function GET() {
  const athena = await createServerAthena();
  const result = await athena.from("customers").select("*");

  if (result.error) {
    return Response.json({ error: result.error.message }, { status: 500 });
  }

  return Response.json({ data: result.data });
}
