import path from "node:path";
import type { MemoryEdgeType } from "./types.js";

export interface MemoryEdgeInput {
  edgeType: MemoryEdgeType;
  targetKey: string;
  weight: number;
}

export function buildDocumentEdges(input: {
  relativePath: string;
  moduleName?: string;
  language?: string;
  branchName?: string;
  tags?: string[];
  symbols?: Array<string | null | undefined>;
}): MemoryEdgeInput[] {
  const edges = new Map<string, MemoryEdgeInput>();

  addEdge(edges, "path", normalizeKey(input.relativePath), 0.7);
  addEdge(edges, "path", normalizeKey(path.basename(input.relativePath)), 0.9);

  if (input.moduleName) {
    addEdge(edges, "module", normalizeKey(input.moduleName), 1);
  }

  if (input.language) {
    addEdge(edges, "language", normalizeKey(input.language), 0.45);
  }

  if (input.branchName) {
    addEdge(edges, "branch", normalizeKey(input.branchName), 0.4);
  }

  for (const tag of input.tags ?? []) {
    addEdge(edges, "tag", normalizeKey(tag), 0.55);
  }

  for (const symbol of input.symbols ?? []) {
    if (!symbol) {
      continue;
    }
    addEdge(edges, "symbol", normalizeKey(symbol), 0.95);
  }

  return Array.from(edges.values());
}

function addEdge(
  edges: Map<string, MemoryEdgeInput>,
  edgeType: MemoryEdgeType,
  targetKey: string | null,
  weight: number
): void {
  if (!targetKey) {
    return;
  }

  const key = `${edgeType}:${targetKey}`;
  const existing = edges.get(key);
  if (existing) {
    existing.weight = Math.max(existing.weight, weight);
    return;
  }

  edges.set(key, {
    edgeType,
    targetKey,
    weight
  });
}

function normalizeKey(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^.*[.:]/, "")
    .replace(/\(\)$/, "")
    .toLowerCase();

  return normalized || null;
}
