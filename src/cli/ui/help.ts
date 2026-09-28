import { paint } from "./colors.ts";
import { frameBlock, usesRail } from "./rail.ts";
import type { CliCapabilities } from "./types.ts";

const SECTION_RE = /^[A-Za-z][A-Za-z0-9 /&|()._-]{0,48}:$/;

function colorizeFlags(line: string, capabilities: CliCapabilities): string {
  if (!capabilities.color) {
    return line;
  }
  return line
    .replaceAll(
      /(^| )(--[a-zA-Z0-9-]+)/g,
      (_match, space: string, flag: string) =>
        `${space}${paint(flag, "yellow", capabilities)}`
    )
    .replaceAll(
      /(^| )(-[a-zA-Z])(?![a-zA-Z0-9-])/g,
      (_match, space: string, flag: string) =>
        `${space}${paint(flag, "yellow", capabilities)}`
    );
}

/**
 * Paint help pages: bold title, cyan section headers, yellow flags,
 * then the shared TUI rail when interactive.
 */
export function styleHelpText(
  text: string,
  capabilities: CliCapabilities
): string {
  const lines = text.split("\n");
  const styled = lines.map((line, index) => {
    if (index === 0 && line.length > 0) {
      return usesRail(capabilities) ? line : paint(line, "bold", capabilities);
    }
    if (SECTION_RE.test(line)) {
      return paint(line, "cyan", capabilities);
    }
    return colorizeFlags(line, capabilities);
  });
  const body = styled.join("\n");
  if (!usesRail(capabilities)) {
    return body;
  }
  return frameBlock(body, capabilities);
}

const TAG_COLOR: Record<string, "cyan" | "green" | "yellow" | "red" | "dim"> = {
  admin: "cyan",
  config: "cyan",
  "dry-run": "cyan",
  error: "red",
  filter: "cyan",
  merge: "cyan",
  mode: "cyan",
  note: "dim",
  ok: "green",
  provider: "cyan",
  skip: "dim",
  targets: "cyan",
  warn: "yellow",
  write: "green",
};

/**
 * Color leading `[tag]` markers used by generate / init / env / admin output.
 */
export function colorizeTaggedLine(
  line: string,
  capabilities: CliCapabilities
): string {
  if (!capabilities.color) {
    return line;
  }
  return line.replace(
    /^(\s*)\[([^\]]+)\]/,
    (_match, space: string, rawTag: string) => {
      const tag = rawTag.trim().toLowerCase();
      const color = TAG_COLOR[tag];
      if (!color) {
        return `${space}[${rawTag}]`;
      }
      return `${space}${paint(`[${rawTag}]`, color, capabilities)}`;
    }
  );
}
