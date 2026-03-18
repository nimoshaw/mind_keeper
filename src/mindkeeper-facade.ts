import { HygieneService } from "./app/hygiene-service.js";
import { inspectMemoryAccessSurface } from "./access-surface.js";
import { CanonicalService } from "./app/canonical-service.js";
import { FlashService } from "./app/flash-service.js";
import { MemoryWriteService } from "./app/memory-write-service.js";
import { ProfileOpsService } from "./app/profile-ops-service.js";
import { ProjectIndexService } from "./app/project-index-service.js";
import { RecallService } from "./app/recall-service.js";
import { SessionService } from "./app/session-service.js";
import { SourceService } from "./app/source-service.js";
import { EmbeddingService } from "./embedding.js";
import { repairProfileRegistry, validateActiveProfileIndex } from "./profile-registry.js";
import { ensureProjectScaffold } from "./project.js";
import type {
  ContextForTaskInput,
  ForgetInput,
  IndexProjectResult,
  RateSourceInput,
  RecallInput,
  SuggestSessionMemoryInput,
  SummarizeSessionInput,
  ToggleSourceInput
} from "./types.js";

export class MindKeeperService {
  private readonly embeddingService = new EmbeddingService();
  private readonly canonicalService = new CanonicalService();
  private readonly flashService = new FlashService();
  private readonly projectIndexService = new ProjectIndexService(this.embeddingService);
  private readonly profileOpsService = new ProfileOpsService(this.projectIndexService);
  private readonly memoryWriteService = new MemoryWriteService(this.projectIndexService);
  private readonly recallService = new RecallService();
  private readonly sessionService = new SessionService({
    remember: (input) => this.memoryWriteService.remember(input),
    rememberDecision: (input) => this.memoryWriteService.rememberDecision(input)
  });
  private readonly sourceService = new SourceService();
  private readonly hygieneService = new HygieneService({
    remember: (input) => this.memoryWriteService.remember(input),
    rememberDecision: (input) => this.memoryWriteService.rememberDecision(input)
  });

  async remember(input: Parameters<MemoryWriteService["remember"]>[0]) {
    return this.memoryWriteService.remember(input);
  }

  async rememberDecision(input: Parameters<MemoryWriteService["rememberDecision"]>[0]) {
    return this.memoryWriteService.rememberDecision(input);
  }

  async summarizeSession(input: SummarizeSessionInput) {
    return this.sessionService.summarizeSession(input);
  }

  async suggestSessionMemory(input: SuggestSessionMemoryInput) {
    return this.sessionService.suggestSessionMemory(input);
  }

  async flashCheckpoint(input: Parameters<FlashService["checkpoint"]>[0]) {
    return this.flashService.checkpoint(input);
  }

  async flashResume(projectRoot: string) {
    return this.flashService.resume(projectRoot);
  }

  async flashClear(projectRoot: string) {
    return this.flashService.clear(projectRoot);
  }

  async recall(input: RecallInput) {
    return this.recallService.recall(input);
  }

  async recallFast(input: RecallInput) {
    const config = await ensureProjectScaffold(input.projectRoot);
    return this.recallService.recall({
      ...input,
      topK: input.topK ?? Math.min(5, config.retrieval.topK),
      sourceKinds: input.sourceKinds ?? ["manual", "decision", "project"],
      minScore: input.minScore ?? Math.max(config.retrieval.similarityThreshold, 0.24)
    });
  }

  async recallDeep(input: RecallInput) {
    const config = await ensureProjectScaffold(input.projectRoot);
    return this.recallService.recall({
      ...input,
      topK: input.topK ?? Math.min(14, config.retrieval.topK + 6),
      sourceKinds: input.sourceKinds ?? ["manual", "decision", "diary", "project", "imported"],
      minScore: input.minScore ?? Math.max(0, config.retrieval.similarityThreshold - 0.05)
    });
  }

