import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { embeddingMetricsCollector, type EmbeddingMetricsSnapshot } from "../src/embedding-metrics.js";
import { MindKeeperService } from "../src/mindkeeper.js";
import { extractSymbolSpans } from "../src/symbols.js";

type SymbolBenchmark = {
  language: string;
  iterations: number;
  averageMs: number;
  symbolCount: number;
};

type RetrievalBenchmark = {
  indexedFiles: number;
  recallHits: number;
  indexMs: number;
  recallMs: number;
};

type VectorizationOperationBenchmark = {
  durationMs: number;
  embedding: EmbeddingMetricsSnapshot;
};

type VectorizationBenchmark = {
  activeProfile: string;
  operations: {
    indexProject: VectorizationOperationBenchmark;
    rememberDecision: VectorizationOperationBenchmark;
    rebuildActiveProfileIndex: VectorizationOperationBenchmark;
    recallQuery: VectorizationOperationBenchmark;
  };
};

type ProjectBenchmark = {
  name?: string;
  projectRoot: string;
  query: string;
  indexedFiles: number;
  skippedFiles: number;
  unchangedFiles: number;
  removedFiles: number;
  recallHits: number;
  indexMs: number;
  recallMs: number;
  embedding?: EmbeddingMetricsSnapshot;
};

type ProjectBenchmarkFailure = {
  name?: string;
  projectRoot: string;
  query: string;
  status: "error";
  error: string;
};

type ProjectBenchmarkResult = (ProjectBenchmark & { status: "ok" }) | ProjectBenchmarkFailure;

type ProjectBenchmarkSummary = {
  totalProjects: number;
  successfulProjects: number;
  failedProjects: number;
  totalIndexMs: number;
  totalRecallMs: number;
  slowestIndexProject?: { name: string; indexMs: number };
  slowestRecallProject?: { name: string; recallMs: number };
};

type ProjectSuiteEntry = {
  name?: string;
  root: string;
  query?: string;
};

type ProjectSuiteFile = {
  projects: ProjectSuiteEntry[];
};

type BenchmarkReport = {
  generatedAt: string;
  suiteProfile?: string;
  symbolBenchmarks: SymbolBenchmark[];
  retrievalBenchmark: RetrievalBenchmark;
  vectorizationBenchmark?: VectorizationBenchmark;
  projectBenchmark?: ProjectBenchmark;
  projectBenchmarks?: ProjectBenchmarkResult[];
  projectBenchmarkSummary?: ProjectBenchmarkSummary;
  comparison?: BenchmarkComparison;
};

type HistoryIndexEntry = {
  file: string;
  generatedAt: string;
  suiteProfile?: string;
  retrievalBenchmark: RetrievalBenchmark;
  languages: Array<{ language: string; averageMs: number; symbolCount: number }>;
  projects?: Array<{
    name: string;
    projectRoot: string;
    status: "ok" | "error";
    indexMs?: number;
    recallMs?: number;
    indexedFiles?: number;
    recallHits?: number;
  }>;
  projectBenchmarkSummary?: ProjectBenchmarkSummary;
  projectCount?: number;
};

type Threshold = {
  ratio: number;
  minDeltaMs: number;
};

type MetricDelta = {
  currentMs: number;
  baselineMs: number;
  deltaMs: number;
  deltaRatio: number;
  status: "improved" | "stable" | "regressed";
};

type BenchmarkComparison = {
  baselineWindow: number;
  baselineSamples: number;
  baselineGeneratedAt: string[];
  symbolBenchmarks: Array<{
    language: string;
    currentMs: number;
    baselineMs: number;
    deltaMs: number;
    deltaRatio: number;
    status: "improved" | "stable" | "regressed";
  }>;
  retrievalBenchmark: {
    indexMs: MetricDelta | null;
    recallMs: MetricDelta | null;
  };
  suiteProjects?: Array<{
    name: string;
    currentIndexMs: number;
    baselineIndexMs: number | null;
    indexStatus: "improved" | "stable" | "regressed" | "unknown";
    currentRecallMs: number;
    baselineRecallMs: number | null;
    recallStatus: "improved" | "stable" | "regressed" | "unknown";
  }>;
  regressions: Array<{
    metric: string;
    currentMs: number;
    baselineMs: number;
    deltaMs: number;
    deltaRatio: number;
    thresholdRatio: number;
    minDeltaMs: number;
  }>;
  summary: {
    hasRegression: boolean;
    regressionCount: number;
  };
};

