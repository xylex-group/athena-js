import { createAthenaNextHandlers } from "@xylex-group/athena/next/server";

import { athena } from "../../../../lib/athena/root.ts";

const { auth } = createAthenaNextHandlers({
  client: athena,
});

export const { GET, POST } = auth;
