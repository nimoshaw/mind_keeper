import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildResumePrompt, classifyFreshness, readFlashCheckpoint } from "./flash-service.js";
import { DomainRegistry } from "./domain-registry.js";
import { loadConfig } from "../config.js";
import { cosineSimilarity, EmbeddingService, normalize } from "../embedding.js";
import {
  buildTaskIntentPlan,
  buildTaskWaveBudgetProfile,
  buildTaskWavePlan,
  evaluateTaskWaveStop,
  type ProjectQueryFocus,
  type RecallWaveName,
  type RecallWaveResult
} from "../planner.js";
import { resolveActiveEmbeddingProfile } from "../profile-registry.js";
import { ensureProjectScaffold } from "../project.js";
import { RerankerService } from "../reranker.js";
import { detectLanguage as detectIndexedLanguage, inferSymbolName as inferIndexedSymbolName } from "../symbols.js";
import { MindKeeperStorage } from "../storage.js";
import { lexicalScore } from "../text.js";
import type {
  ChunkRecord,
  ContextForTaskInput,
  ContextTaskStage,
  FlashCheckpointRecord,
  MemorySourceKind,
  RecallInput,
  RerankerProfile,
  TaskIntentSubtype
} from "../types.js";

const execFileAsync = promisify(execFile);

export class RecallService {
  private readonly embeddingService = new EmbeddingService();
  private readonly rerankerService = new RerankerService();

