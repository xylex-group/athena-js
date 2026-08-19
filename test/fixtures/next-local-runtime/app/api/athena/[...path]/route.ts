import { createAthenaNextHandlers } from "@xylex-group/athena/next/server";

import { athena } from "../../../../lib/athena/root.ts";

const { data } = createAthenaNextHandlers({
  client: athena,
});

export const { DELETE, GET, PATCH, POST } = data;
