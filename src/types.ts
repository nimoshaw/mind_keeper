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
