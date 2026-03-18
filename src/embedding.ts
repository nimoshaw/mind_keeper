import crypto from "node:crypto";
import OpenAI from "openai";
import { EmbeddingCacheService, embeddingCacheHash } from "./app/embedding-cache.js";
import { embeddingMetricsCollector } from "./embedding-metrics.js";
import type { EmbeddingProfile } from "./types.js";

const DEFAULT_BATCH_MAX_ITEMS = 64;
const DEFAULT_BATCH_MAX_ESTIMATED_TOKENS = 6_000;
const DEFAULT_BATCH_CONCURRENCY = 4;

export class EmbeddingService {
  private readonly embeddingCacheService = new EmbeddingCacheService();

  async embed(profile: EmbeddingProfile, text: string, options?: { projectRoot?: string }): Promise<number[]> {
    const [vector] = await this.embedBatch(profile, [text], options);
    if (!vector || vector.length === 0) {
      throw new Error(`Embedding profile "${profile.name}" returned an empty vector.`);
    }
    return vector;
  }

  async embedBatch(profile: EmbeddingProfile, texts: string[], options?: { projectRoot?: string }): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (profile.kind === "hash") {
      embeddingMetricsCollector.recordRequest({
        profileName: profile.name,
        profileKind: profile.kind,
        texts,
        providerCallCount: 1
      });
      return texts.map((text) => hashEmbedding(text, profile.dimensions));
    }

    const results = new Array<number[]>(texts.length);
    const profileKey = buildEmbeddingProfileCacheKey(profile);
    const misses = new Map<string, { text: string; indexes: number[] }>();
    const cachedVectors =
      options?.projectRoot
        ? this.embeddingCacheService.getMany(options.projectRoot, profileKey, texts)
        : new Map<string, number[]>();

    for (let index = 0; index < texts.length; index += 1) {
      const text = texts[index];
      const contentHash = embeddingCacheHash(text);
      const cachedVector = cachedVectors.get(contentHash);
      if (cachedVector) {
        results[index] = cachedVector;
        continue;
      }

      const current = misses.get(contentHash);
      if (current) {
        current.indexes.push(index);
      } else {
        misses.set(contentHash, {
          text,
          indexes: [index]
        });
      }
    }

    const missedItemCount = [...misses.values()].reduce((sum, item) => sum + item.indexes.length, 0);
    const cacheHitCount = texts.length - missedItemCount;
    embeddingMetricsCollector.recordCacheHit(cacheHitCount);
    embeddingMetricsCollector.recordCacheMiss(missedItemCount);

    const missingItems = [...misses.values()].map((item) => item.text);
    const batches = createEmbeddingBatches(missingItems);
    embeddingMetricsCollector.recordRequest({
      profileName: profile.name,
      profileKind: profile.kind,
      texts,
      providerCallCount: batches.length
    });

    if (missingItems.length === 0) {
      return ensureEmbeddingResults(profile, results);
    }

    if (!profile.model || !profile.baseUrl || !profile.apiKeyEnv) {
      throw new Error(`Embedding profile "${profile.name}" is missing model/baseUrl/apiKeyEnv.`);
    }
    const model = profile.model;