const HISTORY_BASELINE_WINDOW = 5;
const SYMBOL_REGRESSION_THRESHOLD: Threshold = { ratio: 0.6, minDeltaMs: 8 };
const RETRIEVAL_INDEX_THRESHOLD: Threshold = { ratio: 0.75, minDeltaMs: 30 };
const RETRIEVAL_RECALL_THRESHOLD: Threshold = { ratio: 1, minDeltaMs: 12 };
const DEFAULT_PROJECT_QUERY = "memory recall decisions context branch";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const suiteProfile = args.suitePath
    ? normalizeProfileName(args.suiteProfile ?? path.basename(args.suitePath, path.extname(args.suitePath)))
    : undefined;
  const symbolBenchmarks = benchmarkSymbolExtraction();
  const retrievalRun = await benchmarkIndexAndRecall();
  const retrievalBenchmark = retrievalRun.retrievalBenchmark;
  const projectBenchmark = args.projectRoot
    ? await benchmarkProjectTree(args.projectRoot, args.projectQuery ?? DEFAULT_PROJECT_QUERY)
    : undefined;
  const projectBenchmarks = args.suitePath
    ? await benchmarkProjectSuite(args.suitePath)
    : undefined;
  const historyDir = args.historyDir ? path.resolve(process.cwd(), args.historyDir) : undefined;
  const historyIndexPath = historyDir ? path.join(historyDir, "index.json") : undefined;
  const historyIndex = historyIndexPath ? await readHistoryIndex(historyIndexPath, suiteProfile) : [];
  const comparison = buildComparison(
    {
      symbolBenchmarks,
      retrievalBenchmark,
      projectBenchmarks
    },
    historyIndex
  );
  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    suiteProfile,
    symbolBenchmarks,
    retrievalBenchmark,
    vectorizationBenchmark: retrievalRun.vectorizationBenchmark,
    projectBenchmark,
    projectBenchmarks,
    projectBenchmarkSummary: projectBenchmarks ? summarizeProjectBenchmarks(projectBenchmarks) : undefined,
    comparison: comparison ?? undefined
  };

  if (args.outPath) {
    const targetPath = path.resolve(process.cwd(), args.outPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(report, null, 2), "utf8");
  }

  if (historyDir && shouldWriteHistory(args)) {
    await persistHistory(report, historyDir);
  }

  console.log(JSON.stringify(report, null, 2));

  if (args.checkRegressions && comparison?.summary.hasRegression) {
    process.exitCode = 1;
  }
}

function benchmarkSymbolExtraction(): SymbolBenchmark[] {
  const samples = [
    {
      language: "typescript",
      filePath: "sample.ts",
      content: [
        "export class MemoryStore {",
        "  remember(text: string) {",
        "    return text;",
        "  }",
        "}",
        "",
        "export function recallTask(query: string) {",
        "  return query;",
        "}"
      ].join("\n")
    },
    {
      language: "python",
      filePath: "sample.py",
      content: [
        "class MemoryStore:",
        "    def remember(self, text):",
        "        return text",
        "",
        "async def recall_task(query):",
        "    return query"
      ].join("\n")
    },
    {
      language: "go",
      filePath: "sample.go",
      content: [
        "package memory",
        "",
        "type Store struct{}",
        "",
        "func Remember(text string) string {",
        "    return text",
        "}",
        "",
        "func (s *Store) Recall(query string) string {",
        "    return query",
        "}"
      ].join("\n")
    },
    {
      language: "rust",
      filePath: "sample.rs",
      content: [
        "struct MemoryStore;",
        "",
        "trait Keeper {",
        "    fn remember(&self, text: &str) -> String;",
        "}",
        "",
        "impl MemoryStore {",
        "    fn recall(&self, query: &str) -> String {",
        "        query.to_string()",
        "    }",
        "}"
      ].join("\n")
    },
    {
      language: "java",
      filePath: "MemoryStore.java",
      content: [
        "public class MemoryStore {",
        "    interface Keeper {",
        "        String remember(String text);",
        "    }",
        "",
        "    public String recall(String query) {",
        "        return query;",
        "    }",
        "}"
      ].join("\n")
    }
  ];

  return samples.map((sample) => {
    const iterations = 5;
    const started = performance.now();
    let symbolCount = 0;

    for (let i = 0; i < iterations; i += 1) {
      symbolCount = extractSymbolSpans(sample.filePath, sample.content).length;
    }

    const elapsed = performance.now() - started;
    return {
      language: sample.language,
      iterations,
      averageMs: round2(elapsed / iterations),
      symbolCount
    };
  });
}

