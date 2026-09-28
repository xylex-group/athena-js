import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AthenaRelationCatalog,
  AthenaRelationDescriptor,
} from "../src/query/engine/index.ts";

export interface RelationFixtureEnd {
  columns: string[];
  schema?: string;
  table: string;
}

export interface RelationFixtureRelation {
  cardinality: AthenaRelationDescriptor["cardinality"];
  from: RelationFixtureEnd;
  id: string;
  name: string;
  through?: {
    fromColumns: string[];
    schema?: string;
    table: string;
    toColumns: string[];
  };
  to: RelationFixtureEnd;
}

export interface RelationFixtureCase {
  expected:
    | {
        cardinality: AthenaRelationDescriptor["cardinality"];
        fromColumns: string[];
        outcome: "resolved";
        direction: "forward" | "reverse";
        junction?: {
          fromColumns: string[];
          toColumns: string[];
        };
        toColumns: string[];
      }
    | {
        code: string;
        outcome: "error";
      };
  name: string;
  request: {
    relation: string;
    source: {
      schema?: string;
      table: string;
    };
    via?: string;
  };
}

export interface RelationFixture {
  cases: RelationFixtureCase[];
  relations: RelationFixtureRelation[];
  schema: "athena/relations-fixture/v1";
  tables: Array<{
    primaryKey: string[];
    schema?: string;
    table: string;
  }>;
}

export const fixturesRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "relations",
  "v1"
);

export function readRelationFixture(name: string): RelationFixture {
  return JSON.parse(
    readFileSync(join(fixturesRoot, name), "utf8")
  ) as RelationFixture;
}

export function relationFixtureCatalog(
  fixture: RelationFixture
): AthenaRelationCatalog {
  return {
    entries: fixture.relations.map((relation) => ({
      cardinality: relation.cardinality,
      constraint: relation.id.split(".").pop(),
      from: relation.from,
      id: relation.id,
      junction: relation.through
        ? {
            fromColumns: relation.through.fromColumns,
            schema: relation.through.schema,
            table: relation.through.table,
            toColumns: relation.through.toColumns,
          }
        : undefined,
      name: relation.name,
      to: relation.to,
    })),
  };
}