    const apiKey = process.env[profile.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Environment variable ${profile.apiKeyEnv} is required for embedding profile "${profile.name}".`);
    }

    const client = new OpenAI({
      apiKey,
      baseURL: profile.baseUrl
    });

    await runWithConcurrency(
      batches,
      getBatchConcurrency(),
      async (batch) => {
        const response = await client.embeddings.create({
          model,
          input: batch.items.map((item) => item.text)
        });

        const vectors = response.data
          .slice()
          .sort((left, right) => left.index - right.index)
          .map((item) => item.embedding);

        if (vectors.length !== batch.items.length) {
          throw new Error(
            `Embedding profile "${profile.name}" returned ${vectors.length} vectors for ${batch.items.length} inputs.`
          );
        }

        const cacheEntries: Array<{ text: string; embedding: number[] }> = [];
        batch.items.forEach((item, index) => {
          const vector = vectors[index];
          if (!vector || vector.length === 0) {
            throw new Error(`Embedding profile "${profile.name}" returned an empty vector.`);
          }

          const miss = missingItems[item.originalIndex];
          const contentHash = embeddingCacheHash(miss);
          const grouped = misses.get(contentHash);
          if (!grouped) {
            return;
          }

          for (const originalIndex of grouped.indexes) {
            results[originalIndex] = vector;
          }
          cacheEntries.push({
            text: grouped.text,
            embedding: vector
          });
        });

        if (options?.projectRoot && cacheEntries.length > 0) {
          this.embeddingCacheService.setMany(options.projectRoot, {
            profileKey,
            profileName: profile.name,
            dimensions: profile.dimensions,
            entries: cacheEntries
          });
        }
      }
    );

    return ensureEmbeddingResults(profile, results);
  }
}

type EmbeddingBatch = {
  items: Array<{
    originalIndex: number;
    text: string;
    estimatedTokens: number;
  }>;
  estimatedTokens: number;
};

function hashEmbedding(text: string, dimensions: number): number[] {
  const output = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return output;
  }

  for (const token of tokens) {
    const digest = crypto.createHash("sha256").update(token).digest();
    for (let i = 0; i < digest.length; i += 1) {
      const index = digest[i] % dimensions;
      const sign = digest[(i + 1) % digest.length] % 2 === 0 ? 1 : -1;
      output[index] += sign;
    }
  }

  return normalize(output);
}

export function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

function createEmbeddingBatches(texts: string[]): EmbeddingBatch[] {
  const batches: EmbeddingBatch[] = [];
  let current: EmbeddingBatch = {
    items: [],
    estimatedTokens: 0
  };

  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index];
    const estimatedTokens = estimateEmbeddingTokens(text);
    const wouldOverflowByItems = current.items.length >= getBatchMaxItems();
    const wouldOverflowByTokens =
      current.items.length > 0 && current.estimatedTokens + estimatedTokens > getBatchMaxEstimatedTokens();

    if (wouldOverflowByItems || wouldOverflowByTokens) {
      batches.push(current);
      current = {
        items: [],
        estimatedTokens: 0
      };
    }

    current.items.push({
      originalIndex: index,
      text,
      estimatedTokens
    });
    current.estimatedTokens += estimatedTokens;
  }

  if (current.items.length > 0) {
    batches.push(current);
  }

  return batches;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  let cursor = 0;

  const runners = new Array(safeConcurrency).fill(null).map(async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= items.length) {
        return;
      }

      await worker(items[currentIndex]);
    }
  });

  await Promise.all(runners);
}

function estimateEmbeddingTokens(text: string): number {
  if (text.length === 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

function getBatchMaxItems(): number {
  return parsePositiveInt(process.env.MIND_KEEPER_EMBED_BATCH_MAX_ITEMS, DEFAULT_BATCH_MAX_ITEMS);
}

function getBatchMaxEstimatedTokens(): number {
  return parsePositiveInt(
    process.env.MIND_KEEPER_EMBED_BATCH_MAX_ESTIMATED_TOKENS,
    DEFAULT_BATCH_MAX_ESTIMATED_TOKENS
  );
}

function getBatchConcurrency(): number {
  return parsePositiveInt(process.env.MIND_KEEPER_EMBED_BATCH_CONCURRENCY, DEFAULT_BATCH_CONCURRENCY);
}

function buildEmbeddingProfileCacheKey(profile: EmbeddingProfile): string {
  return [
    profile.name,
    profile.kind,
    profile.model ?? "",
    profile.baseUrl ?? "",
    String(profile.dimensions)
  ].join("|");
}

function ensureEmbeddingResults(profile: EmbeddingProfile, results: Array<number[] | undefined>): number[][] {
  return results.map((vector) => {
    if (!vector || vector.length === 0) {
      throw new Error(`Embedding profile "${profile.name}" returned an incomplete result set.`);
    }
    return vector;
  });
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
