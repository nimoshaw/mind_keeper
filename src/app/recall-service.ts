import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "../config.js";
import { cosineSimilarity, EmbeddingService, normalize } from "../embedding.js";
import {
  buildTaskIntentPlan,
  buildTaskWavePlan,
  shouldStopTaskWave,
  type ProjectQueryFocus,
  type RecallWaveResult
} from "../planner.js";
import { ensureProjectScaffold } from "../project.js";
import { RerankerService } from "../reranker.js";
import { detectLanguage as detectIndexedLanguage, inferSymbolName as inferIndexedSymbolName } from "../symbols.js";
import { MindKeeperStorage } from "../storage.js";
import { lexicalScore } from "../text.js";
import type { ChunkRecord, ContextForTaskInput, ContextTaskStage, MemorySourceKind, RecallInput, RerankerProfile } from "../types.js";

const execFileAsync = promisify(execFile);

export class RecallService {
  private readonly embeddingService = new EmbeddingService();
  private readonly rerankerService = new RerankerService();

  async recall(input: RecallInput): Promise<ChunkRecord[]> {
    const config = await ensureProjectScaffold(input.projectRoot);
    const profile = this.getActiveProfile(config);
    const rerankerProfile = this.getActiveRerankerProfile(config);
    const topK = input.topK ?? config.retrieval.topK;
    const threshold = input.minScore ?? config.retrieval.similarityThreshold;
    const queryEmbedding = normalize(await this.embeddingService.embed(profile, input.query));
    const timeWindow = resolveTimeWindow(input);
    const requestedSymbol = normalizeSymbolName(input.symbol);
    const requestedBranch = input.branchName?.trim().toLowerCase() ?? null;
    const relatedPaths = dedupeStrings(input.relatedPaths ?? []).map((item) => item.toLowerCase());

    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const candidates = storage.fetchCandidates({
        sourceKinds: input.sourceKinds,
        pathContains: input.pathContains,
        moduleName: input.moduleName,
        language: input.language,
        symbol: input.symbol
      }).filter((candidate) => passesTimeWindow(candidate.updatedAt ?? Date.now(), timeWindow));
      const relationMatches = storage.getRelationMatches(
        candidates.map((candidate) => candidate.docId),
        buildRelationHints({
          moduleName: input.moduleName,
          symbol: input.symbol,
          pathContains: input.pathContains,
          relatedPaths: input.relatedPaths,
          branchName: input.branchName,
          language: input.language,
          query: input.query
        })
      );

      const scored = candidates
        .map((candidate) => {
          const vector = cosineSimilarity(queryEmbedding, candidate.embedding);
          const lexical = lexicalScore(input.query, candidate.content);
          const sourceBoost = config.sourcePriority[candidate.sourceKind] ?? 0;
          const freshness = freshnessBoost(candidate.updatedAt ?? Date.now(), timeWindow);
          const tierBoost = memoryTierBoost(candidate.memoryTier) * config.retrieval.tierWeight;
          const stabilityBoost = Math.max(0, candidate.stabilityScore ?? 0) * config.retrieval.stabilityWeight;
          const pathBoost =
            (input.pathContains && candidate.path.toLowerCase().includes(input.pathContains.toLowerCase())
              ? config.retrieval.pathBoost
              : 0) +
            relatedPathBoost(candidate.path, relatedPaths, config.retrieval.relatedPathBoost);
          const symbolBoost = symbolMatchBoost(candidate.symbol, requestedSymbol, config.retrieval.symbolBoost);
          const branchBoost = branchAdjustment({
            requestedBranch,
            candidateBranch: candidate.branchName,
            exactBoost: config.retrieval.branchBoost,
            siblingBoost: config.retrieval.siblingBranchBoost,
            crossPenalty: config.retrieval.crossBranchPenalty
          });
          const titleBoost = candidate.title ? titleOverlapBoost(input.query, candidate.title, config.retrieval.titleBoostMax) : 0;
          const feedbackBoost = feedbackAdjustment({
            helpfulVotes: candidate.helpfulVotes ?? 0,
            noisyVotes: candidate.noisyVotes ?? 0,
            feedbackWeight: config.retrieval.feedbackWeight,
            feedbackHalfLifeDays: config.retrieval.feedbackHalfLifeDays,
            staleNoisyBias: config.retrieval.staleNoisyBias,
            lastFeedbackAt: candidate.lastFeedbackAt ?? null,
            updatedAt: candidate.updatedAt ?? Date.now()
          });
          const relationMatch = relationMatches.get(candidate.docId);
          const relationBoost = Math.min(
            config.retrieval.relationWeight,
            (relationMatch?.score ?? 0) * config.retrieval.relationWeight * 0.4
          );
          const vectorScore = vector * config.retrieval.vectorWeight;
          const lexicalScorePart = lexical * config.retrieval.lexicalWeight;
          const sourceScore = sourceBoost * config.retrieval.sourcePriorityWeight;
          const freshnessScore = freshness * config.retrieval.freshnessWeight;
          const total =
            vectorScore +
            lexicalScorePart +
            sourceScore +
            freshnessScore +
            tierBoost +
            stabilityBoost +
            pathBoost +
            symbolBoost +
            branchBoost +
            titleBoost +
            feedbackBoost +
            relationBoost;

          return {
            id: candidate.id,
            docId: candidate.docId,
            sourceKind: candidate.sourceKind,
            path: candidate.path,
            title: candidate.title,
            chunkIndex: candidate.chunkIndex,
            content: candidate.content,
            tags: candidate.tags,
            moduleName: candidate.moduleName,
            language: candidate.language,
            symbol: candidate.symbol,
            branchName: candidate.branchName,
            memoryTier: candidate.memoryTier,
            stabilityScore: candidate.stabilityScore,
            distillConfidence: candidate.distillConfidence,
            distillReason: candidate.distillReason,
            updatedAt: candidate.updatedAt,
            relationHits: input.explain ? relationMatch?.hits ?? [] : undefined,
            score: total,
            scoreDetails: input.explain
              ? {
                  vector: round4(vectorScore),
                  lexical: round4(lexicalScorePart),
                  sourcePriority: round4(sourceScore),
                  freshness: round4(freshnessScore),
                  tierBoost: round4(tierBoost),
                  stabilityBoost: round4(stabilityBoost),
                  pathBoost: round4(pathBoost),
                  symbolBoost: round4(symbolBoost),
                  branchBoost: round4(branchBoost),
                  titleBoost: round4(titleBoost),
                  feedbackBoost: round4(feedbackBoost),
                  relationBoost: round4(relationBoost),
                  rerankModel: 0,
                  rerank: 0,
                  total: round4(total)
                }
              : undefined
          };
        })
        .filter((candidate) => (candidate.score ?? 0) >= threshold)
        .sort(compareChunks);

      const reranked = rerankChunks(scored, input.query, {
        rerankDepth: config.retrieval.rerankDepth,
        rerankWeight: config.retrieval.rerankWeight,
        explain: Boolean(input.explain),
        topK
      });

      const modelReranked = await this.applyModelRerank(reranked, input.query, {
        config,
        rerankerProfile,
        explain: Boolean(input.explain),
        topK
      });

      return modelReranked.slice(0, topK);
    } finally {
      storage.close();
    }
  }

  async contextForTask(input: ContextForTaskInput): Promise<{
    query: string;
    gates: {
      minScore: number;
      taskStage: ContextTaskStage;
      usedTaskStageGate: boolean;
      usedModuleGate: boolean;
      usedFileGate: boolean;
      usedSymbolGate: boolean;
      usedBranchGate: boolean;
      usedDiagnosticsGate: boolean;
      usedRelatedFileGate: boolean;
      symbol: string | null;
      language: string | null;
      branchName: string | null;
      relatedFiles: string[];
      diagnosticFiles: string[];
      diagnosticSymbols: string[];
      budget: number;
      budgetPolicy: string;
      intentType: ContextTaskStage;
      intentAnchors: {
        currentFile: string | null;
        moduleName: string | null;
        symbol: string | null;
        language: string | null;
        branchName: string | null;
        relatedFiles: string[];
        diagnosticFiles: string[];
        diagnosticSymbols: string[];
        hasSelectedText: boolean;
        hasDiagnostics: boolean;
      };
      queryPlan: {
        stableSourceKinds: MemorySourceKind[];
        localSourceKinds: MemorySourceKind[];
        recentSourceKinds: MemorySourceKind[];
        fallbackSourceKinds: MemorySourceKind[];
        projectQueryOrder: ProjectQueryFocus[];
        symbolBias: "exact" | "diagnostic-first" | "none";
        branchBias: "prefer_current_branch" | "soft";
      };
      knowledgeReserve: number;
      projectReserve: number;
      tokenBudget: number;
      estimatedTokensUsed: number;
      omittedByTokenBudget: number;
      usedTokenBudgetGate: boolean;
      wavePlanType: "light-wave";
      usedRecentWave: boolean;
      usedFallbackWave: boolean;
      stopReason: string;
      wavePlan: RecallWaveResult[];
      selectedBySource: Record<MemorySourceKind, number>;
      fallbackUsed: boolean;
    };
    results: ChunkRecord[];
  }> {
    const config = await ensureProjectScaffold(input.projectRoot);
    const budget = input.topK ?? Math.min(6, config.retrieval.topK);
    const minScore = Math.max(config.retrieval.similarityThreshold, 0.25);
    const currentFileName = input.currentFile ? path.basename(input.currentFile) : undefined;
    const relativeFile = input.currentFile ? relativeToProject(input.projectRoot, input.currentFile) : undefined;
    const moduleName = relativeFile ? topLevelModule(relativeFile) ?? undefined : undefined;
    const language = input.currentFile ? detectIndexedLanguage(input.currentFile) ?? undefined : undefined;
    const diagnosticHints = await extractDiagnosticHints(input.projectRoot, input.diagnostics);
    const symbolCandidates = dedupeStrings(
      [
        ...diagnosticHints.symbols,
        normalizeSymbolName(input.currentSymbol) ?? "",
        inferIndexedSymbolName(currentFileName ?? "", input.selectedText ?? "", false, input.currentFile ?? currentFileName ?? "snippet.ts", false) ?? ""
      ].filter(Boolean)
    );
    const symbol = symbolCandidates[0] ?? undefined;
    const branchName = input.branchName?.trim() || (await detectGitBranch(input.projectRoot)) || undefined;
    const relatedFiles = dedupeStrings([...(input.relatedFiles ?? []), ...diagnosticHints.files]);
    const taskStage = inferTaskStage(input);
    const stagePolicy = resolveTaskStagePolicy(
      taskStage,
      budget,
      config.retrieval.taskKnowledgeReserve,
      config.retrieval.taskContextTokenBudget
    );
    const relatedFileNames = dedupeStrings(relatedFiles.map((item) => path.basename(item)).filter(Boolean));
    const intentPlan = buildTaskIntentPlan({
      taskStage,
      anchors: {
        currentFile: currentFileName ?? null,
        moduleName: moduleName ?? null,
        symbol: symbol ?? null,
        language: language ?? null,
        branchName: branchName ?? null,
        relatedFiles: relatedFiles.map((item) => relativeOrOriginal(input.projectRoot, item)),
        diagnosticFiles: diagnosticHints.files.map((item) => relativeOrOriginal(input.projectRoot, item)),
        diagnosticSymbols: diagnosticHints.symbols,
        hasSelectedText: Boolean(input.selectedText?.trim()),
        hasDiagnostics: Boolean(input.diagnostics?.trim())
      }
    });
    const wavePlan = buildTaskWavePlan({
      taskStage,
      budget,
      minScore
    });
    const waveResults: RecallWaveResult[] = [
      {
        ...wavePlan[0],
        used: true,
        resultCount: 0
      }
    ];
    const query = buildTaskQuery(input, {
      intentType: intentPlan.intentType,
      symbol,
      branchName,
      relatedFiles,
      diagnosticFiles: diagnosticHints.files,
      diagnosticSymbols: diagnosticHints.symbols
    });

    const stableWave = wavePlan[1];
    const stableResults = await this.recall({
      projectRoot: input.projectRoot,
      query,
      topK: stableWave.budget,
      sourceKinds: intentPlan.queryPlan.stableSourceKinds,
      relatedPaths: relatedFileNames,
      minScore: stableWave.minScore,
      explain: true
    });
    waveResults.push({
      ...stableWave,
      used: true,
      resultCount: stableResults.length
    });
    let knowledgeResults = stableResults;
    let recentWaveUsed = false;

    const projectQueries = buildProjectQueries({
      projectRoot: input.projectRoot,
      query,
      budget,
      sourceKinds: intentPlan.queryPlan.localSourceKinds,
      projectQueryOrder: intentPlan.queryPlan.projectQueryOrder,
      currentFileName,
      relatedFileNames,
      moduleName,
      language,
      symbol,
      branchName,
      minScore
    });

    let projectResults: ChunkRecord[] = [];
    let merged = mergeTaskContextResults(knowledgeResults, projectResults, budget, stagePolicy.knowledgeReserve);
    let stopReason =
      shouldStopTaskWave({
        waveName: stableWave.name,
        taskStage,
        budget,
        selectedCount: merged.length,
        stableCount: stableResults.length,
        projectCount: 0,
        recentCount: 0,
        knowledgeReserve: stagePolicy.knowledgeReserve,
        projectReserve: stagePolicy.projectReserve
      }) ?? "";

    const localWave = wavePlan[2];
    if (!stopReason) {
      for (const projectQuery of projectQueries) {
        const partial = await this.recall(projectQuery);
        projectResults = dedupeChunks([...projectResults, ...partial])
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, budget);

        if (projectResults.length >= budget) {
          break;
        }
      }
      waveResults.push({
        ...localWave,
        used: true,
        resultCount: projectResults.length
      });

      merged = mergeTaskContextResults(knowledgeResults, projectResults, budget, stagePolicy.knowledgeReserve);
      stopReason =
        shouldStopTaskWave({
          waveName: localWave.name,
          taskStage,
          budget,
          selectedCount: merged.length,
          stableCount: stableResults.length,
          projectCount: projectResults.length,
          recentCount: 0,
          knowledgeReserve: stagePolicy.knowledgeReserve,
          projectReserve: stagePolicy.projectReserve
        }) ?? "";
    } else {
      waveResults.push({
        ...localWave,
        used: false,
        resultCount: 0
      });
    }

    const recentWave = wavePlan[3];
    if (!stopReason) {
      const shouldUseRecentWave =
        !recentWave.optional ||
        merged.length < budget ||
        stableResults.length < stagePolicy.knowledgeReserve;

      if (shouldUseRecentWave) {
        const recentResults = await this.recall({
          projectRoot: input.projectRoot,
          query,
          topK: recentWave.budget,
          sourceKinds: intentPlan.queryPlan.recentSourceKinds,
          branchName: branchName ?? undefined,
          relatedPaths: relatedFileNames,
          minScore: recentWave.minScore,
          explain: true
        });
        recentWaveUsed = recentResults.length > 0;
        knowledgeResults = dedupeChunks([...stableResults, ...recentResults]).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        merged = mergeTaskContextResults(knowledgeResults, projectResults, budget, stagePolicy.knowledgeReserve);
        waveResults.push({
          ...recentWave,
          used: recentWaveUsed,
          resultCount: recentResults.length
        });
        stopReason =
          shouldStopTaskWave({
            waveName: recentWave.name,
            taskStage,
            budget,
            selectedCount: merged.length,
            stableCount: stableResults.length,
            projectCount: projectResults.length,
            recentCount: recentResults.length,
            knowledgeReserve: stagePolicy.knowledgeReserve,
            projectReserve: stagePolicy.projectReserve
          }) ?? "";
      } else {
        waveResults.push({
          ...recentWave,
          used: false,
          resultCount: 0
        });
      }
    } else {
      waveResults.push({
        ...recentWave,
        used: false,
        resultCount: 0
      });
    }

    let fallbackUsed = false;

    if (merged.length === 0) {
      const fallbackWave = wavePlan[4];
      merged = await this.recall({
        projectRoot: input.projectRoot,
        query,
        topK: fallbackWave.budget,
        sourceKinds: intentPlan.queryPlan.fallbackSourceKinds,
        minScore: fallbackWave.minScore,
        explain: true
      });
      fallbackUsed = true;
      waveResults.push({
        ...fallbackWave,
        used: true,
        resultCount: merged.length
      });
      stopReason = "fallback_wave_used";
    } else {
      const fallbackWave = wavePlan[4];
      waveResults.push({
        ...fallbackWave,
        used: false,
        resultCount: 0
      });
    }

    merged = rerankTaskContextResults(merged, {
      currentFileName,
      relatedFileNames,
      symbolCandidates,
      diagnosticFileNames: diagnosticHints.files.map((item) => path.basename(item)),
      explain: true
    }).slice(0, budget);
    const tokenBudgeted = applyTaskContextTokenBudget(merged, stagePolicy.tokenBudget);

    return {
      query,
      gates: {
        minScore,
        taskStage,
        usedTaskStageGate: taskStage !== "general",
        usedModuleGate: Boolean(moduleName),
        usedFileGate: Boolean(currentFileName),
        usedSymbolGate: Boolean(symbol),
        usedBranchGate: Boolean(branchName),
        usedDiagnosticsGate: Boolean(input.diagnostics?.trim()),
        usedRelatedFileGate: relatedFileNames.length > 0,
        intentType: intentPlan.intentType,
        intentAnchors: intentPlan.anchors,
        queryPlan: intentPlan.queryPlan,
        symbol: symbol ?? null,
        language: language ?? null,
        branchName: branchName ?? null,
        relatedFiles: relatedFiles.map((item) => relativeOrOriginal(input.projectRoot, item)),
        diagnosticFiles: diagnosticHints.files.map((item) => relativeOrOriginal(input.projectRoot, item)),
        diagnosticSymbols: symbolCandidates,
        budget,
        budgetPolicy: stagePolicy.description,
        knowledgeReserve: stagePolicy.knowledgeReserve,
        projectReserve: stagePolicy.projectReserve,
        tokenBudget: stagePolicy.tokenBudget,
        estimatedTokensUsed: tokenBudgeted.usedTokens,
        omittedByTokenBudget: tokenBudgeted.omittedCount,
        usedTokenBudgetGate: tokenBudgeted.omittedCount > 0,
        wavePlanType: "light-wave",
        usedRecentWave: recentWaveUsed,
        usedFallbackWave: fallbackUsed,
        stopReason: stopReason || "token_budget_applied_after_light_wave",
        wavePlan: waveResults,
        selectedBySource: summarizeSourceCounts(tokenBudgeted.chunks),
        fallbackUsed
      },
      results: tokenBudgeted.chunks
    };
  }

  private getActiveProfile(config: Awaited<ReturnType<typeof loadConfig>>) {
    const profile = config.embeddingProfiles.find((item) => item.name === config.activeEmbeddingProfile);
    if (!profile) {
      throw new Error(`Unknown embedding profile "${config.activeEmbeddingProfile}".`);
    }
    return profile;
  }

  private getActiveRerankerProfile(config: Awaited<ReturnType<typeof loadConfig>>): RerankerProfile {
    const profile = config.rerankerProfiles.find((item) => item.name === config.activeRerankerProfile);
    if (!profile) {
      throw new Error(`Unknown reranker profile "${config.activeRerankerProfile}".`);
    }
    return profile;
  }

  private async applyModelRerank(
    chunks: ChunkRecord[],
    query: string,
    options: {
      config: Awaited<ReturnType<typeof loadConfig>>;
      rerankerProfile: RerankerProfile;
      explain: boolean;
      topK: number;
    }
  ): Promise<ChunkRecord[]> {
    const depth = Math.min(chunks.length, Math.max(options.topK, options.config.retrieval.modelRerankDepth));
    if (depth <= 1 || options.config.retrieval.modelRerankWeight <= 0) {
      return chunks;
    }

    const head = chunks.slice(0, depth);
    const tail = chunks.slice(depth);

    try {
      const scores = await this.rerankerService.score(options.rerankerProfile, query, head);
      const rerankedHead = head
        .map((chunk, index) => {
          const modelSignal = Math.max(0, Math.min(1, scores[index] ?? 0));
          const baseScore = chunk.score ?? 0;
          const total =
            baseScore * (1 - options.config.retrieval.modelRerankWeight) +
            modelSignal * options.config.retrieval.modelRerankWeight;

          return {
            ...chunk,
            score: total,
            scoreDetails: options.explain
              ? {
                  ...(chunk.scoreDetails ?? {
                    vector: 0,
                    lexical: 0,
                    sourcePriority: 0,
                    freshness: 0,
                    tierBoost: 0,
                    stabilityBoost: 0,
                    pathBoost: 0,
                    symbolBoost: 0,
                    branchBoost: 0,
                    titleBoost: 0,
                    feedbackBoost: 0,
                    relationBoost: 0,
                    rerankModel: 0,
                    rerank: 0,
                    total: 0
                  }),
                  rerankModel: round4(modelSignal * options.config.retrieval.modelRerankWeight),
                  rerank: round4((chunk.scoreDetails?.rerank ?? 0) + modelSignal * options.config.retrieval.modelRerankWeight),
                  total: round4(total)
                }
              : undefined
          };
        })
        .sort(compareChunks);

      return [...rerankedHead, ...tail];
    } catch {
      return chunks;
    }
  }
}

