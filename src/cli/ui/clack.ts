/**
 * Interactive renderer. Uses the same structured report as plain mode.
 * Optional @clack/prompts is loaded lazily so domain code never depends on it.
 */
import { createPlainUi } from "./plain.ts";
import type {
  AthenaCliUI,
  CliCapabilities,
  MigrationReportView,
} from "./types.ts";

type ClackModule = {
  intro?: (message: string) => void;
  outro?: (message: string) => void;
  confirm?: (opts: { message: string }) => Promise<boolean | symbol>;
  isCancel?: (value: unknown) => boolean;
};

async function loadClack(): Promise<ClackModule | undefined> {
  try {
    return (await import("@clack/prompts")) as ClackModule;
  } catch {
    return undefined;
  }
}

export function createClackUi(
  capabilities: CliCapabilities,
  write: (message: string) => void = (message) => {
    console.log(message);
  }
): AthenaCliUI {
  // Prefer Clack when available; fall back to plain structured rendering.
  // Domain correctness does not depend on this module.
  const plain = createPlainUi({ ...capabilities, mode: "interactive" }, write);

  return {
    ...plain,
    capabilities,
    intro(title) {
      void loadClack().then((clack) => {
        if (clack?.intro) {
          clack.intro(title);
          return;
        }
        plain.intro(title);
      });
    },
    outro(message) {
      void loadClack().then((clack) => {
        if (clack?.outro) {
          clack.outro(message);
          return;
        }
        plain.outro(message);
      });
    },
    renderMigrationReport(report: MigrationReportView) {
      plain.renderMigrationReport(report);
    },
    async confirm(message) {
      const clack = await loadClack();
      if (!clack?.confirm) {
        return false;
      }
      const value = await clack.confirm({ message });
      if (clack.isCancel?.(value)) {
        return false;
      }
      return Boolean(value);
    },
  };
}
