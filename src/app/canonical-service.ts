import fs from "node:fs/promises";
import { inspectCanonicalMemoryContract } from "../profile-registry.js";
import { ensureProjectScaffold } from "../project.js";
import { MindKeeperStorage } from "../storage.js";
import type {
  CanonicalMemoryExportReport,
  CanonicalMemoryInspectionReport,
  MemorySourceKind,
  MemoryTier
} from "../types.js";

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

  async exportCanonicalMemory(
    projectRoot: string,
    options?: {
      sourceKinds?: MemorySourceKind[];
      includeContent?: boolean;
      includeProjectContent?: boolean;
      limit?: number;
    }
  ): Promise<CanonicalMemoryExportReport> {
    await ensureProjectScaffold(projectRoot);
    const storage = new MindKeeperStorage(projectRoot);

    try {
      const [contract, allSources] = await Promise.all([
        inspectCanonicalMemoryContract(projectRoot),
        Promise.resolve(storage.listSources())
      ]);

      const filtered = allSources
        .filter((source) => !options?.sourceKinds?.length || options.sourceKinds.includes(source.sourceKind))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, options?.limit ?? allSources.length);

      const includeContent = options?.includeContent ?? false;
      const includeProjectContent = options?.includeProjectContent ?? false;
      const items = await Promise.all(
        filtered.map(async (source) => {
          const shouldIncludeContent = includeContent && (source.sourceKind !== "project" || includeProjectContent);
          const content = shouldIncludeContent ? await safeReadFile(source.path) : null;

          return {
            docId: source.docId,
            sourceKind: source.sourceKind,
            title: source.title,
            path: source.path,
            relativePath: source.relativePath,
            tags: source.tags,
            moduleName: source.moduleName,
            symbol: source.symbol,
            branchName: source.branchName,
            contentHash: source.checksum,
            memoryTier: source.memoryTier ?? null,
            stabilityScore: source.stabilityScore ?? null,
            distillConfidence: source.distillConfidence ?? null,
            distillReason: source.distillReason ?? null,
            updatedAt: source.updatedAt,
            disabled: source.isDisabled,
            disabledReason: source.disabledReason,
            helpfulVotes: source.helpfulVotes,
            noisyVotes: source.noisyVotes,
            supersededBy: null,
            conflictSubjects: [],
            contentIncluded: shouldIncludeContent,
            content
          };
        })
      );

      return {
        projectRoot,
        exportedAt: Date.now(),
        schemaVersion: contract?.schemaVersion ?? null,
        contractFieldCount: contract?.fields.length ?? null,
        totalExported: items.length,
        filters: {
          sourceKinds: options?.sourceKinds?.length ? options.sourceKinds : null,
          includeContent,
          includeProjectContent
        },
        items
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

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