  async recall(input: RecallInput): Promise<ChunkRecord[]> {
    const config = await ensureProjectScaffold(input.projectRoot);
    const profile = resolveActiveEmbeddingProfile(config);
    const rerankerProfile = this.getActiveRerankerProfile(config);
    const topK = input.topK ?? config.retrieval.topK;
    const threshold = input.minScore ?? config.retrieval.similarityThreshold;
    const queryEmbedding = normalize(await this.embeddingService.embed(profile, input.query, { projectRoot: input.projectRoot }));
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

      const finalChunks = modelReranked.slice(0, topK);
      return input.explain ? finalChunks.map((chunk) => annotateChunkExplain(chunk)) : finalChunks;
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
      usedFlashGate: boolean;
      symbol: string | null;
      language: string | null;
      branchName: string | null;
      relatedFiles: string[];
      flash: {
        loaded: boolean;
        freshness: "fresh" | "recent" | "stale" | null;
        updatedAt: number | null;
        title: string | null;
        branchName: string | null;
        touchedFiles: string[];
        nextSteps: string[];
        blockers: string[];
        resumePrompt: string | null;
      };
      diagnosticFiles: string[];
      diagnosticSymbols: string[];
      budget: number;
      budgetPolicy: string;
      intentType: ContextTaskStage;
      intentSubtype: TaskIntentSubtype;
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
      waveBudgetProfile: {
        overallBudget: number;
        stableBudget: number;
        localBudget: number;
        recentBudget: number;
        fallbackBudget: number;
        profileName: "documentation-biased" | "exploration-biased" | "balanced";
        intentSubtype: TaskIntentSubtype;
      };
      usedConflictGate: boolean;
      conflictSummary: {
        subjects: string[];
        keptDocIds: string[];
        suppressedDocIds: string[];
        canonicalPreferred: boolean;
      };
      usedMemoryMesh: boolean;
      memoryMesh: {
        seedDocIds: string[];
        expandedDocIds: string[];
        firstHopDocIds: string[];
        secondHopDocIds: string[];
        expansionHits: string[];
        expansionDepth: 0 | 1 | 2;
        usedSecondHop: boolean;
        reason: string;
      };
      knowledgeReserve: number;
      projectReserve: number;
      tokenBudget: number;
      estimatedTokensUsed: number;
      omittedByTokenBudget: number;
      usedTokenBudgetGate: boolean;
      wavePlanType: "light-wave";
      usedAdaptiveDeepWaveGate: boolean;
      deepWaveTriggers: string[];
      explainSummary: {
        whyDeepWaveOpened: string[];
        whyConflictWasSuppressed: string[];
        whyTheseMemories: string[];
        whyNotOthers: string[];
      };
      explainPanel: {
        headline: string;
        highlights: Array<{
          kind: "match" | "priority" | "warning" | "relation" | "rerank";
          title: string;
          detail: string;
        }>;
        suppressions: Array<{
          kind: "match" | "priority" | "warning" | "relation" | "rerank";
          title: string;
          detail: string;
        }>;
        nextActions: string[];
      };
      usedRecentWave: boolean;
      usedFallbackWave: boolean;
      stopReason: string;
      usedConfidenceStop: boolean;
      confidenceStop: {
        waveName: RecallWaveName | null;
        finalScore: number;
        threshold: number;
        coverageScore: number;
        confidenceScore: number;
        redundancyScore: number;
        conflictScore: number;
        reason: string | null;
      };
      wavePlan: RecallWaveResult[];
      selectedBySource: Record<MemorySourceKind, number>;
      fallbackUsed: boolean;
      profileKind: string;
      profileWarning: string | null;
      domainHits: Array<{ name: string; displayName: string; aliases: string[] }>;
    };
    results: ChunkRecord[];
  }> {
    const config = await ensureProjectScaffold(input.projectRoot);
    const budget = input.topK ?? Math.min(6, config.retrieval.topK);
    const minScore = Math.max(config.retrieval.similarityThreshold, 0.25);
    const flashCheckpoint = await readFlashCheckpoint(input.projectRoot);
    const flashAgeHours = flashCheckpoint ? Math.max(0, (Date.now() - flashCheckpoint.updatedAt) / 3_600_000) : null;
    const flashFreshness = flashAgeHours === null ? null : classifyFreshness(flashAgeHours);
    const activeFlash = flashCheckpoint && flashFreshness !== "stale" ? flashCheckpoint : null;
    const flashTouchedFiles = activeFlash?.touchedFiles ?? [];
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
    const relatedFiles = dedupeStrings([...(input.relatedFiles ?? []), ...diagnosticHints.files, ...flashTouchedFiles]);
    const taskStage = inferTaskStage(input);
    const intentSubtype = inferTaskIntentSubtype(input, taskStage);
    const stagePolicy = resolveTaskStagePolicy(
      taskStage,
      intentSubtype,
      budget,
      config.retrieval.taskKnowledgeReserve,
      config.retrieval.taskContextTokenBudget
    );
    const waveBudgetProfile = buildTaskWaveBudgetProfile({
      taskStage,
      intentSubtype,
      budget
    });
    const relatedFileNames = dedupeStrings(relatedFiles.map((item) => path.basename(item)).filter(Boolean));
    const intentPlan = buildTaskIntentPlan({
      taskStage,
      intentSubtype,
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
      intentSubtype,
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
      intentSubtype: intentPlan.intentSubtype,
      symbol,
      branchName,
      relatedFiles,
      diagnosticFiles: diagnosticHints.files,
      diagnosticSymbols: diagnosticHints.symbols,
      flashCheckpoint: activeFlash
    });

    const stableWave = wavePlan[1];
    const rawStableResults = await this.recall({
      projectRoot: input.projectRoot,
      query,
      topK: stableWave.budget,
      sourceKinds: intentPlan.queryPlan.stableSourceKinds,
      relatedPaths: relatedFileNames,
      minScore: stableWave.minScore,
      explain: true
    });
    const conflictGate = applyConflictAwareDecisionGate(rawStableResults);
    const stableResults = conflictGate.filtered;
    waveResults.push({
      ...stableWave,
      used: true,
      resultCount: stableResults.length
    });
    let knowledgeResults = stableResults;
    let recentWaveUsed = false;
    const localWave = wavePlan[2];
    const meshSeedDocIds = selectMeshSeedDocIds(stableResults);
    const meshStorage = new MindKeeperStorage(input.projectRoot);
    let meshCandidates: ChunkRecord[] = [];
    let firstHopDocIds: string[] = [];
    let secondHopDocIds: string[] = [];
    let meshDepth: 0 | 1 | 2 = 0;
    let meshReason = "mesh stayed closed because no strong stable seed was available";
    try {
      const meshMatches = meshStorage.getRelatedDocumentMatches({
        seedDocIds: meshSeedDocIds,
        limit: Math.max(4, localWave.budget),
        allowedEdgeTypes: ["module", "symbol", "tag", "branch"]
      });
      if (meshMatches.size > 0) {
        meshCandidates = meshStorage
          .fetchCandidates({
            sourceKinds: ["manual", "decision", "project"]
          })
          .filter((candidate) => meshMatches.has(candidate.docId))
          .map((candidate) => applyMeshExpansion(candidate, meshMatches.get(candidate.docId), 1))
          .sort(compareChunks)
          .slice(0, Math.max(2, Math.min(localWave.budget, 4)));
        firstHopDocIds = meshCandidates.map((item) => item.docId);
        meshDepth = meshCandidates.length > 0 ? 1 : 0;
        meshReason = meshCandidates.length > 0
          ? "one-hop mesh opened because stable seeds exposed direct related memory"
          : "mesh candidates existed but did not survive ranking";
      }

      const shouldUseSecondHop = shouldUseSecondHopMesh({
        stableResults,
        meshCandidates,
        localWaveBudget: localWave.budget
      });
      if (shouldUseSecondHop) {
        const secondHopMatches = meshStorage.getRelatedDocumentMatches({
          seedDocIds: firstHopDocIds,
          limit: Math.max(3, Math.min(localWave.budget, 6)),
          allowedEdgeTypes: ["module", "symbol", "tag"]
        });
        const excludedDocIds = new Set([...meshSeedDocIds, ...firstHopDocIds]);
        secondHopDocIds = Array.from(secondHopMatches.keys())
          .filter((docId) => !excludedDocIds.has(docId))
          .slice(0, Math.max(2, Math.min(3, localWave.budget - 1)));

        if (secondHopDocIds.length > 0) {
          const secondHopCandidates = meshStorage
            .fetchCandidates({
              sourceKinds: ["manual", "decision", "project"]
            })
            .filter((candidate) => secondHopDocIds.includes(candidate.docId))
            .map((candidate) => applyMeshExpansion(candidate, secondHopMatches.get(candidate.docId), 2))
            .sort(compareChunks)
            .slice(0, Math.max(1, Math.min(2, localWave.budget - 1)));
          if (secondHopCandidates.length > 0) {
            meshCandidates = dedupeChunks([...meshCandidates, ...secondHopCandidates]).sort(compareChunks);
            meshDepth = 2;
            meshReason = "two-hop mesh opened because stable seeds were strong enough to justify one extra relation hop";
          }
        }
      }
    } finally {
      meshStorage.close();
    }
    const meshKnowledge = meshCandidates.filter((item) => item.sourceKind !== "project");
    const meshProject = meshCandidates.filter((item) => item.sourceKind === "project");
    knowledgeResults = dedupeChunks([...knowledgeResults, ...meshKnowledge]).sort(compareChunks);

    const projectQueries = buildProjectQueries({
      projectRoot: input.projectRoot,
      query,
      budget: localWave.budget,
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

    let projectResults: ChunkRecord[] = meshProject;
    let merged = mergeTaskContextResults(knowledgeResults, projectResults, budget, stagePolicy.knowledgeReserve);
    let stopDecision =
      evaluateTaskWaveStop({
        waveName: stableWave.name,
        taskStage,
        budget,
        selectedCount: merged.length,
        stableCount: stableResults.length,
        projectCount: 0,
        recentCount: 0,
        knowledgeReserve: stagePolicy.knowledgeReserve,
        projectReserve: stagePolicy.projectReserve,
        ...summarizeStopMetrics(merged)
      });
    let stopReason = stopDecision.reason ?? "";

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
      stopDecision =
        evaluateTaskWaveStop({
          waveName: localWave.name,
          taskStage,
          budget,
          selectedCount: merged.length,
          stableCount: stableResults.length,
          projectCount: projectResults.length,
          recentCount: 0,
          knowledgeReserve: stagePolicy.knowledgeReserve,
          projectReserve: stagePolicy.projectReserve,
          ...summarizeStopMetrics(merged)
        });
      stopReason = stopDecision.reason ?? "";
    } else {
      waveResults.push({
        ...localWave,
        used: false,
        resultCount: 0
      });
    }

    const recentWave = wavePlan[3];
    const adaptiveDeepWave = determineAdaptiveDeepWave({
      taskStage,
      intentSubtype,
      task: input.task,
      query,
      merged,
      budget,
      stableCount: stableResults.length,
      knowledgeReserve: stagePolicy.knowledgeReserve,
      stopDecision,
      conflictGate
    });
    if (!stopReason) {
      const shouldUseRecentWave = adaptiveDeepWave.shouldUseRecentWave;

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
        stopDecision =
          evaluateTaskWaveStop({
            waveName: recentWave.name,
            taskStage,
            budget,
            selectedCount: merged.length,
            stableCount: stableResults.length,
            projectCount: projectResults.length,
            recentCount: recentResults.length,
            knowledgeReserve: stagePolicy.knowledgeReserve,
            projectReserve: stagePolicy.projectReserve,
            ...summarizeStopMetrics(merged)
          });
        stopReason = stopDecision.reason ?? "";
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
    const fallbackTriggers = determineAdaptiveFallbackTriggers({
      task: input.task,
      query,
      mergedCount: merged.length,
      stableCount: stableResults.length,
      stopDecision,
      usedRecentWave: recentWaveUsed
    });

    if (fallbackTriggers.length > 0) {
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
      stopReason = fallbackTriggers[0] === "empty_context" ? "fallback_wave_used" : `adaptive_fallback:${fallbackTriggers[0]}`;
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
    const explainedChunks = tokenBudgeted.chunks.map((chunk) => annotateChunkExplain(chunk));
    const explainSummary = buildTaskExplainSummary({
      selectedChunks: explainedChunks,
      adaptiveDeepWave,
      recentWaveUsed,
      fallbackUsed,
      conflictGate,
      omittedByTokenBudget: tokenBudgeted.omittedCount,
      stopReason
    });
    const explainPanel = buildTaskExplainPanel({
      selectedChunks: explainedChunks,
      explainSummary,
      conflictGate,
      adaptiveDeepWave,
      recentWaveUsed,
      fallbackUsed,
      stopReason
    });
    if (activeFlash) {
      explainPanel.highlights.unshift({
        kind: "priority",
        title: "Flash resume context loaded",
        detail: `Resuming from ${activeFlash.title} with ${activeFlash.nextSteps.length} next steps.`
      });
      if (activeFlash.blockers.length > 0) {
        explainPanel.nextActions.unshift(`Resolve flash blocker: ${activeFlash.blockers[0]}`);
      }
    }

    // ── Domain awareness & profile observability ──────────────────
    const profileKind = config.activeEmbeddingProfile;
    const isHashProfile = config.embeddingProfiles.find(
      (p) => p.name === config.activeEmbeddingProfile
    )?.kind === "hash";
    const profileWarning = isHashProfile
      ? "Using hash-based embedding. Configure a real embedding model (e.g. qwen3-8b or embedding-001) for better recall quality."
      : null;

    let domainHits: Array<{ name: string; displayName: string; aliases: string[] }> = [];
    try {
      const domainRegistry = new DomainRegistry(input.projectRoot);
      const allDomains = await domainRegistry.listDomains();
      if (allDomains.length > 0) {
        const taskLower = input.task.toLowerCase();
        domainHits = allDomains.filter((d) =>
          d.name.toLowerCase() === taskLower ||
          d.displayName.toLowerCase().includes(taskLower) ||
          taskLower.includes(d.displayName.toLowerCase()) ||
          d.aliases.some((a) => taskLower.includes(a.toLowerCase()))
        ).map((d) => ({ name: d.name, displayName: d.displayName, aliases: d.aliases }));

        for (const hit of domainHits) {
          explainPanel.highlights.push({
            kind: "match",
            title: `Domain knowledge matched: ${hit.displayName}`,
            detail: `Task matched domain "${hit.name}" (aliases: ${hit.aliases.join(", ") || "none"}).`
          });
        }
      }
    } catch {
      // Domain detection is best-effort and should never block recall.
    }

    if (profileWarning) {
      explainPanel.highlights.push({
        kind: "warning",
        title: "Weak embedding profile active",
        detail: profileWarning
      });
    }

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
        usedFlashGate: Boolean(activeFlash),
        intentType: intentPlan.intentType,
        intentSubtype: intentPlan.intentSubtype,
        intentAnchors: intentPlan.anchors,
        queryPlan: intentPlan.queryPlan,
        waveBudgetProfile,
        usedConflictGate: conflictGate.used,
        conflictSummary: {
          subjects: conflictGate.subjects,
          keptDocIds: conflictGate.keptDocIds,
          suppressedDocIds: conflictGate.suppressedDocIds,
          canonicalPreferred: conflictGate.canonicalPreferred
        },
        usedMemoryMesh: meshCandidates.length > 0,
        memoryMesh: {
          seedDocIds: meshSeedDocIds,
          expandedDocIds: Array.from(new Set(meshCandidates.map((item) => item.docId))),
          firstHopDocIds,
          secondHopDocIds,
          expansionHits: Array.from(new Set(meshCandidates.flatMap((item) => item.relationHits ?? []))).slice(0, 12),
          expansionDepth: meshDepth,
          usedSecondHop: secondHopDocIds.length > 0,
          reason: meshReason
        },
        symbol: symbol ?? null,
        language: language ?? null,
        branchName: branchName ?? null,
        relatedFiles: relatedFiles.map((item) => relativeOrOriginal(input.projectRoot, item)),
        flash: {
          loaded: Boolean(flashCheckpoint),
          freshness: flashFreshness,
          updatedAt: flashCheckpoint?.updatedAt ?? null,
          title: flashCheckpoint?.title ?? null,
          branchName: flashCheckpoint?.branchName ?? null,
          touchedFiles: flashTouchedFiles.map((item) => relativeOrOriginal(input.projectRoot, item)),
          nextSteps: flashCheckpoint?.nextSteps ?? [],
          blockers: flashCheckpoint?.blockers ?? [],
          resumePrompt: flashCheckpoint ? buildResumePrompt(flashCheckpoint, flashFreshness ?? "recent") : null
        },
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
        usedAdaptiveDeepWaveGate: adaptiveDeepWave.triggers.length > 0,
        deepWaveTriggers: adaptiveDeepWave.triggers,
        explainSummary,
        explainPanel,
        usedRecentWave: recentWaveUsed,
        usedFallbackWave: fallbackUsed,
        stopReason: stopReason || "token_budget_applied_after_light_wave",
        usedConfidenceStop: Boolean(stopDecision.reason?.startsWith("confidence_stop_")),
        confidenceStop: {
          waveName: stopDecision.reason ? stopDecision.waveName : null,
          finalScore: stopDecision.finalScore,
          threshold: stopDecision.threshold,
          coverageScore: stopDecision.coverageScore,
          confidenceScore: stopDecision.confidenceScore,
          redundancyScore: stopDecision.redundancyScore,
          conflictScore: stopDecision.conflictScore,
          reason: stopDecision.reason
        },
        wavePlan: waveResults,
        selectedBySource: summarizeSourceCounts(explainedChunks),
        fallbackUsed,
        profileKind,
        profileWarning,
        domainHits
      },
      results: explainedChunks
    };
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
    intentSubtype?: TaskIntentSubtype;
    symbol?: string;
    branchName?: string;
    relatedFiles?: string[];
    diagnosticFiles?: string[];
    diagnosticSymbols?: string[];
    flashCheckpoint?: FlashCheckpointRecord | null;
  }
): string {
  const parts = [`task: ${input.task.trim()}`];

  if (hints?.intentType) {
    parts.push(`intent: ${hints.intentType}`);
  }

  if (hints?.intentSubtype && hints.intentSubtype !== "general") {
    parts.push(`intent_subtype: ${hints.intentSubtype}`);
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

  if (hints?.flashCheckpoint) {
    parts.push(`flash_goal: ${truncate(hints.flashCheckpoint.sessionGoal, 240)}`);
    parts.push(`flash_status: ${truncate(hints.flashCheckpoint.currentStatus, 240)}`);

    if (hints.flashCheckpoint.workingMemory) {
      parts.push(`flash_memory: ${truncate(hints.flashCheckpoint.workingMemory, 280)}`);
    }

    if (hints.flashCheckpoint.nextSteps.length) {
      parts.push(`flash_next_steps: ${hints.flashCheckpoint.nextSteps.slice(0, 4).join(" | ")}`);
    }

    if (hints.flashCheckpoint.blockers.length) {
      parts.push(`flash_blockers: ${hints.flashCheckpoint.blockers.slice(0, 3).join(" | ")}`);
    }
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

function summarizeStopMetrics(chunks: ChunkRecord[]): {
  uniqueDocCount: number;
  topScore: number;
  averageScore: number;
  decisionCount: number;
} {
  if (chunks.length === 0) {
    return {
      uniqueDocCount: 0,
      topScore: 0,
      averageScore: 0,
      decisionCount: 0
    };
  }

  const uniqueDocCount = new Set(chunks.map((chunk) => chunk.docId)).size;
  const totalScore = chunks.reduce((sum, chunk) => sum + (chunk.score ?? 0), 0);
  const decisionCount = new Set(
    chunks
      .filter((chunk) => chunk.sourceKind === "decision")
      .map((chunk) => chunk.docId)
  ).size;

  return {
    uniqueDocCount,
    topScore: chunks[0]?.score ?? 0,
    averageScore: totalScore / chunks.length,
    decisionCount
  };
}

function selectMeshSeedDocIds(chunks: ChunkRecord[]): string[] {
  const ranked = dedupeChunks(chunks);
  const decisions = ranked.filter((chunk) => chunk.sourceKind === "decision").map((chunk) => chunk.docId);
  if (decisions.length > 0) {
    return decisions.slice(0, 2);
  }

  return ranked.slice(0, 1).map((chunk) => chunk.docId);
}

function applyConflictAwareDecisionGate(chunks: ChunkRecord[]): {
  filtered: ChunkRecord[];
  used: boolean;
  subjects: string[];
  keptDocIds: string[];
  suppressedDocIds: string[];
  canonicalPreferred: boolean;
} {
  const decisions = dedupeChunks(chunks).filter((chunk) => chunk.sourceKind === "decision");
  if (decisions.length < 2) {
    return {
      filtered: chunks,
      used: false,
      subjects: [],
      keptDocIds: [],
      suppressedDocIds: [],
      canonicalPreferred: false
    };
  }

  const claimsByDoc = new Map<string, Array<{ subject: string; polarity: "positive" | "negative" }>>();
  for (const decision of decisions) {
    claimsByDoc.set(decision.docId, extractDecisionClaims(`${decision.title ?? ""}\n${decision.content}`));
  }

  const subjectToDocs = new Map<string, { positive: Set<string>; negative: Set<string> }>();
  for (const decision of decisions) {
    for (const claim of claimsByDoc.get(decision.docId) ?? []) {
      const current = subjectToDocs.get(claim.subject) ?? { positive: new Set<string>(), negative: new Set<string>() };
      current[claim.polarity].add(decision.docId);
      subjectToDocs.set(claim.subject, current);
    }
  }

  const conflictSubjects = Array.from(subjectToDocs.entries())
    .filter(([, bucket]) => bucket.positive.size > 0 && bucket.negative.size > 0)
    .map(([subject]) => subject);

  if (conflictSubjects.length === 0) {
    return {
      filtered: chunks,
      used: false,
      subjects: [],
      keptDocIds: [],
      suppressedDocIds: [],
      canonicalPreferred: false
    };
  }

  const conflictingDocIds = new Set<string>();
  for (const subject of conflictSubjects) {
    const bucket = subjectToDocs.get(subject);
    bucket?.positive.forEach((docId) => conflictingDocIds.add(docId));
    bucket?.negative.forEach((docId) => conflictingDocIds.add(docId));
  }

  const conflictingChunks = decisions.filter((chunk) => conflictingDocIds.has(chunk.docId));
  const canonicalDocs = decisions.filter((chunk) =>
    isCanonicalConflictDecision(chunk) && mentionsConflictSubject(chunk, conflictSubjects)
  );
  const keptDocIds = canonicalDocs.length > 0
    ? canonicalDocs.map((chunk) => chunk.docId)
    : [conflictingChunks.sort(compareChunks)[0]?.docId].filter((value): value is string => Boolean(value));
  const keptDocSet = new Set(keptDocIds);
  const suppressedDocIds = Array.from(conflictingDocIds).filter((docId) => !keptDocSet.has(docId));
  const suppressedDocSet = new Set(suppressedDocIds);

  return {
    filtered: chunks.filter((chunk) => !suppressedDocSet.has(chunk.docId)),
    used: suppressedDocIds.length > 0,
    subjects: conflictSubjects,
    keptDocIds,
    suppressedDocIds,
    canonicalPreferred: canonicalDocs.length > 0
  };
}

function applyMeshExpansion(
  chunk: ChunkRecord,
  meshMatch?: { score: number; hits: string[] },
  hop: 1 | 2 = 1
): ChunkRecord {
  if (!meshMatch) {
    return chunk;
  }

  const meshBoost = hop === 1
    ? Math.min(0.18, meshMatch.score * 0.08)
    : Math.min(0.11, meshMatch.score * 0.045);
  const total = (chunk.score ?? 0) + meshBoost;
  const hitPrefix = hop === 1 ? "mesh" : "mesh2";

  return {
    ...chunk,
    score: total,
    relationHits: Array.from(new Set([...(chunk.relationHits ?? []), ...meshMatch.hits.map((hit) => `${hitPrefix}:${hit}`)])),
    scoreDetails: chunk.scoreDetails
      ? {
          ...chunk.scoreDetails,
          relationBoost: round4((chunk.scoreDetails.relationBoost ?? 0) + meshBoost),
          total: round4(total)
        }
      : undefined
  };
}

function shouldUseSecondHopMesh(input: {
  stableResults: ChunkRecord[];
  meshCandidates: ChunkRecord[];
  localWaveBudget: number;
}): boolean {
  if (input.meshCandidates.length === 0 || input.localWaveBudget < 4) {
    return false;
  }

  const topStableScore = input.stableResults[0]?.score ?? 0;
  const stableDecisionCount = input.stableResults.filter((item) => item.sourceKind === "decision").length;
  return topStableScore >= 0.55 || (topStableScore >= 0.46 && stableDecisionCount >= 1);
}

function extractDecisionClaims(text: string): Array<{ subject: string; polarity: "positive" | "negative" }> {
  const normalized = text.toLowerCase();
  const patterns: Array<{ regex: RegExp; polarity: "positive" | "negative" }> = [
    { regex: /\b(?:prefer|use|choose|adopt|enable|default to|standardize on)\s+([a-z0-9_/-]+)/g, polarity: "positive" },
    { regex: /\b(?:avoid|disable|deprecate|reject|do not use|don't use|never use|not use)\s+([a-z0-9_/-]+)/g, polarity: "negative" }
  ];
  const claims = new Map<string, { subject: string; polarity: "positive" | "negative" }>();

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern.regex)) {
      const subject = normalizeConflictSubject(match[1]);
      if (!subject) {
        continue;
      }
      claims.set(`${pattern.polarity}:${subject}`, {
        subject,
        polarity: pattern.polarity
      });
    }
  }

  return Array.from(claims.values());
}

function normalizeConflictSubject(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/[^\w/-]+/g, "")
    .toLowerCase();
  return normalized || null;
}

function isCanonicalConflictDecision(chunk: ChunkRecord): boolean {
  const blob = `${chunk.title ?? ""}\n${chunk.content}`.toLowerCase();
  return blob.includes("canonical") && blob.includes("conflict-resolution");
}

function mentionsConflictSubject(chunk: ChunkRecord, subjects: string[]): boolean {
  if (subjects.length === 0) {
    return false;
  }

  const blob = `${chunk.title ?? ""}\n${chunk.content}\n${chunk.tags.join(" ")}`.toLowerCase();
  return subjects.some((subject) => blob.includes(subject));
}

function determineAdaptiveDeepWave(input: {
  taskStage: ContextTaskStage;
  intentSubtype: TaskIntentSubtype;
  task: string;
  query: string;
  merged: ChunkRecord[];
  budget: number;
  stableCount: number;
  knowledgeReserve: number;
  stopDecision: {
    finalScore: number;
    threshold: number;
  };
  conflictGate: {
    used: boolean;
    canonicalPreferred: boolean;
  };
}): {
  shouldUseRecentWave: boolean;
  triggers: string[];
} {
  const triggers: string[] = [];

  if (input.taskStage === "debug" || input.taskStage === "verify" || input.taskStage === "explore") {
    triggers.push("required_for_task_stage");
  }
  if (
    input.intentSubtype === "bug_root_cause" ||
    input.intentSubtype === "migration" ||
    input.intentSubtype === "architecture_review"
  ) {
    triggers.push("required_for_intent_subtype");
  }
  if (input.merged.length < input.budget) {
    triggers.push("budget_gap");
  }
  if (input.stableCount < input.knowledgeReserve) {
    triggers.push("stable_gap");
  }
  if (containsHistoryHint(`${input.task}\n${input.query}`)) {
    triggers.push("history_hint");
  }
  if (input.stopDecision.finalScore > 0 && input.stopDecision.finalScore < input.stopDecision.threshold) {
    triggers.push("low_confidence");
  }
  if (input.conflictGate.used && !input.conflictGate.canonicalPreferred) {
    triggers.push("unresolved_conflict");
  }

  return {
    shouldUseRecentWave: triggers.length > 0,
    triggers: dedupeStrings(triggers)
  };
}

function determineAdaptiveFallbackTriggers(input: {
  task: string;
  query: string;
  mergedCount: number;
  stableCount: number;
  stopDecision: {
    finalScore: number;
    threshold: number;
  };
  usedRecentWave: boolean;
}): string[] {
  const triggers: string[] = [];

  if (input.mergedCount === 0) {
    triggers.push("empty_context");
  }
  if (containsHistoryHint(`${input.task}\n${input.query}`) && !input.usedRecentWave && input.stableCount === 0) {
    triggers.push("history_without_recent_hits");
  }
  if (input.mergedCount <= 1 && input.stopDecision.finalScore > 0 && input.stopDecision.finalScore < input.stopDecision.threshold * 0.65) {
    triggers.push("very_low_confidence");
  }

  return dedupeStrings(triggers);
}

function containsHistoryHint(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "history",
    "historical",
    "legacy",
    "previous",
    "earlier",
    "prior",
    "before",
    "以前",
    "之前",
    "历史",
    "过往"
  ].some((hint) => normalized.includes(hint));
}

