import { formatObjectRef, objectKey } from "./ast.ts";
import type { MigrationAnalysis } from "./semantic-ir.ts";
import { findProvider } from "./verifier.ts";

export interface MigrationGraphEdge {
  fromVersion: number;
  object: string;
  toVersion: number;
}

export interface MigrationGraphNode {
  creates: string[];
  filename: string;
  reads: string[];
  version: number;
}

export interface MigrationGraph {
  edges: MigrationGraphEdge[];
  nodes: MigrationGraphNode[];
}

export function buildMigrationGraph(
  analyses: readonly MigrationAnalysis[]
): MigrationGraph {
  const nodes: MigrationGraphNode[] = analyses.map((analysis) => ({
    creates: analysis.effects.creates.map((object) => formatObjectRef(object)),
    filename: analysis.filename,
    reads: analysis.dependencies
      .filter(
        (item) =>
          item.category === "REQUIRES_TABLE" || item.category === "READS"
      )
      .map((item) => formatObjectRef(item.object)),
    version: analysis.version,
  }));
  const edges: MigrationGraphEdge[] = [];
  const seen = new Set<string>();
  for (const analysis of analyses) {
    for (const dependency of analysis.dependencies) {
      if (
        dependency.category !== "REQUIRES_TABLE" &&
        dependency.category !== "REQUIRES_COLUMN" &&
        dependency.category !== "REQUIRES_FUNCTION"
      ) {
        continue;
      }
      const provider = findProvider(analyses, dependency.object);
      if (!provider || provider.version === analysis.version) {
        continue;
      }
      const key = `${provider.version}->${analysis.version}:${objectKey(dependency.object)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({
        fromVersion: provider.version,
        object: formatObjectRef(dependency.object),
        toVersion: analysis.version,
      });
    }
  }
  return { edges, nodes };
}

export function formatMigrationGraph(graph: MigrationGraph): string {
  const lines = ["Migration graph", ""];
  for (const node of graph.nodes) {
    lines.push(`${node.filename}`);
    if (node.creates.length > 0) {
      lines.push(`   creates ${node.creates.slice(0, 12).join(", ")}`);
    }
    if (node.reads.length > 0) {
      lines.push(
        `   reads ${[...new Set(node.reads)].slice(0, 12).join(", ")}`
      );
    }
    const outgoing = graph.edges.filter(
      (edge) => edge.fromVersion === node.version
    );
    for (const edge of outgoing) {
      const target = graph.nodes.find(
        (item) => item.version === edge.toVersion
      );
      if (target) {
        lines.push(`       ↓ ${target.filename} (${edge.object})`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