function buildTaskQuery(
  input: ContextForTaskInput,
  hints?: {
    intentType?: ContextTaskStage;
    symbol?: string;
    branchName?: string;
    relatedFiles?: string[];
    diagnosticFiles?: string[];
    diagnosticSymbols?: string[];
  }
): string {
  const parts = [`task: ${input.task.trim()}`];

  if (hints?.intentType) {
    parts.push(`intent: ${hints.intentType}`);
  }

  if (input.currentFile) {
    parts.push(`current_file: ${path.basename(input.currentFile)}`);
  }

  if (hints?.symbol) {
    parts.push(`current_symbol: ${hints.symbol}`);
  }

  if (input.selectedText?.trim()) {
    parts.push(`selected_text: ${truncate(input.selectedText.trim(), 600)}`);
  }

  if (input.diagnostics?.trim()) {
    parts.push(`diagnostics: ${truncate(input.diagnostics.trim(), 400)}`);
  }

  if (hints?.branchName) {
    parts.push(`branch: ${hints.branchName}`);
  }

  if (hints?.relatedFiles?.length) {
    parts.push(`related_files: ${hints.relatedFiles.map((item) => path.basename(item)).join(", ")}`);
  }

  if (hints?.diagnosticFiles?.length) {
    parts.push(`diagnostic_files: ${hints.diagnosticFiles.map((item) => path.basename(item)).join(", ")}`);
  }

  if (hints?.diagnosticSymbols?.length) {
    parts.push(`diagnostic_symbols: ${hints.diagnosticSymbols.join(", ")}`);
  }

  return parts.join("\n");
}