function annotateChunkExplain(chunk: ChunkRecord): ChunkRecord {
  if (!chunk.scoreDetails) {
    return chunk;
  }

  const reasons: string[] = [];
  const cards: Array<{
    kind: "match" | "priority" | "warning" | "relation" | "rerank";
    title: string;
    detail: string;
  }> = [];
  if ((chunk.scoreDetails.vector ?? 0) >= 0.2) {
    reasons.push("high semantic similarity");
    cards.push({
      kind: "match",
      title: "Semantic match",
      detail: "This memory is semantically close to the current task or question."
    });
  }
  if ((chunk.scoreDetails.lexical ?? 0) >= 0.08) {
    reasons.push("strong keyword overlap");
    cards.push({
      kind: "match",
      title: "Keyword overlap",
      detail: "Important task words or symbols also appear directly in this memory."
    });
  }
  if ((chunk.scoreDetails.tierBoost ?? 0) > 0.18 || (chunk.scoreDetails.stabilityBoost ?? 0) > 0.12) {
    reasons.push("stable memory priority");
    cards.push({
      kind: "priority",
      title: "Stable memory",
      detail: "This entry was boosted because it looks like durable project knowledge."
    });
  }
  if ((chunk.scoreDetails.pathBoost ?? 0) > 0.08) {
    reasons.push("current or related file match");
    cards.push({
      kind: "match",
      title: "File-local context",
      detail: "This memory lines up with the current file or nearby related files."
    });
  }
  if ((chunk.scoreDetails.symbolBoost ?? 0) > 0.08) {
    reasons.push("symbol-aware match");
    cards.push({
      kind: "match",
      title: "Symbol-aware match",
      detail: "The current symbol or a diagnostic symbol helped pull this memory upward."
    });
  }
  if ((chunk.scoreDetails.branchBoost ?? 0) > 0.04) {
    reasons.push("current branch preference");
    cards.push({
      kind: "priority",
      title: "Branch preference",
      detail: "This result received a boost because it fits the current branch view."
    });
  }
  if ((chunk.scoreDetails.feedbackBoost ?? 0) > 0.04) {
    reasons.push("helpful feedback history");
    cards.push({
      kind: "priority",
      title: "Helpful feedback",
      detail: "Past feedback says this memory has been useful in similar situations."
    });
  }
  if ((chunk.scoreDetails.feedbackBoost ?? 0) < -0.04) {
    reasons.push("noisy feedback penalty");
    cards.push({
      kind: "warning",
      title: "Noisy history",
      detail: "This memory carries noisy feedback and is being held back in ranking."
    });
  }
  if ((chunk.scoreDetails.relationBoost ?? 0) > 0.04 || (chunk.relationHits?.length ?? 0) > 0) {
    reasons.push("memory graph relation hit");
    cards.push({
      kind: "relation",
      title: "Memory graph link",
      detail: "Related files, symbols, tags, or decisions pulled this memory closer to the task."
    });
  }
  if ((chunk.scoreDetails.rerank ?? 0) > 0.03 || (chunk.scoreDetails.rerankModel ?? 0) > 0.03) {
    reasons.push("rerank reinforcement");
    cards.push({
      kind: "rerank",
      title: "Rerank reinforcement",
      detail: "A later rerank step confirmed this result should stay near the top."
    });
  }

  return {
    ...chunk,
    explainReasons: reasons.slice(0, 4),
    explainCards: cards.slice(0, 4)
  };
}

