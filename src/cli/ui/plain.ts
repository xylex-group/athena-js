import { paint, statusColor } from "./colors.ts";
import { railBar, railEnd, railStart } from "./rail.ts";
import { statusLabel } from "./symbols.ts";
import { columnWidth, padEnd } from "./table.ts";
import type {
  AthenaCliUI,
  CliCapabilities,
  Diagnostic,
  MigrationReportView,
  MigrationSectionView,
} from "./types.ts";

function indentBlock(text: string, prefix = "  "): string[] {
  return text.split("\n").map((line) => (line.length === 0 ? "" : `${prefix}${line}`));
}

function kv(
  label: string,
  value: string,
  capabilities: CliCapabilities,
  labelWidth = 12
): string {
  return `${paint(padEnd(label, labelWidth), "dim", capabilities)}${value}`;
}

function outcomeColor(
  outcome: string
): "red" | "yellow" | "green" | "none" {
  const text = outcome.toLowerCase();
  if (text.includes("conflict") || text.includes("drift") || text.includes("error")) {
    return "red";
  }
  if (text.includes("pending") || text.includes("remain")) {
    return "yellow";
  }
  if (text.includes("up to date") || text.includes("no pending")) {
    return "green";
  }
  return "none";
}

function writeSection(
  emit: (message: string) => void,
  section: MigrationSectionView,
  capabilities: CliCapabilities,
  interactiveLook: boolean
): void {
  emit(paint(section.title, "bold", capabilities));
  emit("");
  if (section.rows.length === 0) {
    emit(paint("(none)", "dim", capabilities));
  } else {
    const nameWidth = columnWidth(
      section.rows.map((row) => row.name),
      34
    );
    emit(
      paint(
        `${padEnd("Migration", nameWidth)}  Status`,
        "dim",
        capabilities
      )
    );
    for (const row of section.rows) {
      const label = paint(
        statusLabel(row.status, interactiveLook),
        statusColor(row.status),
        capabilities
      );
      const duration =
        row.durationMs !== undefined
          ? paint(`  ${row.durationMs}ms`, "dim", capabilities)
          : "";
      emit(`${padEnd(row.name, nameWidth)}  ${label}${duration}`);
      if (row.detail) {
        for (const line of indentBlock(row.detail, "  ")) {
          emit(paint(line, "dim", capabilities));
        }
      }
    }
  }
  if (section.summary) {
    emit("");
    emit(paint(section.summary, "dim", capabilities));
  }
  emit("");
}

function writeDiagnostic(
  emit: (message: string) => void,
  diagnostic: Diagnostic,
  capabilities: CliCapabilities
): void {
  const color =
    diagnostic.level === "error"
      ? "red"
      : diagnostic.level === "warn"
        ? "yellow"
        : "none";
  emit("");
  const [first, ...rest] = diagnostic.message.split("\n");
  emit(paint(first ?? diagnostic.message, color, capabilities));
  for (const line of rest) {
    emit(line.length === 0 ? "" : line);
  }
  if (diagnostic.hint) {
    emit("");
    emit(paint(diagnostic.hint, "dim", capabilities));
  }
}

export function createPlainUi(
  capabilities: CliCapabilities,
  write: (message: string) => void = (message) => {
    console.log(message);
  }
): AthenaCliUI {
  const interactiveLook = capabilities.mode === "interactive";
  const emit = (message: string) => {
    write(railBar(message, capabilities));
  };

  return {
    capabilities,
    intro(title) {
      if (capabilities.quiet) {
        return;
      }
      write(railStart(title, capabilities));
    },
    outro(message) {
      if (capabilities.quiet) {
        return;
      }
      write(railEnd(message, capabilities));
    },
    note(message, title) {
      if (capabilities.quiet) {
        return;
      }
      if (title) {
        emit(paint(title, "bold", capabilities));
      }
      for (const line of message.split("\n")) {
        emit(line);
      }
    },
    warn(message) {
      emit(paint(message, "yellow", capabilities));
    },
    error(message) {
      emit(paint(message, "red", capabilities));
    },
    success(message) {
      if (capabilities.quiet) {
        return;
      }
      emit(paint(message, "green", capabilities));
    },
    info(message) {
      if (capabilities.quiet) {
        return;
      }
      for (const line of message.split("\n")) {
        emit(line);
      }
    },
    renderMigrationReport(report: MigrationReportView) {
      if (capabilities.quiet && capabilities.mode !== "json") {
        return;
      }
      write(railStart(report.title, capabilities));
      emit("");
      if (report.target) {
        emit(paint("Target", "bold", capabilities));
        emit("");
        emit(kv("Provider", report.target.provider, capabilities));
        emit(kv("Database", report.target.database, capabilities));
        emit(kv("Directory", report.target.directory, capabilities));
        emit("");
      }

      writeSection(emit, report.application, capabilities, interactiveLook);
      writeSection(emit, report.auth, capabilities, interactiveLook);

      emit(paint(report.outcome, outcomeColor(report.outcome), capabilities));
      for (const diagnostic of report.diagnostics) {
        writeDiagnostic(emit, diagnostic, capabilities);
      }
      if (report.logPath) {
        emit("");
        emit(paint(`Log  ${report.logPath}`, "dim", capabilities));
      }
      write(railEnd("", capabilities));
    },
    async confirm() {
      // Non-interactive plain UI never prompts.
      return false;
    },
  };
}
