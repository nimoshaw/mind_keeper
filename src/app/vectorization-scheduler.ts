import { embeddingCacheHash } from "./embedding-cache.js";
import { sharedEmbeddingBatchBroker, estimateEmbeddingTokens, type EmbeddingBatchBroker } from "./embedding-batch-broker.js";
import type { EmbeddingProfile } from "../types.js";

const DEFAULT_WINDOW_MS = 500;
const DEFAULT_MAX_WINDOW_MS = 1200;
const DEFAULT_FLUSH_ITEM_THRESHOLD = 48;
const DEFAULT_FLUSH_TOKEN_THRESHOLD = 5_000;

type ScheduledItem = {
  text: string;
  contentHash: string;
  estimatedTokens: number;
  resolve: (vector: number[]) => void;
  reject: (error: Error) => void;
};

type ProfileBucket = {
  profile: EmbeddingProfile;
  items: ScheduledItem[];
  totalTokens: number;
  windowTimer: ReturnType<typeof setTimeout> | null;
  maxWindowTimer: ReturnType<typeof setTimeout> | null;
};

export class VectorizationScheduler {
  private readonly buckets = new Map<string, ProfileBucket>();
  private readonly broker: EmbeddingBatchBroker;
  private readonly windowMs: number;
  private readonly maxWindowMs: number;
  private readonly flushItemThreshold: number;
  private readonly flushTokenThreshold: number;

  constructor(options?: {
    broker?: EmbeddingBatchBroker;
    windowMs?: number;
    maxWindowMs?: number;
    flushItemThreshold?: number;
    flushTokenThreshold?: number;
  }) {
    this.broker = options?.broker ?? sharedEmbeddingBatchBroker;
    this.windowMs = options?.windowMs ?? envPositiveInt("MIND_KEEPER_SCHED_WINDOW_MS", DEFAULT_WINDOW_MS);
    this.maxWindowMs = options?.maxWindowMs ?? envPositiveInt("MIND_KEEPER_SCHED_MAX_WINDOW_MS", DEFAULT_MAX_WINDOW_MS);
    this.flushItemThreshold = options?.flushItemThreshold ?? envPositiveInt("MIND_KEEPER_SCHED_FLUSH_ITEMS", DEFAULT_FLUSH_ITEM_THRESHOLD);
    this.flushTokenThreshold = options?.flushTokenThreshold ?? envPositiveInt("MIND_KEEPER_SCHED_FLUSH_TOKENS", DEFAULT_FLUSH_TOKEN_THRESHOLD);
  }

  schedule(profile: EmbeddingProfile, texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return Promise.resolve([]);
    }

    const bucket = this.getBucket(profile);
    const promises = texts.map((text) => {
      const contentHash = embeddingCacheHash(text);
      const estimatedTokens = estimateEmbeddingTokens(text);

      return new Promise<number[]>((resolve, reject) => {
        bucket.items.push({ text, contentHash, estimatedTokens, resolve, reject });
        bucket.totalTokens += estimatedTokens;
      });
    });

    if (this.shouldFlushImmediately(bucket)) {
      this.flush(bucket);
    } else {
      this.resetWindowTimer(bucket);
    }

    return Promise.all(promises);
  }

  async shutdown(): Promise<void> {
    for (const bucket of this.buckets.values()) {
      this.flush(bucket);
    }
  }

  private getBucket(profile: EmbeddingProfile): ProfileBucket {
    const key = bucketKey(profile);
    const existing = this.buckets.get(key);
    if (existing) {
      return existing;
    }

    const bucket: ProfileBucket = {
      profile,
      items: [],
      totalTokens: 0,
      windowTimer: null,
      maxWindowTimer: null
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private shouldFlushImmediately(bucket: ProfileBucket): boolean {
    return (
      bucket.items.length >= this.flushItemThreshold ||
      bucket.totalTokens >= this.flushTokenThreshold
    );
  }

  private resetWindowTimer(bucket: ProfileBucket): void {
    if (bucket.windowTimer !== null) {
      clearTimeout(bucket.windowTimer);
    }

    bucket.windowTimer = setTimeout(() => {
      bucket.windowTimer = null;
      this.flush(bucket);
    }, this.windowMs);

    if (bucket.maxWindowTimer === null) {
      bucket.maxWindowTimer = setTimeout(() => {
        bucket.maxWindowTimer = null;
        this.flush(bucket);
      }, this.maxWindowMs);
    }
  }

  private flush(bucket: ProfileBucket): void {
    if (bucket.windowTimer !== null) {
      clearTimeout(bucket.windowTimer);
      bucket.windowTimer = null;
    }
    if (bucket.maxWindowTimer !== null) {
      clearTimeout(bucket.maxWindowTimer);
      bucket.maxWindowTimer = null;
    }

    const snapshot = bucket.items.splice(0);
    bucket.totalTokens = 0;

    if (snapshot.length === 0) {
      return;
    }

    if (bucket.items.length === 0) {
      this.buckets.delete(bucketKey(bucket.profile));
    }

    const deduped = new Map<string, { text: string; waiters: Array<{ resolve: (v: number[]) => void; reject: (e: Error) => void }> }>();
    const orderedHashes: string[] = [];

    for (const item of snapshot) {
      const existing = deduped.get(item.contentHash);
      if (existing) {
        existing.waiters.push({ resolve: item.resolve, reject: item.reject });
      } else {
        orderedHashes.push(item.contentHash);
        deduped.set(item.contentHash, {
          text: item.text,
          waiters: [{ resolve: item.resolve, reject: item.reject }]
        });
      }
    }

    const uniqueTexts = orderedHashes.map((hash) => deduped.get(hash)!.text);

    this.broker.embedBatch(bucket.profile, uniqueTexts).then(
      (vectors) => {
        for (let i = 0; i < orderedHashes.length; i++) {
          const entry = deduped.get(orderedHashes[i])!;
          const vector = vectors[i];
          for (const waiter of entry.waiters) {
            waiter.resolve(vector);
          }
        }
      },
      (error) => {
        const safeError = error instanceof Error ? error : new Error(String(error));
        for (const entry of deduped.values()) {
          for (const waiter of entry.waiters) {
            waiter.reject(safeError);
          }
        }
      }
    );
  }
}

export const sharedVectorizationScheduler = new VectorizationScheduler();

function bucketKey(profile: EmbeddingProfile): string {
  return [
    profile.name,
    profile.kind,
    profile.model ?? "",
    profile.baseUrl ?? "",
    String(profile.dimensions)
  ].join("|");
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