function buildTaskExplainSummary(input: {
  selectedChunks: ChunkRecord[];
  adaptiveDeepWave: {
    triggers: string[];
  };
  recentWaveUsed: boolean;
  fallbackUsed: boolean;
  conflictGate: {
    used: boolean;
    subjects: string[];
    keptDocIds: string[];
    suppressedDocIds: string[];
    canonicalPreferred: boolean;
  };
  omittedByTokenBudget: number;
  stopReason: string;
}): {
  whyDeepWaveOpened: string[];
  whyConflictWasSuppressed: string[];
  whyTheseMemories: string[];
  whyNotOthers: string[];
} {
  const whyDeepWaveOpened = input.recentWaveUsed
    ? input.adaptiveDeepWave.triggers.map(describeDeepWaveTrigger)
    : input.adaptiveDeepWave.triggers.length > 0
      ? ["deep wave stayed closed because earlier waves already covered the task"]
      : ["deep wave stayed closed because no history or low-confidence trigger fired"];

  const whyConflictWasSuppressed = input.conflictGate.used
    ? [
        `${input.conflictGate.subjects.join(", ")} had competing decisions`,
        input.conflictGate.canonicalPreferred
          ? "a canonical conflict-resolution decision was preferred"
          : "the highest-ranked decision was kept and competing variants were suppressed"
      ]
    : ["no competing stable decision needed suppression"];

  const whyTheseMemories = input.selectedChunks.slice(0, 3).map((chunk) => {
    const label = chunk.title ?? path.basename(chunk.path);
    const reasons = chunk.explainReasons?.length ? chunk.explainReasons.join(", ") : "score and stage gating";
    return `${label}: ${reasons}`;
  });

  const whyNotOthers: string[] = [];
  if (input.omittedByTokenBudget > 0) {
    whyNotOthers.push(`${input.omittedByTokenBudget} lower-priority chunks were dropped by the token budget`);
  }
  if (input.conflictGate.suppressedDocIds.length > 0) {
    whyNotOthers.push(`${input.conflictGate.suppressedDocIds.length} conflicting decision docs were suppressed`);
  }
  if (!input.fallbackUsed) {
    whyNotOthers.push(`fallback stayed closed because ${describeStopReason(input.stopReason)}`);
  }
  if (whyNotOthers.length === 0) {
    whyNotOthers.push("no additional suppression happened beyond normal ranking");
  }

  return {
    whyDeepWaveOpened,
    whyConflictWasSuppressed,
    whyTheseMemories,
    whyNotOthers
  };
}

