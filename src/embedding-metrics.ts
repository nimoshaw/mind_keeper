import { normalizeEmbeddingText } from "./app/embedding-cache.js";
import { sha1 } from "./memory-defaults.js";
import type { EmbeddingProfileKind } from "./types.js";

export type EmbeddingMetricsSnapshot = {
  enabled: boolean;
  logicalRequestCount: number;
  providerCallCount: number;
  itemCount: number;
  totalCharacters: number;
  estimatedTokens: number;
  averageItemsPerProviderCall: number;
  uniqueTextCount: number;
  duplicateTextCount: number;
  duplicateRatio: number;
  profileNames: string[];
  hashItemCount: number;
  remoteItemCount: number;
  cacheHits: number;
  cacheMisses: number;
};

type RecordRequestInput = {
  profileName: string;
  profileKind: EmbeddingProfileKind;
  texts: string[];
  providerCallCount?: number;
};

class EmbeddingMetricsCollector {
  private enabled = false;
  private logicalRequestCount = 0;
  private providerCallCount = 0;
  private itemCount = 0;
  private totalCharacters = 0;
  private estimatedTokens = 0;
  private hashItemCount = 0;
  private remoteItemCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private readonly profileNames = new Set<string>();
  private readonly textHashes = new Map<string, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  reset(): void {
    this.logicalRequestCount = 0;
    this.providerCallCount = 0;
    this.itemCount = 0;
    this.totalCharacters = 0;
    this.estimatedTokens = 0;
    this.hashItemCount = 0;
    this.remoteItemCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.profileNames.clear();
    this.textHashes.clear();
  }

  recordRequest(input: RecordRequestInput): void {
    if (!this.enabled || input.texts.length === 0) {
      return;
    }

    this.logicalRequestCount += 1;
    this.providerCallCount += input.providerCallCount ?? 1;
    this.profileNames.add(input.profileName);

    for (const text of input.texts) {
      const normalized = normalizeEmbeddingText(text);
      const hash = sha1(normalized);
      this.textHashes.set(hash, (this.textHashes.get(hash) ?? 0) + 1);
      this.itemCount += 1;
      this.totalCharacters += normalized.length;
      this.estimatedTokens += estimateEmbeddingTokens(normalized);
      if (input.profileKind === "hash") {
        this.hashItemCount += 1;
      } else {
        this.remoteItemCount += 1;
      }
    }
  }

  recordCacheHit(count = 1): void {
    if (!this.enabled || count <= 0) {
      return;
    }

    this.cacheHits += count;
  }

  recordCacheMiss(count = 1): void {
    if (!this.enabled || count <= 0) {
      return;
    }

    this.cacheMisses += count;
  }

  snapshot(): EmbeddingMetricsSnapshot {
    const uniqueTextCount = this.textHashes.size;
    const duplicateTextCount = Math.max(0, this.itemCount - uniqueTextCount);
    return {
      enabled: this.enabled,
      logicalRequestCount: this.logicalRequestCount,
      providerCallCount: this.providerCallCount,
      itemCount: this.itemCount,
      totalCharacters: this.totalCharacters,
      estimatedTokens: this.estimatedTokens,
      averageItemsPerProviderCall:
        this.providerCallCount === 0 ? 0 : round2(this.itemCount / this.providerCallCount),
      uniqueTextCount,
      duplicateTextCount,
      duplicateRatio: this.itemCount === 0 ? 0 : round4(duplicateTextCount / this.itemCount),
      profileNames: [...this.profileNames].sort(),
      hashItemCount: this.hashItemCount,
      remoteItemCount: this.remoteItemCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses
    };
  }
}

export const embeddingMetricsCollector = new EmbeddingMetricsCollector();

function estimateEmbeddingTokens(input: string): number {
  if (input.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(input.length / 4));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
