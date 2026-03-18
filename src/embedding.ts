import crypto from "node:crypto";
import { buildEmbeddingProfileCacheKey, sharedEmbeddingBatchBroker } from "./app/embedding-batch-broker.js";
import { EmbeddingCacheService, embeddingCacheHash } from "./app/embedding-cache.js";
import { embeddingMetricsCollector } from "./embedding-metrics.js";
import type { EmbeddingProfile } from "./types.js";

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
    embeddingMetricsCollector.recordRequest({
      profileName: profile.name,
      profileKind: profile.kind,
      texts,
      providerCallCount: 0
    });

    if (missingItems.length === 0) {
      return ensureEmbeddingResults(profile, results);
    }

    const remoteVectors = await sharedEmbeddingBatchBroker.embedBatch(profile, missingItems);
    const cacheEntries: Array<{ text: string; embedding: number[] }> = [];
    remoteVectors.forEach((vector, index) => {
      const miss = missingItems[index];
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

    return ensureEmbeddingResults(profile, results);
  }
}

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

function ensureEmbeddingResults(profile: EmbeddingProfile, results: Array<number[] | undefined>): number[][] {
  return results.map((vector) => {
    if (!vector || vector.length === 0) {
      throw new Error(`Embedding profile "${profile.name}" returned an incomplete result set.`);
    }
    return vector;
  });
}