function buildTaskExplainPanel(input: {
  selectedChunks: ChunkRecord[];
  explainSummary: {
    whyDeepWaveOpened: string[];
    whyConflictWasSuppressed: string[];
    whyTheseMemories: string[];
    whyNotOthers: string[];
  };
  conflictGate: {
    used: boolean;
    subjects: string[];
    canonicalPreferred: boolean;
  };
  adaptiveDeepWave: {
    triggers: string[];
  };
  recentWaveUsed: boolean;
  fallbackUsed: boolean;
  stopReason: string;
}): {
  headline: string;
  highlights: Array<{
    kind: "match" | "priority" | "warning" | "relation" | "rerank";
    title: string;
    detail: string;
  }>;
  suppressions: Array<{
    kind: "match" | "priority" | "warning" | "relation" | "rerank";
    title: string;
    detail: string;
  }>;
  nextActions: string[];
} {
  const topChunk = input.selectedChunks[0];
  const headline = topChunk
    ? `Top context came from ${topChunk.title ?? path.basename(topChunk.path)} because it best matched the task and gates.`
    : "No strong context was selected for this task.";

  const highlights = [
    ...(input.recentWaveUsed
      ? [{
          kind: "priority" as const,
          title: "History wave opened",
          detail: input.explainSummary.whyDeepWaveOpened[0] ?? "Historical context was pulled in for this task."
        }]
      : []),
    ...input.selectedChunks.flatMap((chunk) => chunk.explainCards ?? [])
  ].slice(0, 5);

  const suppressions = [
    ...(input.conflictGate.used
      ? [{
          kind: "warning" as const,
          title: input.conflictGate.canonicalPreferred ? "Conflict suppressed by canonical policy" : "Conflict suppressed by ranking gate",
          detail: input.explainSummary.whyConflictWasSuppressed.join("; ")
        }]
      : []),
    ...input.explainSummary.whyNotOthers.map((detail) => ({
      kind: "warning" as const,
      title: "Suppression",
      detail
    }))
  ].slice(0, 4);

  const nextActions: string[] = [];
  if (input.conflictGate.used) {
    nextActions.push("Review the active conflict cluster if the canonical policy still looks uncertain.");
  }
  if (input.adaptiveDeepWave.triggers.includes("history_hint") && !input.recentWaveUsed) {
    nextActions.push("Try recall_deep if you still need older historical context.");
  }
  if (!input.fallbackUsed && input.stopReason.startsWith("confidence_stop_")) {
    nextActions.push("If this context still feels thin, force a deeper lookup with recall_deep.");
  }

  return {
    headline,
    highlights,
    suppressions,
    nextActions: dedupeStrings(nextActions).slice(0, 3)
  };
}