async function benchmarkIndexAndRecall(): Promise<{
  retrievalBenchmark: RetrievalBenchmark;
  vectorizationBenchmark: VectorizationBenchmark;
}> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-bench-project-"));
  const srcDir = path.join(projectRoot, "src");
  const docsDir = path.join(projectRoot, "docs");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.mkdir(docsDir, { recursive: true });

  const files = [
    {
      filePath: path.join(srcDir, "store.ts"),
      content: [
        "export class MemoryStore {",
        "  remember(text: string) {",
        "    return text;",
        "  }",
        "",
        "  recall(query: string) {",
        "    return query;",
        "  }",
        "}"
      ].join("\n")
    },
    {
      filePath: path.join(srcDir, "diary.ts"),
      content: [
        "export function summarizeSession(lines: string[]) {",
        "  return lines.join(' ');",
        "}"
      ].join("\n")
    },
    {
      filePath: path.join(docsDir, "ARCHITECTURE.md"),
      content: [
        "# Architecture",
        "",
        "Mind Keeper stores project memories and decisions.",
        "Use remember and recall to manage indexed context."
      ].join("\n")
    }
  ];

  for (const file of files) {
    await fs.writeFile(file.filePath, file.content, "utf8");
  }

  const service = new MindKeeperService();

  try {
    embeddingMetricsCollector.setEnabled(true);

    embeddingMetricsCollector.reset();
    const indexStarted = performance.now();
    const indexResult = await service.indexProject(projectRoot, { force: true });
    const indexMs = performance.now() - indexStarted;
    const indexEmbedding = embeddingMetricsCollector.snapshot();

    embeddingMetricsCollector.reset();
    const rememberStarted = performance.now();
    await service.rememberDecision({
      projectRoot,
      title: "Benchmark decision",
      decision: "Prefer project-scoped memory indexing.",
      rationale: "This creates one stable remembered document for vectorization baseline measurement.",
      tags: ["benchmark", "decision"]
    });
    const rememberMs = performance.now() - rememberStarted;
    const rememberEmbedding = embeddingMetricsCollector.snapshot();

    embeddingMetricsCollector.reset();
    const rebuildStarted = performance.now();
    const rebuildReport = await service.rebuildActiveProfileIndex(projectRoot);
    const rebuildMs = performance.now() - rebuildStarted;
    const rebuildEmbedding = embeddingMetricsCollector.snapshot();

    embeddingMetricsCollector.reset();
    const recallStarted = performance.now();
    const recallResults = await service.recall({
      projectRoot,
      query: "remember memory store project decisions",
      topK: 5,
      minScore: 0,
      explain: true
    });
    const recallMs = performance.now() - recallStarted;
    const recallEmbedding = embeddingMetricsCollector.snapshot();

    return {
      retrievalBenchmark: {
        indexedFiles: indexResult.indexedFiles,
        recallHits: recallResults.length,
        indexMs: round2(indexMs),
        recallMs: round2(recallMs)
      },
      vectorizationBenchmark: {
        activeProfile: rebuildReport.profileName,
        operations: {
          indexProject: {
            durationMs: round2(indexMs),
            embedding: indexEmbedding
          },
          rememberDecision: {
            durationMs: round2(rememberMs),
            embedding: rememberEmbedding
          },
          rebuildActiveProfileIndex: {
            durationMs: round2(rebuildMs),
            embedding: rebuildEmbedding
          },
          recallQuery: {
            durationMs: round2(recallMs),
            embedding: recallEmbedding
          }
        }
      }
    };
  } finally {
    embeddingMetricsCollector.reset();
    embeddingMetricsCollector.setEnabled(false);
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}