function buildProjectQueries(input: {
  projectRoot: string;
  query: string;
  budget: number;
  sourceKinds: MemorySourceKind[];
  projectQueryOrder: ProjectQueryFocus[];
  currentFileName?: string;
  relatedFileNames: string[];
  moduleName?: string;
  language?: string;
  symbol?: string;
  branchName?: string;
  minScore: number;
}): RecallInput[] {
  const queries: RecallInput[] = [];
  const addQuery = (query: RecallInput) => {
    if (
      queries.some((existing) =>
        existing.pathContains === query.pathContains &&
        existing.moduleName === query.moduleName &&
        existing.symbol === query.symbol &&
        existing.language === query.language
      )
    ) {
      return;
    }
    queries.push(query);
  };

  for (const focus of input.projectQueryOrder) {
    if (focus === "current_file" && input.currentFileName) {
      addQuery({
        projectRoot: input.projectRoot,
        query: input.query,
        topK: input.budget,
        sourceKinds: input.sourceKinds,
        pathContains: input.currentFileName,
        moduleName: input.moduleName,
        language: input.language,
        symbol: input.symbol,
        branchName: input.branchName,
        relatedPaths: input.relatedFileNames,
        minScore: input.minScore + 0.05,
        explain: true
      });
      continue;
    }

    if (focus === "related_files") {
      for (const fileName of input.relatedFileNames.slice(0, 3)) {
        if (fileName === input.currentFileName) {
          continue;
        }
        addQuery({
          projectRoot: input.projectRoot,
          query: input.query,
          topK: input.budget,
          sourceKinds: input.sourceKinds,
          pathContains: fileName,
          moduleName: input.moduleName,
          language: input.language,
          symbol: input.symbol,
          branchName: input.branchName,
          relatedPaths: input.relatedFileNames,
          minScore: input.minScore,
          explain: true
        });
      }
      continue;
    }

    if (focus === "module" && input.moduleName) {
      addQuery({
        projectRoot: input.projectRoot,
        query: input.query,
        topK: input.budget,
        sourceKinds: input.sourceKinds,
        moduleName: input.moduleName,
        language: input.language,
        symbol: input.symbol,
        branchName: input.branchName,
        relatedPaths: input.relatedFileNames,
        minScore: input.minScore,
        explain: true
      });
      continue;
    }

    if (focus === "broad_project") {
      addQuery({
        projectRoot: input.projectRoot,
        query: input.query,
        topK: input.budget,
        sourceKinds: input.sourceKinds,
        moduleName: input.moduleName,
        language: input.language,
        symbol: input.symbol,
        branchName: input.branchName,
        relatedPaths: input.relatedFileNames,
        minScore: input.minScore,
        explain: true
      });
    }
  }

  return queries;
}