  async contextForTask(input: ContextForTaskInput) {
    return this.recallService.contextForTask(input);
  }

  async forget(input: ForgetInput) {
    return this.sourceService.forget(input);
  }

  async disableSource(input: ToggleSourceInput) {
    return this.sourceService.disableSource(input);
  }

  async enableSource(input: ToggleSourceInput) {
    return this.sourceService.enableSource(input);
  }

  async rateSource(input: RateSourceInput) {
    return this.sourceService.rateSource(input);
  }

  async listSources(projectRoot: string) {
    return this.sourceService.listSources(projectRoot);
  }

  async listBranchViews(projectRoot: string) {
    return this.sourceService.listBranchViews(projectRoot);
  }

  async archiveStaleMemories(input: {
    projectRoot: string;
    olderThanDays?: number;
    sourceKinds?: Array<"diary" | "imported">;
    noisyOnly?: boolean;
  }) {
    return this.hygieneService.archiveStaleMemories(input);
  }

  async reviewMemoryHealth(input: {
    projectRoot: string;
    olderThanDays?: number;
    topK?: number;
  }) {
    return this.hygieneService.reviewMemoryHealth(input);
  }

  async listStaleDecisions(input: {
    projectRoot: string;
    olderThanDays?: number;
    topK?: number;
    includeDisabled?: boolean;
    maxStabilityScore?: number;
  }) {
    return this.hygieneService.listStaleDecisions(input);
  }

  async suggestMemoryCleanup(input: {
    projectRoot: string;
    olderThanDays?: number;
    topK?: number;
  }) {
    return this.hygieneService.suggestMemoryCleanup(input);
  }

  async applyMemoryCleanupPlan(input: {
    projectRoot: string;
    olderThanDays?: number;
    topK?: number;
    allowedActions?: Array<"archive_stale_memories" | "disable_noisy_sources">;
  }) {
    return this.hygieneService.applyMemoryCleanupPlan(input);
  }

  async markSuperseded(input: {
    projectRoot: string;
    canonicalDocId: string;
    supersededDocIds: string[];
    disableSources?: boolean;
    coolToCold?: boolean;
    reason?: string;
  }) {
    return this.hygieneService.markSuperseded(input);
  }

  async listConflicts(input: {
    projectRoot: string;
    topK?: number;
  }) {
    return this.hygieneService.listConflicts(input);
  }

  async listConflictClusters(input: {
    projectRoot: string;
    topK?: number;
  }) {
    return this.hygieneService.listConflictClusters(input);
  }

  async suggestConflictResolutions(input: {
    projectRoot: string;
    topK?: number;
    minScore?: number;
    includeDisabled?: boolean;
  }) {
    return this.hygieneService.suggestConflictResolutions(input);
  }

  async planConflictResolutions(input: {
    projectRoot: string;
    topK?: number;
    minScore?: number;
    includeDisabled?: boolean;
  }) {
    return this.hygieneService.planConflictResolutions(input);
  }

  async validateConflictResolutionPlan(input: {
    projectRoot: string;
    docIds: string[];
    title: string;
    decision: string;
    disableInputs?: boolean;
  }) {
    return this.hygieneService.validateConflictResolutionPlan(input);
  }

  async executeConflictResolutionPlan(input: {
    projectRoot: string;
    docIds: string[];
    title: string;
    decision: string;
    rationale?: string;
    impact?: string;
    moduleName?: string;
    tags?: string[];
    disableInputs?: boolean;
  }) {
    return this.hygieneService.executeConflictResolutionPlan(input);
  }

  async verifyConflictResolutionExecution(input: {
    projectRoot: string;
    canonicalDocId: string;
    supersededDocIds?: string[];
  }) {
    return this.hygieneService.verifyConflictResolutionExecution(input);
  }

  async suggestConflictResolutionFollowup(input: {
    projectRoot: string;
    canonicalDocId: string;
    supersededDocIds?: string[];
    archiveAfterDays?: number;
  }) {
    return this.hygieneService.suggestConflictResolutionFollowup(input);
  }