async function benchmarkProjectTree(projectRoot: string, query: string): Promise<ProjectBenchmark> {
  const resolvedRoot = path.resolve(process.cwd(), projectRoot);
  const service = new MindKeeperService();

  embeddingMetricsCollector.setEnabled(true);
  embeddingMetricsCollector.reset();
  try {
    const indexStarted = performance.now();
    const indexResult = await service.indexProject(resolvedRoot, { force: true });
    const indexMs = performance.now() - indexStarted;

    const recallStarted = performance.now();
    const recallResults = await service.recall({
      projectRoot: resolvedRoot,
      query,
      topK: 8,
      minScore: 0,
      explain: false
    });
    const recallMs = performance.now() - recallStarted;
    const embedding = embeddingMetricsCollector.snapshot();

    return {
      name: path.basename(resolvedRoot),
      projectRoot: resolvedRoot,
      query,
      indexedFiles: indexResult.indexedFiles,
      skippedFiles: indexResult.skippedFiles,
      unchangedFiles: indexResult.unchangedFiles,
      removedFiles: indexResult.removedFiles,
      recallHits: recallResults.length,
      indexMs: round2(indexMs),
      recallMs: round2(recallMs),
      embedding
    };
  } finally {
    embeddingMetricsCollector.reset();
    embeddingMetricsCollector.setEnabled(false);
  }
}

