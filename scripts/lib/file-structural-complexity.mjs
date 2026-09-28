/**
 * File-level structural complexity (LOC, function size, branches, nesting).
 * Non-regression against a per-subsystem baseline.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import ts from "typescript";

function walkSourceFiles(dir, extraFiles, out) {
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "coverage" ||
          entry.name === "examples"
        ) {
          continue;
        }
        walkSourceFiles(full, [], out);
        continue;
      }
      if (
        entry.isFile() &&
        (extname(entry.name) === ".ts" || extname(entry.name) === ".tsx")
      ) {
        out.push(full);
      }
    }
  }
  for (const file of extraFiles) {
    if (existsSync(file)) {
      out.push(file);
    }
  }
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function analyzeFileMetrics(filePath) {
  const sourceText = readFileSync(filePath, "utf8");
  const loc = sourceText.split(/\r?\n/).length;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  let maxFunctionLoc = 0;
  let branches = 0;
  let maxNesting = 0;

  const visit = (node, nesting) => {
    if (
      ts.isIfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCatchClause(node)
    ) {
      branches += 1;
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      branches += 1;
    }
    const nextNesting =
      ts.isBlock(node) || ts.isCaseBlock(node) ? nesting + 1 : nesting;
    if (nextNesting > maxNesting) {
      maxNesting = nextNesting;
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const fnLoc = end.line - start.line + 1;
      if (fnLoc > maxFunctionLoc) {
        maxFunctionLoc = fnLoc;
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextNesting));
  };
  visit(sourceFile, 0);
  return { branches, loc, maxFunctionLoc, maxNesting };
}

/**
 * @param {{
 *   name: string
 *   cwd: string
 *   roots: string[]
 *   extraFiles?: string[]
 *   baselinePath: string
 *   writeBaseline?: boolean
 * }} options
 */
export function runFileStructuralComplexityCheck(options) {
  /** @type {string[]} */
  const files = [];
  for (const root of options.roots) {
    walkSourceFiles(root, [], files);
  }
  walkSourceFiles("", options.extraFiles ?? [], files);
  const unique = [...new Set(files)].sort();

  /** @type {Record<string, { branches: number, loc: number, maxFunctionLoc: number, maxNesting: number }>} */
  let baseline = {};
  if (existsSync(options.baselinePath) && !options.writeBaseline) {
    baseline = JSON.parse(readFileSync(options.baselinePath, "utf8"));
  }

  /** @type {string[]} */
  const errors = [];
  /** @type {Record<string, { branches: number, loc: number, maxFunctionLoc: number, maxNesting: number }>} */
  const nextBaseline = {};

  for (const filePath of unique) {
    const rel = toPosix(relative(options.cwd, filePath));
    const metrics = analyzeFileMetrics(filePath);
    nextBaseline[rel] = metrics;
    const allowed = baseline[rel];
    if (!options.writeBaseline && allowed) {
      for (const metric of [
        "loc",
        "maxFunctionLoc",
        "branches",
        "maxNesting",
      ]) {
        if (metrics[metric] > allowed[metric]) {
          errors.push(
            `${options.name} ${rel} ${metric}=${metrics[metric]} (baseline ${allowed[metric]})`
          );
        }
      }
    }
  }

  if (options.writeBaseline) {
    const dir = dirname(options.baselinePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(
      options.baselinePath,
      `${JSON.stringify(nextBaseline, null, 2)}\n`
    );
  }

  return {
    errors,
    files: unique.length,
    ok: errors.length === 0,
  };
}
