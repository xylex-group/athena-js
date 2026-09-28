import { formatRuntimeLabel } from "./extract-exports-core.mts";

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function exampleForSymbol(ir: DocsApiIr, symbolId: string, name: string): string {
  const hit = ir.examples.find(
    (example) =>
      example.symbolIds.includes(symbolId) ||
      example.symbolIds.includes(name) ||
      example.symbolIds.some((id) => id.endsWith(`#${name}`))
  );
  if (!hit) {
    return "—";
  }
  return `\`${hit.id}\``;
}

export function renderMethodReference(ir: DocsApiIr): string {
  const lines = [
    "# Complete SDK Method Reference",
    "",
    "Generated from Docs API IR (`docs/generated/api.v2.json`). Do not edit by hand.",
    "",
    `Package: \`${ir.package.name}@${ir.package.version}\``,
    "",
    "Regenerate with: `pnpm docs:generate`",
    "",
  ];

  let total = 0;
  for (const entry of ir.entrypoints) {
    if (entry.kind !== "module" || entry.symbols.length === 0) {
      continue;
    }
    const symbols = [...entry.symbols].sort((a, b) => a.name.localeCompare(b.name));
    total += symbols.length;
    lines.push(`## \`${entry.importPath}\``);
    lines.push("");
    lines.push(
      `Runtime: ${formatRuntimeLabel(entry)}. Source: \`${entry.source ?? "null"}\`.`
    );
    lines.push("");
    lines.push("| Method | Signature | Example | Notes |");
    lines.push("|---|---|---|---|");
    for (const symbol of symbols) {
      const notes = [
        symbol.summary,
        symbol.deprecated
          ? `Deprecated${symbol.replacement ? `: ${symbol.replacement}` : "."}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `| \`${escapeCell(symbol.name)}\` | \`${escapeCell(symbol.signature)}\` | ${escapeCell(exampleForSymbol(ir, symbol.id, symbol.name))} | ${escapeCell(notes) || "—"} |`
      );
    }
    lines.push("");
  }

  lines.splice(6, 0, `Total documented symbols: **${total}**`, "");
  return `${lines.join("\n")}\n`;
}

export function slugifySymbolName(name: string): string {
  return name
    .replaceAll("OAuth2", "Oauth2")
    .replaceAll("OAuth", "Oauth")
    .replaceAll("SDK", "Sdk")
    .replaceAll("API", "Api")
    .replaceAll("OTP", "Otp")
    .replaceAll("ID", "Id")
    .replaceAll("UI", "Ui")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .join("-");
}

function yamlEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ").trim();
}

export function renderAuthUiItemPage(options: {
  name: string;
  kind: string;
  summary: string;
  importPath: string;
  source: string;
  signature: string;
}): string {
  const { name, kind, summary, importPath, source, signature } = options;
  return `---
title: "${yamlEscape(name)}"
description: "${yamlEscape(summary)}"
generated_by: "packages/athena-auth-ui/scripts/docs/render-reference.mts"
---

# ${name}

## Import

\`\`\`tsx
import { ${name} } from "${importPath}"
\`\`\`

## Details

- Kind: \`${kind}\`
- Source: \`${source}\`
- Signature: \`${signature}\`

${summary}
`;
}

export function renderAuthUiEntrypointPage(options: {
  importPath: string;
  source: string;
  runtime: string[];
  names: string[];
}): string {
  const { importPath, source, runtime, names } = options;
  const list = names.map((name) => `- \`${name}\``).join("\n");
  return `---
title: "${yamlEscape(importPath)}"
description: "Public entrypoint ${yamlEscape(importPath)}"
generated_by: "packages/athena-auth-ui/scripts/docs/render-reference.mts"
---

# \`${importPath}\`

- Source: \`${source}\`
- Runtime: ${runtime.join(", ") || "unspecified"}

## Exports

${list || "- _(none)_"}
`;
}
