import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  keepNullKeysFromFindManySelect,
  maybeStripNullRows,
} from "../src/result/strip-null-properties.ts";

test("stripNulls keeps first-selection relation keys that are null", () => {
  const payload = {
    select: {
      latest_attempt: {
        as: "latest_attempt",
        select: { failure_kind: true },
        selection: "first",
      },
      node_id: true,
    },
    table_name: "execution_nodes",
  };
  const keep = keepNullKeysFromFindManySelect(payload);
  assert.deepEqual([...(keep ?? [])], ["latest_attempt"]);
  const rows = maybeStripNullRows(
    [{ latest_attempt: null, node_id: "n1", unused: null }],
    true,
    keep
  );
  assert.deepEqual(rows, [{ latest_attempt: null, node_id: "n1" }]);
});
