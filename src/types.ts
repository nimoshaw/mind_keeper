export type MemorySourceKind = "manual" | "decision" | "diary" | "project" | "imported" | "log";
export type ContextTaskStage = "debug" | "implement" | "verify" | "refactor" | "document" | "explore" | "general";
export type TaskIntentSubtype =
  | "bug_root_cause"
  | "bug_fix"
  | "api_change"
  | "migration"
  | "test_repair"
  | "refactor_safety"
  | "docs_update"
  | "architecture_review"
  | "general";
export type SourceFeedbackSignal = "helpful" | "noisy";
export type MemoryTier = "working" | "stable" | "project" | "cold";
export type DistilledMemoryKind = "discard" | "diary" | "decision" | "knowledge";
export type MemoryEdgeType = "module" | "symbol" | "path" | "tag" | "branch" | "language";
export type FlashCheckpointFreshness = "fresh" | "recent" | "stale";

export type EmbeddingProfileKind = "hash" | "openai_compatible";
export type RerankerProfileKind = "heuristic" | "openai_compatible";
export type ProfileIndexRecoveryStrategy = "safe" | "standard" | "aggressive";
export type ProfileIndexValidationAction =
  | "none"
  | "index_project"
  | "rebuild_active_profile_index"
  | "repair_profile_registry"
  | "review_project_config";
export type ProfileIndexRecoveryFailureCode =
  | "missing_embedding_api_key"
  | "invalid_embedding_profile_config"
  | "unknown_embedding_profile"
  | "embedding_provider_request_failed"
  | "embedding_provider_empty_vector"
  | "review_project_config_required"
  | "unknown_error";

export interface CanonicalMemorySchemaDescriptor {
  kind: "mindkeeper_canonical_memory";
  schemaVersion: number;
  layoutVersion: number;
  compatibilityMode: "model_agnostic";
  vectorOwnership: "profile_specific";
}