  async executeConflictResolutionFollowup(input: {
    projectRoot: string;
    canonicalDocId: string;
    supersededDocIds?: string[];
    action?: "disable" | "archive" | "keep_both" | "review";
    archiveAfterDays?: number;
    reason?: string;
  }) {
    return this.hygieneService.executeConflictResolutionFollowup(input);
  }

  async suggestConsolidations(input: {
    projectRoot: string;
    topK?: number;
    minScore?: number;
    sourceKinds?: Array<"manual" | "decision" | "diary" | "imported">;
    includeDisabled?: boolean;
  }) {
    return this.hygieneService.suggestConsolidations(input);
  }

  async consolidateMemories(input: {
    projectRoot: string;
    docIds: string[];
    title: string;
    kind?: "knowledge" | "decision";
    moduleName?: string;
    tags?: string[];
    disableInputs?: boolean;
  }) {
    return this.hygieneService.consolidateMemories(input);
  }

  async indexProject(projectRoot: string, options?: { force?: boolean }): Promise<IndexProjectResult> {
    return this.projectIndexService.indexProject(projectRoot, options);
  }

  async rebuildActiveProfileIndex(projectRoot: string) {
    return this.projectIndexService.rebuildActiveProfileIndex(projectRoot);
  }

  async inspectMemoryAccessSurface(projectRoot: string) {
    return inspectMemoryAccessSurface(projectRoot);
  }

  async inspectCanonicalMemory(projectRoot: string, options?: { recentLimit?: number }) {
    return this.canonicalService.inspectCanonicalMemory(projectRoot, options);
  }

  async inspectCanonicalGovernance(
    projectRoot: string,
    options?: { olderThanDays?: number; topK?: number }
  ) {
    const olderThanDays = options?.olderThanDays ?? 45;
    const topK = options?.topK ?? 8;
    const [health, staleDecisions, conflictClusters] = await Promise.all([
      this.hygieneService.reviewMemoryHealth({
        projectRoot,
        olderThanDays,
        topK
      }),
      this.hygieneService.listStaleDecisions({
        projectRoot,
        olderThanDays,
        topK
      }),
      this.hygieneService.listConflictClusters({
        projectRoot,
        topK
      })
    ]);

    return {
      projectRoot,
      generatedAt: Date.now(),
      olderThanDays,
      summary: {
        ...health.summary,
        staleDecisionCandidates: staleDecisions.length
      },
      recommendations: health.recommendations,
      staleDecisions: staleDecisions.map((item) => ({
        docId: item.docId,
        title: item.title,
        ageDays: item.ageDays,
        isDisabled: item.isDisabled,
        memoryTier: item.memoryTier,
        stabilityScore: item.stabilityScore,
        conflictSubjects: item.conflictSubjects,
        reasons: item.reasons,
        suggestedAction: item.suggestedAction
      })),
      conflictClusters
    };
  }

  async exportCanonicalMemory(
    projectRoot: string,
    options?: {
      sourceKinds?: Array<"manual" | "decision" | "diary" | "project" | "imported">;
      includeContent?: boolean;
      includeProjectContent?: boolean;
      limit?: number;
    }
  ) {
    return this.canonicalService.exportCanonicalMemory(projectRoot, options);
  }

  async validateProfileIndex(projectRoot: string) {
    return validateActiveProfileIndex(projectRoot);
  }

  async repairProfileRegistry(projectRoot: string) {
    return repairProfileRegistry(projectRoot);
  }

  async recoverProfileIndex(input: {
    projectRoot: string;
    strategy?: "safe" | "standard" | "aggressive";
    autoRepair?: boolean;
    autoRebuild?: boolean;
    autoIndex?: boolean;
    forceIndex?: boolean;
    dryRun?: boolean;
  }) {
    return this.profileOpsService.recoverActiveProfileIndex(input);
  }
}
