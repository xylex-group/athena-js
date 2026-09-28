import type { MigrationSectionView } from "../cli/ui/types.ts";
import {
  type AthenaPostgresRuntime,
  createAthenaPostgresRuntime,
} from "../postgres/owned-runtime.ts";
import {
  EMBEDDED_BILLING_LEDGER,
  EMBEDDED_BILLING_MIGRATIONS,
} from "./embedded-billing/catalog.ts";
import {
  EMBEDDED_CHAT_LEDGER,
  EMBEDDED_CHAT_MIGRATIONS,
} from "./embedded-chat/catalog.ts";
import { shouldApplyEmbeddedChatMigrations } from "./embedded-chat/enablement.ts";
import {
  EMBEDDED_EVENT_INGRESS_LEDGER,
  EMBEDDED_EVENT_INGRESS_MIGRATIONS,
} from "./embedded-event-ingress/catalog.ts";
import {
  type AthenaEventIngressMigrationModules,
  shouldApplyEmbeddedBillingMigrations,
  shouldApplyEmbeddedEventIngressMigrations,
} from "./embedded-event-ingress/enablement.ts";
import {
  type EmbeddedLedgerInspection,
  inspectEmbeddedSqlLedger,
} from "./embedded-sql-apply.ts";

export type EmbeddedMigrateModules = AthenaEventIngressMigrationModules;

export interface EmbeddedModuleSection {
  readonly enabled: boolean;
  readonly id: "chat" | "event-ingress" | "billing";
  readonly inspection?: EmbeddedLedgerInspection;
  readonly section: MigrationSectionView;
}

function sectionFromInspection(
  title: string,
  enabled: boolean,
  disabledReason: string,
  inspection: EmbeddedLedgerInspection | undefined
): MigrationSectionView {
  if (!enabled) {
    return {
      rows: [{ name: disabledReason, status: "skipped" }],
      summary: "disabled",
      title,
    };
  }
  const entries = inspection?.entries ?? [];
  const applied = entries.filter((entry) => entry.status === "applied").length;
  const pending = entries.filter((entry) => entry.status === "pending").length;
  const adoptable = entries.filter(
    (entry) => entry.status === "legacy-compatible"
  ).length;
  const conflicts = entries.filter(
    (entry) => entry.status === "checksum-mismatch"
  ).length;
  const missingRelations = inspection?.missingRelations ?? [];
  const missingColumns = inspection?.missingColumns ?? [];
  const missing = [...missingRelations, ...missingColumns];
  return {
    rows: [
      ...entries.map((entry) => ({
        detail:
          entry.status === "checksum-mismatch"
            ? `ledger ${entry.storedChecksum} ≠ packaged ${entry.checksum}`
            : entry.status === "legacy-compatible"
              ? `ledger identity: legacy (${entry.storedChecksum}); packaged identity: SHA-256; action: adopt`
              : undefined,
        name: entry.filename,
        status: entry.status,
      })),
      ...missing.map((physicalObject) => ({
        detail: `ledger applied but ${physicalObject} is missing`,
        name: physicalObject,
        status: "drift" as const,
      })),
    ],
    summary: `${applied} / ${entries.length} applied${pending > 0 ? ` · ${pending} pending` : ""}${adoptable > 0 ? ` · ${adoptable} adopt` : ""}${conflicts > 0 ? ` · ${conflicts} conflicts` : ""}${missingRelations.length > 0 ? ` · ${missingRelations.length} missing relations` : ""}${missingColumns.length > 0 ? ` · ${missingColumns.length} missing columns` : ""}`,
    title,
  };
}