async function benchmarkProjectSuite(suitePath: string): Promise<ProjectBenchmarkResult[]> {
  const entries = await loadProjectSuite(suitePath);
  const results: ProjectBenchmarkResult[] = [];

  for (const entry of entries) {
    try {
      const benchmark = await benchmarkProjectTree(entry.root, entry.query ?? DEFAULT_PROJECT_QUERY);
      results.push({
        ...benchmark,
        name: entry.name ?? benchmark.name,
        projectRoot: entry.root,
        query: entry.query ?? benchmark.query,
        status: "ok"
      });
    } catch (error) {
      results.push({
        name: entry.name ?? path.basename(entry.root),
        projectRoot: entry.root,
        query: entry.query ?? DEFAULT_PROJECT_QUERY,
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

async function loadProjectSuite(suitePath: string): Promise<Array<{ name?: string; root: string; query?: string }>> {
  const resolvedSuitePath = path.resolve(process.cwd(), suitePath);
  const suiteDir = path.dirname(resolvedSuitePath);
  const raw = await fs.readFile(resolvedSuitePath, "utf8");
  const parsed = JSON.parse(raw) as ProjectSuiteFile;

  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    throw new Error(`Benchmark suite ${resolvedSuitePath} must contain a non-empty projects array.`);
  }

  return parsed.projects.map((entry, index) => {
    if (!entry || typeof entry.root !== "string" || entry.root.trim().length === 0) {
      throw new Error(`Benchmark suite entry ${index + 1} is missing a valid root.`);
    }

    return {
      name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name : undefined,
      root: path.resolve(suiteDir, entry.root),
      query: typeof entry.query === "string" && entry.query.trim().length > 0 ? entry.query : undefined
    };
  });
}

function summarizeProjectBenchmarks(results: ProjectBenchmarkResult[]): ProjectBenchmarkSummary {
  const successes = results.filter((item): item is ProjectBenchmark & { status: "ok" } => item.status === "ok");
  const totalIndexMs = round2(successes.reduce((sum, item) => sum + item.indexMs, 0));
  const totalRecallMs = round2(successes.reduce((sum, item) => sum + item.recallMs, 0));
  const slowestIndex = successes.reduce<(ProjectBenchmark & { status: "ok" }) | null>(
    (slowest, current) => (slowest === null || current.indexMs > slowest.indexMs ? current : slowest),
    null
  );
  const slowestRecall = successes.reduce<(ProjectBenchmark & { status: "ok" }) | null>(
    (slowest, current) => (slowest === null || current.recallMs > slowest.recallMs ? current : slowest),
    null
  );

  return {
    totalProjects: results.length,
    successfulProjects: successes.length,
    failedProjects: results.length - successes.length,
    totalIndexMs,
    totalRecallMs,
    slowestIndexProject: slowestIndex
      ? { name: slowestIndex.name ?? slowestIndex.projectRoot, indexMs: slowestIndex.indexMs }
      : undefined,
    slowestRecallProject: slowestRecall
      ? { name: slowestRecall.name ?? slowestRecall.projectRoot, recallMs: slowestRecall.recallMs }
      : undefined
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function persistHistory(
  report: BenchmarkReport,
  historyDir: string
): Promise<void> {
  await fs.mkdir(historyDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const fileName = `${stamp}.json`;
  const reportPath = path.join(historyDir, fileName);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  const indexPath = path.join(historyDir, "index.json");
  const existing = await readHistoryIndex(indexPath, undefined, { includeAllProfiles: true });
  const next = [
    ...existing.filter((item) => item.file !== fileName),
    {
      file: fileName,
      generatedAt: report.generatedAt,
      suiteProfile: report.suiteProfile,
      retrievalBenchmark: report.retrievalBenchmark,
      languages: report.symbolBenchmarks.map((item) => ({
        language: item.language,
        averageMs: item.averageMs,
        symbolCount: item.symbolCount
      })),
      projects: report.projectBenchmarks?.map((item) => ({
        name: item.name ?? path.basename(item.projectRoot),
        projectRoot: item.projectRoot,
        status: item.status,
        indexMs: item.status === "ok" ? item.indexMs : undefined,
        recallMs: item.status === "ok" ? item.recallMs : undefined,
        indexedFiles: item.status === "ok" ? item.indexedFiles : undefined,
        recallHits: item.status === "ok" ? item.recallHits : undefined
      })),
      projectBenchmarkSummary: report.projectBenchmarkSummary,
      projectCount: report.projectBenchmarks?.length
    }
  ].sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));

  await fs.writeFile(indexPath, JSON.stringify(next, null, 2), "utf8");

  if (report.suiteProfile) {
    await writeSuiteProfileHistoryViews(historyDir, report.suiteProfile, next);
  }
}

async function readHistoryIndex(
  indexPath: string,
  suiteProfile?: string,
  options?: { includeAllProfiles?: boolean }
): Promise<Array<{
  file: string;
  generatedAt: string;
  suiteProfile?: string;
  retrievalBenchmark: { indexedFiles: number; recallHits: number; indexMs: number; recallMs: number };
  languages: Array<{ language: string; averageMs: number; symbolCount: number }>;
  projectBenchmarkSummary?: ProjectBenchmarkSummary;
  projectCount?: number;
}>> {
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = await hydrateHistoryEntries(path.dirname(indexPath), JSON.parse(raw) as HistoryIndexEntry[]);
    if (options?.includeAllProfiles) {
      return parsed;
    }
    if (!suiteProfile) {
      return parsed.filter((entry) => !entry.suiteProfile);
    }
    return parsed.filter((entry) => entry.suiteProfile === suiteProfile);
  } catch {
    return [];
  }
}

async function hydrateHistoryEntries(historyDir: string, entries: HistoryIndexEntry[]): Promise<HistoryIndexEntry[]> {
  const hydrated: HistoryIndexEntry[] = [];

  for (const entry of entries) {
    if (entry.projects && entry.projects.length > 0) {
      hydrated.push(entry);
      continue;
    }

    const reportPath = path.join(historyDir, entry.file);
    try {
      const raw = await fs.readFile(reportPath, "utf8");
      const report = JSON.parse(raw) as BenchmarkReport;
      hydrated.push({
        ...entry,
        suiteProfile: entry.suiteProfile ?? report.suiteProfile,
        projects: report.projectBenchmarks?.map((item) => ({
          name: item.name ?? path.basename(item.projectRoot),
          projectRoot: item.projectRoot,
          status: item.status,
          indexMs: item.status === "ok" ? item.indexMs : undefined,
          recallMs: item.status === "ok" ? item.recallMs : undefined,
          indexedFiles: item.status === "ok" ? item.indexedFiles : undefined,
          recallHits: item.status === "ok" ? item.recallHits : undefined
        })),
        projectBenchmarkSummary: entry.projectBenchmarkSummary ?? report.projectBenchmarkSummary,
        projectCount: entry.projectCount ?? report.projectBenchmarks?.length
      });
    } catch {
      hydrated.push(entry);
    }
  }

  return hydrated;
}

async function writeSuiteProfileHistoryViews(
  historyDir: string,
  suiteProfile: string,
  entries: HistoryIndexEntry[]
): Promise<void> {
  const suiteEntries = entries.filter((entry) => entry.suiteProfile === suiteProfile);
  const profilesDir = path.join(historyDir, "profiles");
  const profileDir = path.join(profilesDir, suiteProfile);
  await fs.mkdir(profileDir, { recursive: true });

  await fs.writeFile(path.join(profileDir, "index.json"), JSON.stringify(suiteEntries, null, 2), "utf8");
  if (suiteEntries.length > 0) {
    await fs.writeFile(
      path.join(profileDir, "latest.json"),
      JSON.stringify(suiteEntries[suiteEntries.length - 1], null, 2),
      "utf8"
    );
  }

  const summaries = summarizeSuiteProfiles(entries);
  await fs.mkdir(profilesDir, { recursive: true });
  await fs.writeFile(path.join(profilesDir, "index.json"), JSON.stringify(summaries, null, 2), "utf8");
}

function summarizeSuiteProfiles(entries: HistoryIndexEntry[]): Array<{
  suiteProfile: string;
  samples: number;
  latestGeneratedAt: string;
  latestProjectCount?: number;
  latestSuccessfulProjects?: number;
  latestFailedProjects?: number;
}> {
  const grouped = new Map<string, HistoryIndexEntry[]>();

  for (const entry of entries) {
    if (!entry.suiteProfile) {
      continue;
    }

    const current = grouped.get(entry.suiteProfile) ?? [];
    current.push(entry);
    grouped.set(entry.suiteProfile, current);
  }

  return [...grouped.entries()]
    .map(([profile, profileEntries]) => {
      const sorted = [...profileEntries].sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
      const latest = sorted[sorted.length - 1];
      return {
        suiteProfile: profile,
        samples: sorted.length,
        latestGeneratedAt: latest.generatedAt,
        latestProjectCount: latest.projectCount,
        latestSuccessfulProjects: latest.projectBenchmarkSummary?.successfulProjects,
        latestFailedProjects: latest.projectBenchmarkSummary?.failedProjects
      };
    })
    .sort((left, right) => left.suiteProfile.localeCompare(right.suiteProfile));
}

function buildComparison(
  current: Pick<BenchmarkReport, "symbolBenchmarks" | "retrievalBenchmark" | "projectBenchmarks">,
  history: HistoryIndexEntry[]
): BenchmarkComparison | null {
  const baselineEntries = history.slice(-HISTORY_BASELINE_WINDOW);
  if (baselineEntries.length === 0) {
    return null;
  }

  const regressions: BenchmarkComparison["regressions"] = [];
  const symbolBenchmarks = current.symbolBenchmarks
    .map((benchmark) => {
      const baselineMs = median(
        baselineEntries
          .map((entry) => entry.languages.find((item) => item.language === benchmark.language)?.averageMs)
          .filter((value): value is number => typeof value === "number")
      );

      if (baselineMs === null) {
        return null;
      }

      const delta = compareMetric(benchmark.averageMs, baselineMs, SYMBOL_REGRESSION_THRESHOLD);
      if (delta.status === "regressed") {
        regressions.push({
          metric: `symbol:${benchmark.language}`,
          currentMs: delta.currentMs,
          baselineMs: delta.baselineMs,
          deltaMs: delta.deltaMs,
          deltaRatio: delta.deltaRatio,
          thresholdRatio: SYMBOL_REGRESSION_THRESHOLD.ratio,
          minDeltaMs: SYMBOL_REGRESSION_THRESHOLD.minDeltaMs
        });
      }

      return {
        language: benchmark.language,
        ...delta
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const indexBaseline = median(baselineEntries.map((entry) => entry.retrievalBenchmark.indexMs));
  const recallBaseline = median(baselineEntries.map((entry) => entry.retrievalBenchmark.recallMs));
  const indexDelta = indexBaseline === null
    ? null
    : compareMetric(current.retrievalBenchmark.indexMs, indexBaseline, RETRIEVAL_INDEX_THRESHOLD);
  const recallDelta = recallBaseline === null
    ? null
    : compareMetric(current.retrievalBenchmark.recallMs, recallBaseline, RETRIEVAL_RECALL_THRESHOLD);
  const suiteProjects = buildSuiteProjectComparisons(current.projectBenchmarks, baselineEntries, regressions);

  if (indexDelta?.status === "regressed") {
    regressions.push({
      metric: "retrieval:indexMs",
      currentMs: indexDelta.currentMs,
      baselineMs: indexDelta.baselineMs,
      deltaMs: indexDelta.deltaMs,
      deltaRatio: indexDelta.deltaRatio,
      thresholdRatio: RETRIEVAL_INDEX_THRESHOLD.ratio,
      minDeltaMs: RETRIEVAL_INDEX_THRESHOLD.minDeltaMs
    });
  }

  if (recallDelta?.status === "regressed") {
    regressions.push({
      metric: "retrieval:recallMs",
      currentMs: recallDelta.currentMs,
      baselineMs: recallDelta.baselineMs,
      deltaMs: recallDelta.deltaMs,
      deltaRatio: recallDelta.deltaRatio,
      thresholdRatio: RETRIEVAL_RECALL_THRESHOLD.ratio,
      minDeltaMs: RETRIEVAL_RECALL_THRESHOLD.minDeltaMs
    });
  }

  return {
    baselineWindow: HISTORY_BASELINE_WINDOW,
    baselineSamples: baselineEntries.length,
    baselineGeneratedAt: baselineEntries.map((entry) => entry.generatedAt),
    symbolBenchmarks,
    retrievalBenchmark: {
      indexMs: indexDelta,
      recallMs: recallDelta
    },
    suiteProjects: suiteProjects.length > 0 ? suiteProjects : undefined,
    regressions,
    summary: {
      hasRegression: regressions.length > 0,
      regressionCount: regressions.length
    }
  };
}

function compareMetric(currentMs: number, baselineMs: number, threshold: Threshold): MetricDelta {
  const deltaMs = round2(currentMs - baselineMs);
  const deltaRatio = baselineMs <= 0 ? 0 : round4(deltaMs / baselineMs);
  const isRegression = deltaMs >= threshold.minDeltaMs && deltaRatio >= threshold.ratio;
  const isImprovement = deltaMs <= -threshold.minDeltaMs && deltaRatio <= -0.2;

  return {
    currentMs: round2(currentMs),
    baselineMs: round2(baselineMs),
    deltaMs,
    deltaRatio,
    status: isRegression ? "regressed" : isImprovement ? "improved" : "stable"
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round2((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return round2(sorted[middle]);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function buildSuiteProjectComparisons(
  currentProjects: ProjectBenchmarkResult[] | undefined,
  baselineEntries: HistoryIndexEntry[],
  regressions: BenchmarkComparison["regressions"]
): NonNullable<BenchmarkComparison["suiteProjects"]> {
  if (!currentProjects || currentProjects.length === 0) {
    return [];
  }

  const baselineProjects = new Map<string, Array<{ indexMs: number; recallMs: number }>>();
  for (const entry of baselineEntries) {
    for (const project of entry.projects ?? []) {
      if (project.status !== "ok" || typeof project.indexMs !== "number" || typeof project.recallMs !== "number") {
        continue;
      }

      const key = suiteProjectKey(project.name, project.projectRoot);
      const current = baselineProjects.get(key) ?? [];
      current.push({ indexMs: project.indexMs, recallMs: project.recallMs });
      baselineProjects.set(key, current);
    }
  }

  return currentProjects
    .filter((project): project is ProjectBenchmark & { status: "ok" } => project.status === "ok")
    .map((project) => {
      const key = suiteProjectKey(project.name ?? path.basename(project.projectRoot), project.projectRoot);
      const history = baselineProjects.get(key) ?? [];
      const baselineIndexMs = median(history.map((item) => item.indexMs));
      const baselineRecallMs = median(history.map((item) => item.recallMs));
      const indexDelta = baselineIndexMs === null
        ? null
        : compareMetric(project.indexMs, baselineIndexMs, RETRIEVAL_INDEX_THRESHOLD);
      const recallDelta = baselineRecallMs === null
        ? null
        : compareMetric(project.recallMs, baselineRecallMs, RETRIEVAL_RECALL_THRESHOLD);

      if (indexDelta?.status === "regressed") {
        regressions.push({
          metric: `suite:${project.name ?? project.projectRoot}:indexMs`,
          currentMs: indexDelta.currentMs,
          baselineMs: indexDelta.baselineMs,
          deltaMs: indexDelta.deltaMs,
          deltaRatio: indexDelta.deltaRatio,
          thresholdRatio: RETRIEVAL_INDEX_THRESHOLD.ratio,
          minDeltaMs: RETRIEVAL_INDEX_THRESHOLD.minDeltaMs
        });
      }

      if (recallDelta?.status === "regressed") {
        regressions.push({
          metric: `suite:${project.name ?? project.projectRoot}:recallMs`,
          currentMs: recallDelta.currentMs,
          baselineMs: recallDelta.baselineMs,
          deltaMs: recallDelta.deltaMs,
          deltaRatio: recallDelta.deltaRatio,
          thresholdRatio: RETRIEVAL_RECALL_THRESHOLD.ratio,
          minDeltaMs: RETRIEVAL_RECALL_THRESHOLD.minDeltaMs
        });
      }

      return {
        name: project.name ?? path.basename(project.projectRoot),
        currentIndexMs: project.indexMs,
        baselineIndexMs,
        indexStatus: indexDelta?.status ?? "unknown",
        currentRecallMs: project.recallMs,
        baselineRecallMs,
        recallStatus: recallDelta?.status ?? "unknown"
      };
    });
}

function suiteProjectKey(name: string, projectRoot: string): string {
  return `${name}::${projectRoot.toLowerCase()}`;
}

function parseArgs(argv: string[]): {
  outPath?: string;
  historyDir?: string;
  projectRoot?: string;
  projectQuery?: string;
  suitePath?: string;
  suiteProfile?: string;
  checkRegressions: boolean;
} {
  let outPath: string | undefined;
  let historyDir: string | undefined;
  let projectRoot: string | undefined;
  let projectQuery: string | undefined;
  let suitePath: string | undefined;
  let suiteProfile: string | undefined;
  let checkRegressions = false;

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--out" && argv[i + 1]) {
      outPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--history-dir" && argv[i + 1]) {
      historyDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--project-root" && argv[i + 1]) {
      projectRoot = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--project-query" && argv[i + 1]) {
      projectQuery = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--suite" && argv[i + 1]) {
      suitePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--suite-profile" && argv[i + 1]) {
      suiteProfile = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--check-regressions") {
      checkRegressions = true;
    }
  }

  return { outPath, historyDir, projectRoot, projectQuery, suitePath, suiteProfile, checkRegressions };
}

function normalizeProfileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

function shouldWriteHistory(args: {
  outPath?: string;
  checkRegressions: boolean;
}): boolean {
  if (args.checkRegressions && !args.outPath) {
    return false;
  }
  return Boolean(args.outPath);
}

await main();