function dedupeChunks(chunks: ChunkRecord[]): ChunkRecord[] {
  const seen = new Set<string>();
  const output: ChunkRecord[] = [];

  for (const chunk of chunks) {
    const key = `${chunk.docId}:${chunk.chunkIndex}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(chunk);
  }

  return output;
}

function compareChunks(a: ChunkRecord, b: ChunkRecord): number {
  const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
  if (Math.abs(scoreDelta) > 0.0001) {
    return scoreDelta;
  }

  const updatedDelta = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return a.chunkIndex - b.chunkIndex;
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}

function topLevelModule(relativePath: string): string | null {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}

function relativeToProject(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function memoryTierBoost(memoryTier?: string | null): number {
  switch (memoryTier) {
    case "stable":
      return 1;
    case "working":
      return 0.55;
    case "project":
      return 0.4;
    case "cold":
      return 0.12;
    default:
      return 0.35;
  }
}

function freshnessBoost(updatedAt: number, timeWindow?: { from?: number; to?: number; inferred: boolean }): number {
  const ageDays = Math.max(0, (Date.now() - updatedAt) / (1000 * 60 * 60 * 24));
  const base = Math.exp(-ageDays / 45);

  if (!timeWindow?.from && !timeWindow?.to) {
    return base;
  }

  if (passesTimeWindow(updatedAt, timeWindow)) {
    return Math.min(1, base + 0.15);
  }

  return base * 0.5;
}

function titleOverlapBoost(query: string, title: string, maxBoost: number): number {
  const queryTokens = tokenize(query);
  const titleTokens = new Set(tokenize(title));
  if (queryTokens.length === 0 || titleTokens.size === 0) {
    return 0;
  }

  const matches = queryTokens.filter((token) => titleTokens.has(token)).length;
  if (matches === 0) {
    return 0;
  }

  return Math.min(maxBoost, (matches / queryTokens.length) * maxBoost);
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function normalizeSymbolName(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .replace(/^.*[.:]/, "")
    .replace(/\(\)$/, "")
    .trim();
  return normalized || null;
}

function relatedPathBoost(candidatePath: string, relatedPaths: string[], boost: number): number {
  if (relatedPaths.length === 0) {
    return 0;
  }

  const normalizedCandidate = candidatePath.toLowerCase().replace(/\\/g, "/");
  const candidateBase = path.basename(candidatePath).toLowerCase();
  for (const rawNeedle of relatedPaths) {
    const normalizedNeedle = rawNeedle.replace(/\\/g, "/");
    const needleBase = path.basename(rawNeedle).toLowerCase();
    if (
      normalizedCandidate.includes(normalizedNeedle) ||
      normalizedCandidate.endsWith(`/${needleBase}`) ||
      candidateBase === needleBase
    ) {
      return boost;
    }
  }

  return 0;
}

function symbolMatchBoost(candidateSymbol: string | null | undefined, requestedSymbol: string | null, boost: number): number {
  if (!candidateSymbol || !requestedSymbol) {
    return 0;
  }

  const normalizedCandidate = normalizeSymbolName(candidateSymbol)?.toLowerCase();
  const normalizedRequested = requestedSymbol.toLowerCase();
  const compactCandidate = normalizedCandidate?.replace(/[^a-z0-9]+/g, "");
  const compactRequested = normalizedRequested.replace(/[^a-z0-9]+/g, "");
  if (!normalizedCandidate || !normalizedRequested || !compactCandidate || !compactRequested) {
    return 0;
  }

  if (normalizedCandidate === normalizedRequested || compactCandidate === compactRequested) {
    return boost;
  }

  if (
    normalizedCandidate.includes(normalizedRequested) ||
    normalizedRequested.includes(normalizedCandidate) ||
    compactCandidate.includes(compactRequested) ||
    compactRequested.includes(compactCandidate)
  ) {
    return boost * 0.5;
  }

  return 0;
}

function relativeOrOriginal(projectRoot: string, targetPath: string): string {
  const relativePath = path.relative(projectRoot, targetPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return targetPath;
  }
  return relativePath.replace(/\\/g, "/");
}

function buildRelationHints(input: {
  moduleName?: string;
  symbol?: string;
  pathContains?: string;
  relatedPaths?: string[];
  branchName?: string;
  language?: string;
  query: string;
}): Array<{
  edgeType: "module" | "symbol" | "path" | "tag" | "branch" | "language";
  targetKey: string;
}> {
  const hints = new Map<string, { edgeType: "module" | "symbol" | "path" | "tag" | "branch" | "language"; targetKey: string }>();
  const add = (edgeType: "module" | "symbol" | "path" | "tag" | "branch" | "language", raw: string | null | undefined) => {
    const targetKey = normalizeRelationKey(raw);
    if (!targetKey) {
      return;
    }
    hints.set(`${edgeType}:${targetKey}`, { edgeType, targetKey });
  };

  add("module", input.moduleName);
  add("symbol", input.symbol);
  add("branch", input.branchName);
  add("language", input.language);
  add("path", input.pathContains);
  add("path", input.pathContains ? path.basename(input.pathContains) : null);

  for (const relatedPath of input.relatedPaths ?? []) {
    add("path", relatedPath);
    add("path", path.basename(relatedPath));
  }

  for (const token of tokenize(input.query).filter((item) => item.length >= 5).slice(0, 8)) {
    add("tag", token);
    add("symbol", token);
  }

  return Array.from(hints.values());
}

function normalizeRelationKey(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^.*[.:]/, "")
    .replace(/\(\)$/, "")
    .toLowerCase();

  return normalized || null;
}

function rerankChunks(
  chunks: ChunkRecord[],
  query: string,
  options: {
    rerankDepth: number;
    rerankWeight: number;
    explain: boolean;
    topK: number;
  }
): ChunkRecord[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  const depth = Math.min(chunks.length, Math.max(options.topK, options.rerankDepth));
  const head = chunks.slice(0, depth);
  const tail = chunks.slice(depth);
  const queryTokens = tokenize(query);
  const exactNeedle = longestInterestingPhrase(query);

  const rerankedHead = head
    .map((chunk, index) => {
      const contentLower = chunk.content.toLowerCase();
      const tagTokens = new Set(chunk.tags.flatMap((tag) => tokenize(tag)));
      const queryCoverage = coverage(queryTokens, tokenize(chunk.content));
      const exactPhrase = exactNeedle && contentLower.includes(exactNeedle.toLowerCase()) ? 1 : 0;
      const tagOverlap =
        queryTokens.length === 0 ? 0 : queryTokens.filter((token) => tagTokens.has(token)).length / queryTokens.length;
      const moduleOverlap = chunk.moduleName && queryTokens.some((token) => chunk.moduleName?.toLowerCase().includes(token)) ? 0.5 : 0;
      const titleOverlap = chunk.title ? coverage(queryTokens, tokenize(chunk.title)) : 0;
      const rankPrior = 1 / (index + 1);
      const rerankSignal =
        exactPhrase * 0.35 +
        queryCoverage * 0.3 +
        tagOverlap * 0.15 +
        moduleOverlap * 0.1 +
        titleOverlap * 0.05 +
        rankPrior * 0.05;

      const baseScore = chunk.score ?? 0;
      const total = baseScore * (1 - options.rerankWeight) + rerankSignal * options.rerankWeight;

      return {
        ...chunk,
        score: total,
        scoreDetails: options.explain
          ? {
              ...(chunk.scoreDetails ?? {
                vector: 0,
                lexical: 0,
                sourcePriority: 0,
                freshness: 0,
                tierBoost: 0,
                stabilityBoost: 0,
                pathBoost: 0,
                symbolBoost: 0,
                branchBoost: 0,
                titleBoost: 0,
                feedbackBoost: 0,
                relationBoost: 0,
                rerankModel: 0,
                rerank: 0,
                total: 0
              }),
              rerank: round4(rerankSignal * options.rerankWeight),
              total: round4(total)
            }
          : undefined
      };
    })
    .sort(compareChunks);

  return [...rerankedHead, ...tail];
}

function rerankTaskContextResults(
  chunks: ChunkRecord[],
  options: {
    currentFileName?: string;
    relatedFileNames: string[];
    symbolCandidates: string[];
    diagnosticFileNames: string[];
    explain: boolean;
  }
): ChunkRecord[] {
  return [...chunks]
    .map((chunk) => {
      const fileName = path.basename(chunk.path).toLowerCase();
      const currentFileBoost = options.currentFileName && fileName === options.currentFileName.toLowerCase() ? 0.12 : 0;
      const relatedFileBoost = options.relatedFileNames.some((item) => fileName === item.toLowerCase()) ? 0.08 : 0;
      const diagnosticFileBoost = options.diagnosticFileNames.some((item) => fileName === item.toLowerCase()) ? 0.1 : 0;
      const diagnosticSymbolBoost = options.symbolCandidates.some((item) => symbolMatchBoost(chunk.symbol, item, 0.12) > 0) ? 0.12 : 0;
      const total = (chunk.score ?? 0) + currentFileBoost + relatedFileBoost + diagnosticFileBoost + diagnosticSymbolBoost;

      return {
        ...chunk,
        score: total,
        scoreDetails: options.explain
          ? {
              ...(chunk.scoreDetails ?? {
                vector: 0,
                lexical: 0,
                sourcePriority: 0,
                freshness: 0,
                tierBoost: 0,
                stabilityBoost: 0,
                pathBoost: 0,
                symbolBoost: 0,
                branchBoost: 0,
                titleBoost: 0,
                feedbackBoost: 0,
                relationBoost: 0,
                rerankModel: 0,
                rerank: 0,
                total: 0
              }),
              pathBoost: round4((chunk.scoreDetails?.pathBoost ?? 0) + currentFileBoost + relatedFileBoost + diagnosticFileBoost),
              symbolBoost: round4((chunk.scoreDetails?.symbolBoost ?? 0) + diagnosticSymbolBoost),
              total: round4(total)
            }
          : undefined
      };
    })
    .sort(compareChunks);
}

function mergeTaskContextResults(
  knowledgeResults: ChunkRecord[],
  projectResults: ChunkRecord[],
  budget: number,
  knowledgeReserve: number
): ChunkRecord[] {
  if (budget <= 0) {
    return [];
  }

  const rankedKnowledge = dedupeChunks(knowledgeResults).sort(compareChunks);
  const rankedProject = dedupeChunks(projectResults).sort(compareChunks);

  if (rankedKnowledge.length === 0 || rankedProject.length === 0) {
    return dedupeChunks([...rankedKnowledge, ...rankedProject]).sort(compareChunks).slice(0, budget);
  }

  const reservedKnowledge = Math.min(rankedKnowledge.length, Math.max(1, Math.min(knowledgeReserve, budget - 1)));
  const reservedProject = Math.min(rankedProject.length, Math.max(1, budget - reservedKnowledge));

  const seeded = dedupeChunks([...rankedKnowledge.slice(0, reservedKnowledge), ...rankedProject.slice(0, reservedProject)]).sort(compareChunks);

  if (seeded.length >= budget) {
    return seeded.slice(0, budget);
  }

  const seededKeys = new Set(seeded.map((chunk) => `${chunk.docId}:${chunk.chunkIndex}`));
  const remainder = dedupeChunks([...rankedKnowledge, ...rankedProject])
    .filter((chunk) => !seededKeys.has(`${chunk.docId}:${chunk.chunkIndex}`))
    .sort(compareChunks);

  return [...seeded, ...remainder].slice(0, budget);
}

function inferTaskStage(input: ContextForTaskInput): ContextTaskStage {
  const haystack = [input.task, input.diagnostics ?? "", input.selectedText ?? ""].join("\n").toLowerCase();

  if (/(error|exception|failing|failure|bug|fix|stack|trace|diagnostic|test fail|crash|typeerror|referenceerror)/i.test(haystack)) {
    return "debug";
  }

  if (/(verify|validate|benchmark|check|assert|test pass|regression|qa)/i.test(haystack)) {
    return "verify";
  }

  if (/(refactor|cleanup|clean up|rename|simplify|reorganize|extract)/i.test(haystack)) {
    return "refactor";
  }

  if (/(document|docs|readme|guide|explain|tutorial|spec)/i.test(haystack)) {
    return "document";
  }

  if (/(implement|build|add|create|wire|support|integrate|ship)/i.test(haystack)) {
    return "implement";
  }

  if (/(explore|investigate|research|understand|inspect|look into|analyze)/i.test(haystack)) {
    return "explore";
  }

  return "general";
}

function resolveTaskStagePolicy(
  taskStage: ContextTaskStage,
  budget: number,
  baseKnowledgeReserve: number,
  baseTokenBudget: number
): {
  knowledgeReserve: number;
  projectReserve: number;
  tokenBudget: number;
  description: string;
} {
  const safeBudget = Math.max(1, budget);
  const maxKnowledge = Math.max(1, safeBudget - 1);
  let knowledgeReserve = Math.min(Math.max(1, baseKnowledgeReserve), maxKnowledge);
  let tokenBudget = Math.max(256, baseTokenBudget);
  let description = "Balanced task-context budget across knowledge and project sources.";

  switch (taskStage) {
    case "debug":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      tokenBudget = Math.round(tokenBudget * 1.15);
      description = "Debug stage: reserve extra room for decisions, diary entries, and manual notes alongside current-file code, with a slightly larger token budget.";
      break;
    case "verify":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      tokenBudget = Math.round(tokenBudget * 1.1);
      description = "Verification stage: keep room for prior decisions and recent implementation context before filling the rest with project code.";
      break;
    case "explore":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      tokenBudget = Math.round(tokenBudget * 1.1);
      description = "Exploration stage: bias slightly toward accumulated project knowledge before saturating with code-local chunks.";
      break;
    case "implement":
      description = "Implementation stage: keep a balanced mix of current code context and high-value project memory.";
      break;
    case "refactor":
      tokenBudget = Math.round(tokenBudget * 0.95);
      description = "Refactor stage: keep a balanced mix while still preserving prior decisions that may constrain structure changes.";
      break;
    case "document":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      tokenBudget = Math.round(tokenBudget * 0.9);
      description = "Documentation stage: favor durable knowledge and decisions, then fill the rest with supporting project snippets.";
      break;
    case "general":
      break;
  }

  const projectReserve = Math.max(1, safeBudget - knowledgeReserve);
  return {
    knowledgeReserve,
    projectReserve,
    tokenBudget,
    description
  };
}

function summarizeSourceCounts(chunks: ChunkRecord[]): Record<MemorySourceKind, number> {
  const counts: Record<MemorySourceKind, number> = {
    manual: 0,
    decision: 0,
    diary: 0,
    project: 0,
    imported: 0
  };

  for (const chunk of chunks) {
    counts[chunk.sourceKind] += 1;
  }

  return counts;
}

function estimateChunkTokens(chunk: ChunkRecord): number {
  const payload = [chunk.title ?? "", chunk.path, chunk.content, chunk.tags.join(" ")].join("\n");
  return Math.max(1, Math.ceil(payload.length / 4) + 24);
}

function applyTaskContextTokenBudget(
  chunks: ChunkRecord[],
  tokenBudget: number
): {
  chunks: ChunkRecord[];
  usedTokens: number;
  omittedCount: number;
} {
  if (chunks.length === 0) {
    return {
      chunks: [],
      usedTokens: 0,
      omittedCount: 0
    };
  }

  const safeBudget = Math.max(64, tokenBudget);
  const selected: ChunkRecord[] = [];
  let usedTokens = 0;
  let omittedCount = 0;

  for (const chunk of chunks) {
    const estimate = estimateChunkTokens(chunk);
    if (selected.length === 0 || usedTokens + estimate <= safeBudget) {
      selected.push(chunk);
      usedTokens += estimate;
      continue;
    }

    omittedCount += 1;
  }

  return {
    chunks: selected,
    usedTokens,
    omittedCount
  };
}

function feedbackAdjustment(input: {
  helpfulVotes: number;
  noisyVotes: number;
  feedbackWeight: number;
  feedbackHalfLifeDays: number;
  staleNoisyBias: number;
  lastFeedbackAt: number | null;
  updatedAt: number;
}): number {
  if (input.helpfulVotes <= 0 && input.noisyVotes <= 0) {
    return 0;
  }

  const feedbackAnchor = input.lastFeedbackAt ?? input.updatedAt;
  const feedbackAgeDays = Math.max(0, (Date.now() - feedbackAnchor) / (1000 * 60 * 60 * 24));
  const contentAgeDays = Math.max(0, (Date.now() - input.updatedAt) / (1000 * 60 * 60 * 24));
  const recencyFactor = Math.exp(-feedbackAgeDays / Math.max(1, input.feedbackHalfLifeDays));
  const stalenessFactor = 1 - Math.exp(-contentAgeDays / 90);

  const helpfulSignal = input.helpfulVotes * 0.75 * (0.6 + recencyFactor * 0.6);
  const noisySignal = input.noisyVotes * 1.1 * (0.65 + recencyFactor * 0.35 + stalenessFactor * input.staleNoisyBias);
  const rawSignal = helpfulSignal - noisySignal;
  const normalized = Math.max(-1, Math.min(1, rawSignal / 3));
  return normalized * input.feedbackWeight;
}

function branchAdjustment(input: {
  requestedBranch: string | null;
  candidateBranch: string | null | undefined;
  exactBoost: number;
  siblingBoost: number;
  crossPenalty: number;
}): number {
  const requested = normalizeBranchName(input.requestedBranch);
  const candidate = normalizeBranchName(input.candidateBranch);
  if (!requested || !candidate) {
    return 0;
  }

  if (requested === candidate) {
    return input.exactBoost;
  }

  if (sameBranchFamily(requested, candidate)) {
    return input.siblingBoost;
  }

  return -input.crossPenalty;
}

function normalizeBranchName(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function sameBranchFamily(left: string, right: string): boolean {
  const leftParts = left.split("/").filter(Boolean);
  const rightParts = right.split("/").filter(Boolean);
  if (leftParts.length === 0 || rightParts.length === 0) {
    return false;
  }

  if (leftParts[0] === rightParts[0]) {
    return true;
  }

  const leftLeaf = leftParts[leftParts.length - 1];
  const rightLeaf = rightParts[rightParts.length - 1];
  return leftLeaf === rightLeaf;
}

function coverage(queryTokens: string[], candidateTokens: string[]): number {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }
  const set = new Set(candidateTokens);
  let hits = 0;
  for (const token of queryTokens) {
    if (set.has(token)) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}

function longestInterestingPhrase(query: string): string | null {
  const phrases = query
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/).length >= 3)
    .sort((a, b) => b.length - a.length);
  return phrases[0] ?? null;
}

function resolveTimeWindow(input: RecallInput): { from?: number; to?: number; inferred: boolean } | undefined {
  if (input.dateFrom || input.dateTo || input.lastDays) {
    return {
      from: input.dateFrom ? Date.parse(input.dateFrom) : input.lastDays ? Date.now() - input.lastDays * 24 * 60 * 60 * 1000 : undefined,
      to: input.dateTo ? Date.parse(input.dateTo) : undefined,
      inferred: false
    };
  }

  const query = input.query.toLowerCase();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (/(\brecent\b|\u6700\u8fd1)/i.test(input.query)) {
    return { from: Date.now() - 14 * 24 * 60 * 60 * 1000, inferred: true };
  }
  if (/(\btoday\b|\u4eca\u5929)/i.test(input.query)) {
    return { from: startOfToday, inferred: true };
  }
  if (/(\byesterday\b|\u6628\u5929)/i.test(input.query)) {
    return { from: startOfToday - 24 * 60 * 60 * 1000, to: startOfToday, inferred: true };
  }
  if (/(\blast week\b|\u4e0a\u5468)/i.test(input.query)) {
    return { from: Date.now() - 7 * 24 * 60 * 60 * 1000, inferred: true };
  }
  if (/(\bthis week\b|\u672c\u5468)/i.test(input.query)) {
    return { from: Date.now() - 6 * 24 * 60 * 60 * 1000, inferred: true };
  }

  const recentDaysMatch = query.match(/(?:\u8fd1|last\s+)(\d+)\s*(?:\u5929|days?)/i);
  if (recentDaysMatch) {
    const days = Number(recentDaysMatch[1]);
    if (Number.isFinite(days) && days > 0) {
      return { from: Date.now() - days * 24 * 60 * 60 * 1000, inferred: true };
    }
  }

  return undefined;
}

function passesTimeWindow(updatedAt: number, timeWindow?: { from?: number; to?: number; inferred: boolean }): boolean {
  if (!timeWindow) {
    return true;
  }
  if (timeWindow.from && updatedAt < timeWindow.from) {
    return false;
  }
  if (timeWindow.to && updatedAt > timeWindow.to) {
    return false;
  }
  return true;
}

async function extractDiagnosticHints(
  projectRoot: string,
  diagnostics?: string
): Promise<{ files: string[]; symbols: string[] }> {
  if (!diagnostics?.trim()) {
    return { files: [], symbols: [] };
  }

  const files = await extractFileMentions(projectRoot, diagnostics);
  const symbols = extractSymbolMentions(diagnostics);
  return { files, symbols };
}

async function extractFileMentions(projectRoot: string, diagnostics: string): Promise<string[]> {
  const filePattern =
    /([A-Za-z]:[\\/][^\s"'():]+?\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|c|cpp|h|hpp|json|ya?ml|toml|sql|sh|ps1|md)|(?:\.{0,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|c|cpp|h|hpp|json|ya?ml|toml|sql|sh|ps1|md))/g;
  const matches = Array.from(diagnostics.matchAll(filePattern), (match) => sanitizeMentionedPath(match[1]));
  const resolved = await Promise.all(matches.map((item) => resolveMentionedPath(projectRoot, item)));
  return dedupeStrings(resolved.filter((item): item is string => Boolean(item)));
}

function extractSymbolMentions(diagnostics: string): string[] {
  const symbols: string[] = [];
  const patterns = [
    /\bat\s+([A-Za-z_][$\w.]*)\s*\(/g,
    /\b(?:function|method|symbol|member)\s+([A-Za-z_][$\w.]*)/gi,
    /\b([A-Za-z_][$\w]*)\s+is not defined\b/gi,
    /\bReferenceError:\s+([A-Za-z_][$\w]*)\b/g
  ];

  for (const pattern of patterns) {
    for (const match of diagnostics.matchAll(pattern)) {
      const symbol = normalizeSymbolName(match[1]);
      if (!symbol || isReservedSymbol(symbol)) {
        continue;
      }
      symbols.push(symbol);
    }
  }

  return dedupeStrings(symbols).slice(0, 5);
}

function sanitizeMentionedPath(rawPath: string): string {
  return rawPath.replace(/[),;'"`]+$/g, "");
}

async function resolveMentionedPath(projectRoot: string, rawPath: string): Promise<string | null> {
  const candidate = rawPath.replace(/\//g, path.sep);
  const absolutePath = path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate);

  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isFile()) {
      return absolutePath;
    }
  } catch {
    return null;
  }

  return null;
}

async function detectGitBranch(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: projectRoot,
      windowsHide: true
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

function isReservedSymbol(name: string): boolean {
  return new Set(["if", "for", "while", "switch", "catch", "return", "async"]).has(name.toLowerCase());
}
