import {
  bigint,
  type InsertOf,
  integer,
  type RowOf,
  smallint,
  table,
} from "@xylex-group/athena/browser";

export const example = table("example")
  .columns({
    count: integer(),
    id: bigint().identity("always"),
    priority: smallint(),
  })
  .primaryKey("id");

export type ExampleRow = RowOf<typeof example>;
export type ExampleInsert = InsertOf<typeof example>;

export const exampleRow: ExampleRow = {
  count: 4,
  id: "9223372036854775807",
  priority: 2,
};

export const exampleInsert: ExampleInsert = { count: 4, priority: 2 };