export async function inspectEmbeddedModuleSections(input: {
  connectionString: string;
  modules: EmbeddedMigrateModules | undefined;
  postgresRuntime?: AthenaPostgresRuntime;
}): Promise<readonly EmbeddedModuleSection[]> {
  const chatEnabled = shouldApplyEmbeddedChatMigrations(input.modules);
  const ingressEnabled = shouldApplyEmbeddedEventIngressMigrations(
    input.modules
  );
  const billingEnabled = shouldApplyEmbeddedBillingMigrations(input.modules);
  if (!(chatEnabled || ingressEnabled || billingEnabled)) {
    return [
      {
        enabled: false,
        id: "chat",
        section: sectionFromInspection(
          "Embedded Chat",
          false,
          "modules.chat !== true",
          undefined
        ),
      },
      {
        enabled: false,
        id: "event-ingress",
        section: sectionFromInspection(
          "Event Ingress",
          false,
          "modules.eventIngress / modules.billing not enabled",
          undefined
        ),
      },
      {
        enabled: false,
        id: "billing",
        section: sectionFromInspection(
          "Embedded Billing",
          false,
          "modules.billing !== true",
          undefined
        ),
      },
    ];
  }

  const owned =
    input.postgresRuntime ??
    createAthenaPostgresRuntime({ connectionString: input.connectionString });
  try {
    const queryable = {
      query: owned.query.bind(owned),
    };
    const chat = chatEnabled
      ? await inspectEmbeddedSqlLedger({
          ledgerTable: EMBEDDED_CHAT_LEDGER,
          migrations: EMBEDDED_CHAT_MIGRATIONS,
          queryable,
        })
      : undefined;
    const ingress = ingressEnabled
      ? await inspectEmbeddedSqlLedger({
          ledgerTable: EMBEDDED_EVENT_INGRESS_LEDGER,
          migrations: EMBEDDED_EVENT_INGRESS_MIGRATIONS,
          queryable,
        })
      : undefined;
    const billing = billingEnabled
      ? await inspectEmbeddedSqlLedger({
          ledgerTable: EMBEDDED_BILLING_LEDGER,
          migrations: EMBEDDED_BILLING_MIGRATIONS,
          queryable,
        })
      : undefined;
    return [
      {
        enabled: chatEnabled,
        id: "chat",
        inspection: chat,
        section: sectionFromInspection(
          "Embedded Chat",
          chatEnabled,
          "modules.chat !== true",
          chat
        ),
      },
      {
        enabled: ingressEnabled,
        id: "event-ingress",
        inspection: ingress,
        section: sectionFromInspection(
          "Event Ingress",
          ingressEnabled,
          "modules.eventIngress / modules.billing not enabled",
          ingress
        ),
      },
      {
        enabled: billingEnabled,
        id: "billing",
        inspection: billing,
        section: sectionFromInspection(
          "Embedded Billing",
          billingEnabled,
          "modules.billing !== true",
          billing
        ),
      },
    ];
  } finally {
    if (!input.postgresRuntime) {
      await owned.close();
    }
  }
}

export function embeddedModuleHasConflicts(
  sections: readonly EmbeddedModuleSection[]
): boolean {
  return sections.some(
    (section) =>
      (section.inspection?.missingRelations?.length ?? 0) > 0 ||
      section.section.rows.some(
        (row) => row.status === "checksum-mismatch" || row.status === "drift"
      )
  );
}

export function embeddedModuleHasPending(
  sections: readonly EmbeddedModuleSection[]
): boolean {
  return sections.some(
    (section) =>
      section.enabled &&
      section.section.rows.some(
        (row) => row.status === "pending" || row.status === "legacy-compatible"
      )
  );
}

export function embeddedModuleNeedsAdoption(
  sections: readonly EmbeddedModuleSection[]
): boolean {
  return sections.some(
    (section) =>
      section.enabled &&
      section.section.rows.some((row) => row.status === "legacy-compatible")
  );
}

export function formatEmbeddedModuleConflicts(
  sections: readonly EmbeddedModuleSection[]
): string {
  const lines = ["Packaged module ledger checksum mismatch."];
  for (const section of sections) {
    if (!section.enabled) {
      continue;
    }
    for (const row of section.section.rows) {
      if (row.status !== "checksum-mismatch" && row.status !== "drift") {
        continue;
      }
      lines.push(`${section.section.title}: ${row.name}`);
      if (row.detail) {
        lines.push(`  ${row.detail}`);
      }
    }
  }
  return lines.join("\n");
}
