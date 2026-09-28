import type { TableRef } from "./ast.ts";

export interface PlpgsqlBindings {
  parameters: Set<string>;
  rowVariables: Map<string, TableRef>;
  variables: Set<string>;
}

export function emptyPlpgsqlBindings(
  parameters: readonly string[] = []
): PlpgsqlBindings {
  const names = new Set(parameters.filter((name) => name.trim().length > 0));
  return {
    parameters: names,
    rowVariables: new Map(),
    variables: new Set(names),
  };
}

export function isProceduralName(
  bindings: PlpgsqlBindings | undefined,
  name: string
): boolean {
  if (!bindings) {
    return false;
  }
  return bindings.variables.has(name) || bindings.parameters.has(name);
}

function declareSection(body: string): string | undefined {
  const declareMatch = /\bDECLARE\b/i.exec(body);
  if (!declareMatch || declareMatch.index === undefined) {
    return;
  }
  const from = declareMatch.index + declareMatch[0].length;
  const beginMatch = /\bBEGIN\b/i.exec(body.slice(from));
  if (!beginMatch || beginMatch.index === undefined) {
    return;
  }
  return body.slice(from, from + beginMatch.index);
}

function stripLineComment(line: string): string {
  const index = line.indexOf("--");
  if (index === -1) {
    return line.trim();
  }
  return line.slice(0, index).trim();
}

function tableFromRowType(typeName: string): TableRef {
  const parts = typeName.split(".").filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return {
      kind: "table",
      name: parts[parts.length - 1] ?? typeName,
      schema: parts[0] ?? "public",
    };
  }
  return {
    kind: "table",
    name: typeName,
    schema: "public",
  };
}

export function parsePlpgsqlBindings(
  body: string,
  parameters: readonly string[] = []
): PlpgsqlBindings {
  const bindings = emptyPlpgsqlBindings(parameters);
  const section = declareSection(body);
  if (!section) {
    return bindings;
  }
  for (const rawLine of section.split(";")) {
    const line = stripLineComment(rawLine);
    if (line.length === 0) {
      continue;
    }
    const rowType =
      /^([A-Za-z_][\w$]*)\s+(?:CONSTANT\s+)?((?:[A-Za-z_][\w$]*\.)?[A-Za-z_][\w$]*)\s*%ROWTYPE\b/i.exec(
        line
      );
    if (rowType) {
      const name = rowType[1];
      const typeName = rowType[2];
      if (name && typeName) {
        bindings.variables.add(name);
        bindings.rowVariables.set(name, tableFromRowType(typeName));
      }
      continue;
    }
    const scalar = /^([A-Za-z_][\w$]*)\s+/u.exec(line);
    if (scalar?.[1] && !/^ALIAS\b/i.test(line.slice(scalar[0].length))) {
      bindings.variables.add(scalar[1]);
    }
  }
  return bindings;
}
