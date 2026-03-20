import fs from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import type { EmbeddingProfile, MindKeeperConfig, RerankerProfile } from "./types.js";

const DEFAULT_PROFILES: EmbeddingProfile[] = [
  {
    name: "hash-local",
    kind: "hash",
    dimensions: 256
  },
  {
    name: "qwen3-8b",
    kind: "openai_compatible",
    dimensions: 4096,
    model: "Qwen/Qwen3-Embedding-8B",
    baseUrl: "http://localhost:3000/v1",
    apiKeyEnv: "MIND_KEEPER_EMBEDDING_API_KEY"
  },
  {
    name: "embedding-001",
    kind: "openai_compatible",
    dimensions: 3072,
    model: "text-embedding-3-large",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY"
  },
  {
    name: "embedding-cheap",
    kind: "openai_compatible",
    dimensions: 1536,
    model: "text-embedding-3-small",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY"
  }
];

const DEFAULT_RERANKER_PROFILES: RerankerProfile[] = [
  {
    name: "heuristic-local",
    kind: "heuristic",
    maxInputChars: 1800
  },
  {
    name: "openai-rerank",
    kind: "openai_compatible",
    model: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    maxInputChars: 1800
  },
  {
    name: "cheap-rerank",
    kind: "openai_compatible",
    model: "gpt-4.1-nano",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    maxInputChars: 1400
  }
];

export const MINDSPACE_DIRNAME = ".mindkeeper";

export function defaultConfig(projectName: string): MindKeeperConfig {
  return {
    version: 1,
    projectName,
    activeEmbeddingProfile: "hash-local",
    activeRerankerProfile: "heuristic-local",
    sourcePriority: {
      manual: 1,
      decision: 0.95,
      log: 0.8,
      diary: 0.85,
      project: 0.75,
      imported: 0.7
    },

    indexing: {
      includeGlobs: [
        "**/*.md",
        "**/*.txt",
        "**/*.ts",
        "**/*.tsx",
        "**/*.js",
        "**/*.jsx",
        "**/*.py",
        "**/*.go",
        "**/*.rs",
        "**/*.java",
        "**/*.cs",
        "**/*.c",
        "**/*.cpp",
        "**/*.h",
        "**/*.hpp",
        "**/*.json",
        "**/*.yaml",
        "**/*.yml",
        "**/*.toml",
        "**/*.sql",
        "**/*.sh",
        "**/*.ps1"
      ],
      excludeGlobs: [
        "**/.git/**",
        "**/.mindkeeper/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/target/**",
        "**/.next/**",
        "**/coverage/**",
        "**/*.lock",
        "**/*.png",
        "**/*.jpg",
        "**/*.jpeg",
        "**/*.gif",
        "**/*.pdf",
        "**/*.zip"
      ],
      maxFileBytes: 256_000,
      chunkSize: 1200,
      chunkOverlap: 150
    },
    retrieval: {
      topK: 8,
      similarityThreshold: 0.2,
      lexicalWeight: 0.3,
      vectorWeight: 0.6,
      sourcePriorityWeight: 0.1,
      freshnessWeight: 0.08,
      rerankWeight: 0.2,
      rerankDepth: 12,
      modelRerankWeight: 0.15,
      modelRerankDepth: 6,
      pathBoost: 0.04,
      relatedPathBoost: 0.07,
      symbolBoost: 0.09,
      branchBoost: 0.03,
      siblingBranchBoost: 0.015,
      crossBranchPenalty: 0.02,
      titleBoostMax: 0.06,
      tierWeight: 0.08,
      stabilityWeight: 0.06,
      taskKnowledgeReserve: 2,
      taskContextTokenBudget: 1800,
      feedbackWeight: 0.12,
      feedbackHalfLifeDays: 45,
      staleNoisyBias: 0.45,
      relationWeight: 0.08
    },
    embeddingProfiles: DEFAULT_PROFILES,
    rerankerProfiles: DEFAULT_RERANKER_PROFILES
  };
}

export function mindkeeperRoot(projectRoot: string): string {
  return path.join(projectRoot, MINDSPACE_DIRNAME);
}

export function configPath(projectRoot: string): string {
  return path.join(mindkeeperRoot(projectRoot), "config.toml");
}

export async function loadConfig(projectRoot: string): Promise<MindKeeperConfig> {
  const filePath = configPath(projectRoot);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = TOML.parse(raw) as unknown as MindKeeperConfig;
  const defaults = defaultConfig(parsed.projectName ?? path.basename(projectRoot));

  return {
    ...defaults,
    ...parsed,
    indexing: {
      ...defaults.indexing,
      ...parsed.indexing
    },
    retrieval: {
      ...defaults.retrieval,
      ...parsed.retrieval
    },
    sourcePriority: {
      ...defaults.sourcePriority,
      ...parsed.sourcePriority
    },
    embeddingProfiles: parsed.embeddingProfiles?.length ? parsed.embeddingProfiles : defaults.embeddingProfiles,
    rerankerProfiles: parsed.rerankerProfiles?.length ? parsed.rerankerProfiles : defaults.rerankerProfiles
  };
}

export async function writeConfig(projectRoot: string, config: MindKeeperConfig): Promise<void> {
  const filePath = configPath(projectRoot);
  const serialized = TOML.stringify(config as unknown as TOML.JsonMap);
  await fs.writeFile(filePath, serialized, "utf8");
}