export interface CanonicalMemoryFieldDescriptor {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface CanonicalMemoryContractDescriptor {
  kind: "mindkeeper_canonical_contract";
  schemaVersion: number;
  layoutVersion: number;
  partitions: Array<"knowledge" | "diary" | "decisions" | "imports" | "project">;
  canonicalFiles: {
    schemaPath: string;
    contractPath: string;
  };
  lifecycle: {
    truthLayer: "canonical_memory";
    indexLayer: "profile_specific_indexes";
    runtimeProfileMode: "single_active_profile";
  };
  governanceSignals: string[];
  fields: CanonicalMemoryFieldDescriptor[];
}

export interface EmbeddingProfileIndexDescriptor {
  kind: "mindkeeper_profile_index";
  schemaVersion: number;
  profileName: string;
  profileKind: EmbeddingProfileKind;
  model: string | null;
  baseUrl: string | null;
  dimensions: number;
  compatibilityMode: "reuse_same_profile_only";
}

export interface ActiveProfileIndexState {
  profileName: string;
  profileKind: EmbeddingProfileKind;
  dimensions: number;
  model: string | null;
  descriptorPath: string;
  descriptorPresent: boolean;
  status: "empty" | "ready" | "rebuild_required";
  reusable: boolean;
  totalManifestCount: number;
  activeProfileManifestCount: number;
  reasons: string[];
}

export interface ProfileIndexValidationReport {
  projectRoot: string;
  activeProfileIndex: ActiveProfileIndexState | null;
  severity: "ok" | "warn" | "error";
  recommendedAction: ProfileIndexValidationAction;
  summary: string;
  issues: string[];
  legacyVectorLayoutPresent: boolean;
  descriptorPresent: boolean;
  configPresent: boolean;
}

export interface ActiveProfileIndexRebuildReport {
  projectRoot: string;
  profileName: string;
  validationBefore: ProfileIndexValidationReport;
  rebuiltSourceCounts: Record<MemorySourceKind, number>;
  removedMissingSources: number;
  projectIndexResult: IndexProjectResult;
  validationAfter: ProfileIndexValidationReport;
}

export interface ProfileRegistryRepairReport {
  projectRoot: string;
  createdConfig: boolean;
  activeProfileName: string;
  repairedPaths: string[];
  validationBefore: ProfileIndexValidationReport;
  validationAfter: ProfileIndexValidationReport;
}

export interface ProfileIndexRecoveryStep {
  action: "repair_profile_registry" | "rebuild_active_profile_index" | "index_project";
  status: "executed" | "skipped" | "planned" | "failed";
  reason: string;
  recommendedActionAfter: ProfileIndexValidationReport["recommendedAction"];
  failureCode?: ProfileIndexRecoveryFailureCode;
  errorMessage?: string;
}

export interface ProfileIndexRecoveryManualAction {
  action:
    | "repair_profile_registry"
    | "rebuild_active_profile_index"
    | "index_project"
    | "inspect_memory_access_surface"
    | "review_project_config"
    | "set_environment_variable";
  reason: string;
}

export interface ProfileIndexRecoveryFailure {
  code: ProfileIndexRecoveryFailureCode;
  action: ProfileIndexRecoveryStep["action"] | null;
  summary: string;
  detail: string;
  retryable: boolean;
  envVarName?: string;
  profileName?: string;
}

export interface ProfileIndexRecoveryReport {
  projectRoot: string;
  startedAt: number;
  completedAt: number;
  options: {
    strategy: ProfileIndexRecoveryStrategy;
    autoRepair: boolean;
    autoRebuild: boolean;
    autoIndex: boolean;
    forceIndex: boolean;
    dryRun: boolean;
  };
  initialValidation: ProfileIndexValidationReport;
  steps: ProfileIndexRecoveryStep[];
  repairReport: ProfileRegistryRepairReport | null;
  rebuildReport: ActiveProfileIndexRebuildReport | null;
  indexProjectResult: IndexProjectResult | null;
  finalValidation: ProfileIndexValidationReport;
  failedAction: ProfileIndexRecoveryStep["action"] | null;
  failure: ProfileIndexRecoveryFailure | null;
  errorMessage: string | null;
  manualActions: ProfileIndexRecoveryManualAction[];
  resolved: boolean;
  summary: string;
}

export interface MemoryAccessSurfaceReport {
  projectRoot: string;
  canonical: {
    root: string;
    schemaPath: string;
    contractPath: string;
    schemaVersion: number | null;
    contractFieldCount: number | null;
    governanceSignals: string[];
  };
  activeProfileIndex: ActiveProfileIndexState;
  runtimeRules: {
    profileMode: "single_active_profile";
    vectorOwnership: "profile_specific";
    sharedLayer: "canonical_memory";
  };
  compatibilityLevels: Array<{
    level: "same_agent_same_profile" | "different_agent_same_profile" | "different_agent_different_profile";
    canonicalReuse: boolean;
    indexReuse: boolean;
    note: string;
  }>;
  recommendedAccess: {
    primary: Array<"inspect_memory_access_surface" | "list_sources" | "recall" | "context_for_task">;
    externalReadersShouldAvoid: Array<"reading_profile_vectors_as_truth" | "runtime_multi_profile_queries" | "guessing_schema_from_directory_names">;
  };
}

export interface CanonicalMemoryInspectionReport {
  projectRoot: string;
  schemaVersion: number | null;
  contractFieldCount: number | null;
  totalSources: number;
  activeSources: number;
  disabledSources: number;
  sourceKindSummary: Array<{
    sourceKind: MemorySourceKind;
    count: number;
    activeCount: number;
    disabledCount: number;
    latestUpdatedAt: number | null;
  }>;
  tierSummary: Array<{
    memoryTier: MemoryTier | "unknown";
    count: number;
  }>;
  branchSummary: Array<{
    branchName: string | null;
    docCount: number;
    disabledCount: number;
    latestUpdatedAt: number | null;
  }>;
  recentSources: Array<{
    docId: string;
    sourceKind: MemorySourceKind;
    title: string | null;
    relativePath: string | null;
    memoryTier: MemoryTier | null;
    updatedAt: number;
    isDisabled: boolean;
  }>;
}

export interface CanonicalMemoryGovernanceReport {
  projectRoot: string;
  generatedAt: number;
  olderThanDays: number;
  summary: {
    totalSources: number;
    activeSources: number;
    disabledSources: number;
    coldSources: number;
    staleCandidates: number;
    noisyCandidates: number;
    conflictClusters: number;
    staleDecisionCandidates: number;
  };
  recommendations: Array<{
    action: "archive_stale_memories" | "review_conflicts" | "disable_noisy_sources" | "healthy";
    priority: "high" | "medium" | "low";
    count: number;
    reason: string;
    docIds: string[];
    subjects?: string[];
  }>;
  staleDecisions: Array<{
    docId: string;
    title: string | null;
    ageDays: number;
    isDisabled: boolean;
    memoryTier: string | null;
    stabilityScore: number | null;
    conflictSubjects: string[];
    reasons: string[];
    suggestedAction: "mark_superseded" | "review" | "keep_cold";
  }>;
  conflictClusters: Array<{
    subject: string;
    docIds: string[];
    titles: string[];
    docCount: number;
    pairCount: number;
    score: number;
    reasons: string[];
    suggestedAction: string;
  }>;
}

export interface CanonicalMemoryExportItem {
  docId: string;
  sourceKind: MemorySourceKind;
  title: string | null;
  path: string;
  relativePath: string | null;
  tags: string[];
  moduleName: string | null;
  symbol: string | null;
  branchName: string | null;
  contentHash: string | null;
  memoryTier: MemoryTier | null;
  stabilityScore: number | null;
  distillConfidence: number | null;
  distillReason: string | null;
  updatedAt: number;
  disabled: boolean;
  disabledReason: string | null;
  helpfulVotes: number;
  noisyVotes: number;
  supersededBy: string | null;
  conflictSubjects: string[];
  contentIncluded: boolean;
  content: string | null;
}

export interface CanonicalMemoryExportReport {
  projectRoot: string;
  exportedAt: number;
  schemaVersion: number | null;
  contractFieldCount: number | null;
  totalExported: number;
  filters: {
    sourceKinds: MemorySourceKind[] | null;
    includeContent: boolean;
    includeProjectContent: boolean;
  };
  items: CanonicalMemoryExportItem[];
}

export interface EmbeddingProfile {
  name: string;
  kind: EmbeddingProfileKind;
  dimensions: number;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export interface RerankerProfile {
  name: string;
  kind: RerankerProfileKind;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  maxInputChars?: number;
}

export interface MindKeeperConfig {
  version: number;
  projectName: string;
  activeEmbeddingProfile: string;
  activeRerankerProfile: string;
  sourcePriority: Record<MemorySourceKind, number>;
  indexing: {
    includeGlobs: string[];
    excludeGlobs: string[];
    maxFileBytes: number;
    chunkSize: number;
    chunkOverlap: number;
  };
  retrieval: {
    topK: number;
    similarityThreshold: number;
    lexicalWeight: number;
    vectorWeight: number;
    sourcePriorityWeight: number;
    freshnessWeight: number;
    rerankWeight: number;
    rerankDepth: number;
    modelRerankWeight: number;
    modelRerankDepth: number;
    pathBoost: number;
    relatedPathBoost: number;
    symbolBoost: number;
    branchBoost: number;
    siblingBranchBoost: number;
    crossBranchPenalty: number;
    titleBoostMax: number;
    tierWeight: number;
    stabilityWeight: number;
    taskKnowledgeReserve: number;
    taskContextTokenBudget: number;
    feedbackWeight: number;
    feedbackHalfLifeDays: number;
    staleNoisyBias: number;
    relationWeight: number;
  };
  embeddingProfiles: EmbeddingProfile[];
  rerankerProfiles: RerankerProfile[];
}

export interface ChunkRecord {
  id: number;
  docId: string;
  sourceKind: MemorySourceKind;
  path: string;
  title: string | null;
  chunkIndex: number;
  content: string;
  tags: string[];
  moduleName: string | null;
  language?: string | null;
  symbol?: string | null;
  branchName?: string | null;
  updatedAt?: number;
  memoryTier?: MemoryTier | null;
  stabilityScore?: number | null;
  distillConfidence?: number | null;
  distillReason?: string | null;
  score?: number;
  scoreDetails?: {
    vector: number;
    lexical: number;
    sourcePriority: number;
    freshness: number;
    tierBoost: number;
    stabilityBoost: number;
    pathBoost: number;
    symbolBoost: number;
    branchBoost: number;
    titleBoost: number;
    feedbackBoost: number;
    relationBoost: number;
    rerankModel: number;
    rerank: number;
    total: number;
  };
  relationHits?: string[];
  explainReasons?: string[];
  explainCards?: Array<{
    kind: "match" | "priority" | "warning" | "relation" | "rerank";
    title: string;
    detail: string;
  }>;
}

export interface IndexProjectResult {
  indexedFiles: number;
  skippedFiles: number;
  unchangedFiles: number;
  removedFiles: number;
}

export interface RememberInput {
  projectRoot: string;
  content: string;
  sourceKind: Exclude<MemorySourceKind, "project">;
  title?: string;
  pathHint?: string;
  moduleName?: string;
  tags?: string[];
  memoryTier?: MemoryTier;
  stabilityScore?: number;
  distillConfidence?: number;
  distillReason?: string;
}

export interface RecallInput {
  projectRoot: string;
  query: string;
  topK?: number;
  sourceKinds?: MemorySourceKind[];
  pathContains?: string;
  moduleName?: string;
  language?: string;
  symbol?: string;
  branchName?: string;
  relatedPaths?: string[];
  minScore?: number;
  explain?: boolean;
  dateFrom?: string;
  dateTo?: string;
  lastDays?: number;
}

export interface RememberDecisionInput {
  projectRoot: string;
  title: string;
  decision: string;
  rationale?: string;
  impact?: string;
  moduleName?: string;
  tags?: string[];
}

export interface RememberLogInput {
  projectRoot: string;
  event: string;
  model?: string;
  action?: string;
  testResult?: string;
  notes?: string;
  tags?: string[];
}


export interface ContextForTaskInput {
  projectRoot: string;
  task: string;
  currentFile?: string;
  currentSymbol?: string;
  selectedText?: string;
  diagnostics?: string;
  branchName?: string;
  relatedFiles?: string[];
  topK?: number;
}

export interface SummarizeSessionInput {
  projectRoot: string;
  title: string;
  sessionText: string;
  kind?: Exclude<DistilledMemoryKind, "discard">;
  moduleName?: string;
  tags?: string[];
}

export interface SuggestSessionMemoryInput {
  projectRoot: string;
  sessionText: string;
  title?: string;
  moduleName?: string;
}

export interface ForgetInput {
  projectRoot: string;
  docId?: string;
  path?: string;
}

export interface ToggleSourceInput {
  projectRoot: string;
  docId?: string;
  path?: string;
  reason?: string;
}

export interface RateSourceInput {
  projectRoot: string;
  signal: SourceFeedbackSignal;
  docId?: string;
  path?: string;
  reason?: string;
}

export interface FlashCheckpointInput {
  projectRoot: string;
  title: string;
  sessionGoal: string;
  currentStatus: string;
  workingMemory?: string;
  nextSteps?: string[];
  blockers?: string[];
  openQuestions?: string[];
  branchName?: string;
  touchedFiles?: string[];
  importantCommands?: string[];
  tags?: string[];
}

export interface FlashCheckpointRecord {
  id: string;
  title: string;
  sessionGoal: string;
  currentStatus: string;
  workingMemory: string;
  nextSteps: string[];
  blockers: string[];
  openQuestions: string[];
  branchName: string | null;
  touchedFiles: string[];
  importantCommands: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FlashCheckpointResult {
  projectRoot: string;
  activePath: string;
  historyPath: string;
  checkpoint: FlashCheckpointRecord;
  summary: string;
}

export interface FlashResumeReport {
  projectRoot: string;
  found: boolean;
  activePath: string;
  checkpoint: FlashCheckpointRecord | null;
  freshness: FlashCheckpointFreshness | null;
  ageHours: number | null;
  shouldInject: boolean;
  resumePrompt: string | null;
  summary: string;
}

export interface FlashClearReport {
  projectRoot: string;
  cleared: boolean;
  activePath: string;
  summary: string;
}

export interface DomainSectionConfig {
  dir: string;
  label: string;
}

export interface DomainConfig {
  name: string;
  displayName: string;
  aliases: string[];
  description: string;
  tags: string[];
  sections: DomainSectionConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface DomainIndexEntry {
  name: string;
  displayName: string;
  aliases: string[];
  description: string;
  tags: string[];
  sectionCount: number;
  fileCount: number;
  updatedAt: string;
}

export interface DomainIndex {
  generatedAt: string;
  domains: DomainIndexEntry[];
}
