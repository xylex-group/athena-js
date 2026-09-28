import { slugify } from "../utils/slugify.ts";
import type { NamingStyle } from "./types.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_IDENTIFIERS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "as",
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
  "any",
  "boolean",
  "constructor",
  "declare",
  "get",
  "module",
  "require",
  "number",
  "set",
  "string",
  "symbol",
  "type",
  "from",
  "of",
]);

function splitWords(input: string): string[] {
  return input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

function capitalize(word: string): string {
  return word.length > 0
    ? `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`
    : word;
}

function ensureValidIdentifier(candidate: string, fallback: string): string {
  const normalized = candidate.length > 0 ? candidate : fallback;
  const prefixed = /^[0-9]/.test(normalized) ? `_${normalized}` : normalized;
  if (RESERVED_IDENTIFIERS.has(prefixed)) {
    return `${prefixed}_value`;
  }
  return prefixed;
}

export function applyNamingStyle(input: string, style: NamingStyle): string {
  const words = splitWords(input);
  if (words.length === 0) {
    return "";
  }

  switch (style) {
    case "preserve":
      return input;
    case "camel": {
      const [first, ...rest] = words;
      return `${first.toLowerCase()}${rest.map(capitalize).join("")}`;
    }
    case "pascal":
      return words.map(capitalize).join("");
    case "snake":
      return words.map((word) => word.toLowerCase()).join("_");
    case "kebab":
      return slugify(words.join("-"));
    default:
      return input;
  }
}

export function toSafeIdentifier(
  input: string,
  style: NamingStyle,
  fallback = "value"
): string {
  const transformed = applyNamingStyle(input, style);
  const normalized = transformed
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const fallbackValue = splitWords(input).join("");
  return ensureValidIdentifier(
    normalized.length > 0 ? normalized : fallbackValue,
    fallback
  );
}

/**
 * Render an object/type property key.
 *
 * Quotes only when the name is not a valid ECMAScript IdentifierName.
 * Reserved words such as `public` stay unquoted — they are legal as property
 * names in object literals and type members (unlike bare binding identifiers).
 */
export function escapeTypePropertyName(propertyName: string): string {
  if (IDENTIFIER_PATTERN.test(propertyName)) {
    return propertyName;
  }
  return `'${propertyName.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function escapeStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
