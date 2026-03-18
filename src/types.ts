export type MemorySourceKind = "manual" | "decision" | "diary" | "project" | "imported";
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

export type EmbeddingProfileKind = "hash" | "openai_compatible";
export type RerankerProfileKind = "heuristic" | "openai_compatible";

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
  recommendedAction:
    | "none"
    | "index_project"
    | "rebuild_active_profile_index"
    | "repair_profile_registry";
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