function describeDeepWaveTrigger(trigger: string): string {
  switch (trigger) {
    case "required_for_task_stage":
      return "deep wave opened because this task stage expects more historical context";
    case "required_for_intent_subtype":
      return "deep wave opened because this intent subtype benefits from historical notes";
    case "budget_gap":
      return "deep wave opened because earlier waves did not fill the requested context budget";
    case "stable_gap":
      return "deep wave opened because stable memory coverage was still thin";
    case "history_hint":
      return "deep wave opened because the task explicitly asked for previous or historical context";
    case "low_confidence":
      return "deep wave opened because the earlier wave confidence stayed below the stop threshold";
    case "unresolved_conflict":
      return "deep wave opened because competing decisions remained unresolved";
    default:
      return `deep wave opened because of ${trigger}`;
  }
}

function describeStopReason(reason: string): string {
  if (reason.startsWith("confidence_stop_")) {
    return "confidence stop judged the current context strong enough";
  }
  if (reason === "budget_satisfied_after_local_project") {
    return "local project and stable memory already filled the context budget";
  }
  if (reason === "stable_memory_satisfied_document_stage") {
    return "stable memory already covered the documentation task";
  }
  if (reason === "fallback_wave_used") {
    return "fallback already ran";
  }
  return reason.replace(/_/g, " ");
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

function inferTaskIntentSubtype(input: ContextForTaskInput, taskStage: ContextTaskStage): TaskIntentSubtype {
  const haystack = [input.task, input.diagnostics ?? "", input.selectedText ?? ""].join("\n").toLowerCase();

  if (/(migration|migrate|upgrade|downgrade|backfill|port|move from|switch from|rollout|deprecate)/i.test(haystack)) {
    return "migration";
  }

  if (/(api|endpoint|contract|schema|interface|sdk|payload|request|response|graphql|rest)/i.test(haystack)) {
    return "api_change";
  }

  if (/(test|spec|assert|fixture|snapshot|flaky|unit test|integration test|e2e)/i.test(haystack) && /(fix|repair|restore|stabilize|failing|failure|broken)/i.test(haystack)) {
    return "test_repair";
  }

  if (taskStage === "document") {
    if (/(architecture|design|policy|decision|system|adr|structure|topology)/i.test(haystack)) {
      return "architecture_review";
    }
    return "docs_update";
  }

  if (taskStage === "refactor") {
    return "refactor_safety";
  }

  if (taskStage === "debug") {
    if (/(root cause|why|investigate|trace|reproduce|repro|isolate|understand|look into)/i.test(haystack)) {
      return "bug_root_cause";
    }
    if (/(test|spec|assert|fixture|snapshot|flaky)/i.test(haystack)) {
      return "test_repair";
    }
    return "bug_fix";
  }

  return "general";
}

function resolveTaskStagePolicy(
  taskStage: ContextTaskStage,
  intentSubtype: TaskIntentSubtype,
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

  switch (intentSubtype) {
    case "bug_root_cause":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      tokenBudget = Math.round(tokenBudget * 1.08);
      description = `${description} Root-cause analysis keeps extra room for diagnostic and historical memory.`;
      break;
    case "migration":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      tokenBudget = Math.round(tokenBudget * 1.05);
      description = `${description} Migration tasks bias toward durable policy and imported guidance before widening project context.`;
      break;
    case "api_change":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      description = `${description} API changes preserve contract and decision memory so interface drift stays visible.`;
      break;
    case "test_repair":
      tokenBudget = Math.round(tokenBudget * 1.04);
      description = `${description} Test repair work keeps nearby implementation context warm while still surfacing prior failure notes.`;
      break;
    case "refactor_safety":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      tokenBudget = Math.round(tokenBudget * 0.97);
      description = `${description} Refactor-safety mode keeps structural constraints and prior decisions visible while staying concise.`;
      break;
    case "docs_update":
      tokenBudget = Math.round(tokenBudget * 0.94);
      description = `${description} Docs updates stay concise and favor stable guidance over broad history.`;
      break;
    case "architecture_review":
      knowledgeReserve = Math.min(maxKnowledge, knowledgeReserve + 1);
      tokenBudget = Math.round(tokenBudget * 1.02);
      description = `${description} Architecture review keeps more stable and historical decision context available.`;
      break;
    default:
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
    imported: 0,
    log: 0
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
