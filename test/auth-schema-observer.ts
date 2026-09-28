import { ATHENA_AUTH_SCHEMA_GENERATION } from "../src/auth/contract/index.ts";
import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { ATHENA_AUTH_MIGRATION_EXPECTATIONS } from "../src/auth/local/schema-manifest.ts";
import { AUTHORIZATION_CATALOG_VERSION } from "../src/runtime/authorization/catalog.ts";
import {
  authorizationRightsFingerprint,
  authorizationRolesFingerprint,
} from "../src/runtime/authorization/catalog-state.ts";

const DDL = /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|SCHEMA)\b/i;

export function isAuthDdl(sql: string): boolean {
  return DDL.test(sql);
}

export function createObservingAuthDatabase(options?: {
  ledger?: Array<{ checksum?: string | null; name?: string; version: number }>;
  missing?: boolean;
  physical?: boolean;
  physicalConstraints?: {
    definitions?: Record<string, string>;
    foreignKeys?: Record<
      string,
      {
        onDelete?: string;
        onUpdate?: string;
        referencedSchema?: string;
      }
    >;
    omit?: string[];
  };
  version?: number;
}): AthenaAuthDatabase & { statements: string[] } {
  const statements: string[] = [];
  const database: AthenaAuthDatabase & { statements: string[] } = {
    async close() {},
    inTransaction: false,
    async query(text) {
      statements.push(text);
      if (/pg_advisory_(?:xact_)?lock|pg_advisory_unlock/i.test(text)) {
        return { rowCount: 1, rows: [{ acquired: true }] };
      }
      if (options?.missing) {
        throw new Error(
          'relation "athena.auth_schema_migrations" does not exist'
        );
      }
      if (
        /to_regclass/i.test(text) &&
        /authorization_catalog_state/i.test(text)
      ) {
        return {
          rowCount: 1,
          rows: [{ oid: "athena.authorization_catalog_state" }],
        };
      }
      if (/authorization_catalog_state/i.test(text)) {
        return {
          rowCount: 1,
          rows: [
            {
              catalog_version: AUTHORIZATION_CATALOG_VERSION,
              rights_fingerprint: authorizationRightsFingerprint(),
              roles_fingerprint: authorizationRolesFingerprint(),
            },
          ],
        };
      }
      if (
        /information_schema\.columns/i.test(text) &&
        /auth_schema_migrations/i.test(text)
      ) {
        return {
          rowCount: 1,
          rows: [{ column_name: "checksum" }],
        };
      }
      if (options?.physical) {
        const expectations = Object.values(
          ATHENA_AUTH_MIGRATION_EXPECTATIONS
        ).flat();
        if (
          /pg_catalog\.pg_constraint/i.test(text) &&
          /referenced_schema/i.test(text)
        ) {
          const foreignKey = ATHENA_AUTH_MIGRATION_EXPECTATIONS[37]?.find(
            (expectation) =>
              expectation.name === "api_keys_organization_id_fkey"
          );
          if (!foreignKey?.foreignKey) {
            return { rowCount: 0, rows: [] };
          }
          const override =
            options.physicalConstraints?.foreignKeys?.[foreignKey.name ?? ""];
          return {
            rowCount: 1,
            rows: [
              {
                columns: [...foreignKey.foreignKey.columns],
                condeferrable: false,
                condeferred: false,
                confdeltype: override?.onDelete === "set-null" ? "n" : "c",
                confmatchtype: "s",
                confupdtype: override?.onUpdate === "cascade" ? "c" : "a",
                constraint_name: foreignKey.name,
                referenced_columns: [
                  ...foreignKey.foreignKey.references.columns,
                ],
                referenced_schema:
                  override?.referencedSchema ??
                  foreignKey.foreignKey.references.schema,
                referenced_table: foreignKey.foreignKey.references.table,
                table_name: "api_keys",
                table_schema: "athena",
              },
            ],
          };
        }
        if (/pg_catalog\.pg_constraint/i.test(text)) {
          const rows = expectations
            .filter((expectation) => {
              if (
                expectation.kind !== "constraint" ||
                expectation.definition == null
              ) {
                return false;
              }
              const constraintName = expectation.object.split(".").at(-1);
              return !options.physicalConstraints?.omit?.includes(
                constraintName ?? ""
              );
            })
            .map((expectation) => {
              const [table_schema, table_name, constraint_name] =
                expectation.object.split(".");
              return {
                constraint_name,
                definition:
                  options.physicalConstraints?.definitions?.[
                    expectation.name
                  ] ?? expectation.definition,
                table_name,
                table_schema,
              };
            });
          return {
            rowCount: rows.length,
            rows,
          };
        }
        if (/pg_catalog\.pg_namespace/i.test(text)) {
          return {
            rowCount: 1,
            rows: [{ nspname: "athena" }],
          };
        }
        if (/information_schema\.tables/i.test(text)) {
          const rows = expectations
            .filter((expectation) => expectation.kind === "table")
            .map((expectation) => {
              const [table_schema, table_name] = expectation.object.split(".");
              return { table_name, table_schema };
            });
          return {
            rowCount: rows.length,
            rows,
          };
        }
        if (/information_schema\.columns/i.test(text)) {
          const rows = expectations
            .filter((expectation) => expectation.kind === "column")
            .map((expectation) => {
              const [table_schema, table_name, column_name] =
                expectation.object.split(".");
              return { column_name, table_name, table_schema };
            });
          return {
            rowCount: rows.length,
            rows,
          };
        }
        if (/pg_catalog\.pg_indexes/i.test(text)) {
          const rows = expectations
            .filter((expectation) => expectation.kind === "index")
            .map((expectation) => {
              const [schemaname, indexname] = expectation.object.split(".");
              return { indexname, schemaname };
            });
          return {
            rowCount: rows.length,
            rows,
          };
        }
        if (/information_schema\.table_constraints/i.test(text)) {
          const rows = expectations
            .filter((expectation) => {
              if (expectation.kind !== "constraint") {
                return false;
              }
              const constraintName = expectation.object.split(".").at(-1);
              return !options.physicalConstraints?.omit?.includes(
                constraintName ?? ""
              );
            })
            .map((expectation) => {
              const [table_schema, table_name, constraint_name] =
                expectation.object.split(".");
              return { constraint_name, table_name, table_schema };
            });
          return {
            rowCount: rows.length,
            rows,
          };
        }
      }
      if (/auth_schema_migrations/i.test(text)) {
        const rows = options?.ledger ?? [
          { version: options?.version ?? ATHENA_AUTH_SCHEMA_GENERATION },
        ];
        return {
          rowCount: rows.length,
          rows,
        };
      }
      return { rowCount: 0, rows: [] };
    },
    statements,
    async transaction(fn) {
      return fn(database);
    },
  };
  return database;
}
