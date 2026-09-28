import eventIngressSql from "./sql/0001_event_ingress.sql";
import eventIngressFailureMachineSql from "./sql/0002_event_ingress_failure_machine.sql";
import eventIngressOperationSql from "./sql/0003_event_ingress_operation.sql";

export const EMBEDDED_EVENT_INGRESS_LEDGER = "athena_event_ingress_migrations";

export const EMBEDDED_EVENT_INGRESS_REQUIRED_TABLES = [
  "event_ingress",
  "event_ledger",
  "event_outbox",
] as const;

export const EMBEDDED_EVENT_INGRESS_REQUIRED_RELATIONS =
  EMBEDDED_EVENT_INGRESS_REQUIRED_TABLES.map((table) => ({
    schema: "athena",
    table,
  }));

export const EMBEDDED_EVENT_INGRESS_MIGRATIONS = [
  {
    checksum: "event-ingress-v1",
    filename: "0001_event_ingress.sql",
    name: "event_ingress",
    sql: eventIngressSql,
    version: 1,
  },
  {
    checksum: "event-ingress-failure-machine-v1",
    filename: "0002_event_ingress_failure_machine.sql",
    name: "event_ingress_failure_machine",
    sql: eventIngressFailureMachineSql,
    version: 2,
  },
  {
    checksum: "event-ingress-operation-channel-v1",
    filename: "0003_event_ingress_operation.sql",
    name: "event_ingress_operation_channel",
    requiredRelations: EMBEDDED_EVENT_INGRESS_REQUIRED_RELATIONS,
    sql: eventIngressOperationSql,
    version: 3,
  },
] as const;
