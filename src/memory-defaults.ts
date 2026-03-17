import crypto from "node:crypto";
import path from "node:path";
import type { MemorySourceKind, MemoryTier } from "./types.js";

export function sha1(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function topLevelModule(relativePath: string): string | null {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}

export function relativeToProject(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function defaultMemoryTierForSource(sourceKind: MemorySourceKind | "project"): MemoryTier {
  switch (sourceKind) {
    case "decision":
      return "stable";
    case "manual":
    case "imported":
      return "stable";
    case "diary":
      return "working";
    case "project":
    default:
      return "project";
  }
}

export function defaultStabilityForSource(sourceKind: MemorySourceKind | "project"): number {
  switch (sourceKind) {
    case "decision":
      return 0.95;
    case "manual":
      return 0.82;
    case "imported":
      return 0.72;
    case "diary":
      return 0.46;
    case "project":
    default:
      return 0.52;
  }
}
