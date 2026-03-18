import { inspectCanonicalMemoryContract } from "../profile-registry.js";
import { ensureProjectScaffold } from "../project.js";
import { MindKeeperStorage } from "../storage.js";
import type { CanonicalMemoryInspectionReport, MemorySourceKind, MemoryTier } from "../types.js";

const SOURCE_KIND_ORDER: MemorySourceKind[] = ["manual", "decision", "diary", "project", "imported"];

export class CanonicalService {
  async inspectCanonicalMemory(projectRoot: string, options?: { recentLimit?: number }): Promise<CanonicalMemoryInspectionReport> {
    await ensureProjectScaffold(projectRoot);
    const storage = new MindKeeperStorage(projectRoot);

    try {
      const [contract, sources, branchViews] = await Promise.all([
        inspectCanonicalMemoryContract(projectRoot),
        Promise.resolve(storage.listSources()),
        Promise.resolve(storage.listBranchViews())
      ]);

      const totalSources = sources.length;
      const disabledSources = sources.filter((source) => source.isDisabled).length;
      const activeSources = totalSources - disabledSources;
      const recentLimit = options?.recentLimit ?? 8;

      return {
        projectRoot,
        schemaVersion: contract?.schemaVersion ?? null,
        contractFieldCount: contract?.fields.length ?? null,
        totalSources,
        activeSources,
        disabledSources,
        sourceKindSummary: SOURCE_KIND_ORDER.map((sourceKind) => summarizeSourceKind(sources, sourceKind)),
        tierSummary: summarizeTiers(sources),
        branchSummary: branchViews.map((view) => ({
          branchName: view.branchName,
          docCount: view.docCount,
          disabledCount: view.disabledCount,
          latestUpdatedAt: view.lastUpdatedAt ?? null
        })),
        recentSources: [...sources]
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, recentLimit)
          .map((source) => ({
            docId: source.docId,
            sourceKind: source.sourceKind,
            title: source.title,
            relativePath: source.relativePath,
            memoryTier: source.memoryTier ?? null,
            updatedAt: source.updatedAt,
            isDisabled: source.isDisabled
          }))
      };
    } finally {
      storage.close();
    }
  }
}

function summarizeSourceKind(
  sources: Array<{
    sourceKind: MemorySourceKind;
    updatedAt: number;
    isDisabled: boolean;
  }>,
  sourceKind: MemorySourceKind
): {
  sourceKind: MemorySourceKind;
  count: number;
  activeCount: number;
  disabledCount: number;
  latestUpdatedAt: number | null;
} {
  const matches = sources.filter((source) => source.sourceKind === sourceKind);
  return {
    sourceKind,
    count: matches.length,
    activeCount: matches.filter((source) => !source.isDisabled).length,
    disabledCount: matches.filter((source) => source.isDisabled).length,
    latestUpdatedAt: matches.length > 0 ? Math.max(...matches.map((source) => source.updatedAt)) : null
  };
}

function summarizeTiers(
  sources: Array<{
    memoryTier: MemoryTier | null;
  }>
): Array<{ memoryTier: MemoryTier | "unknown"; count: number }> {
  const counts = new Map<MemoryTier | "unknown", number>();
  for (const source of sources) {
    const tier = source.memoryTier ?? "unknown";
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([memoryTier, count]) => ({ memoryTier, count }))
    .sort((left, right) => right.count - left.count);
}
