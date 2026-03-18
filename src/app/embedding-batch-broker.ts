import OpenAI from "openai";
import { embeddingCacheHash } from "./embedding-cache.js";
import { embeddingMetricsCollector } from "../embedding-metrics.js";
import type { EmbeddingProfile } from "../types.js";

const DEFAULT_BATCH_MAX_ITEMS = 64;
const DEFAULT_BATCH_MAX_ESTIMATED_TOKENS = 6_000;
const DEFAULT_BATCH_CONCURRENCY = 4;
const DEFAULT_BROKER_WINDOW_MS = 20;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

type EmbeddingBatch = {
  items: Array<{
    originalIndex: number;
    text: string;
    estimatedTokens: number;
  }>;
  estimatedTokens: number;
};

type BrokerWaiter = {
  resolve: (vector: number[]) => void;
  reject: (error: Error) => void;
};

type PendingEmbeddingItem = {
  text: string;
  waiters: BrokerWaiter[];
};

type ProfileQueue = {
  profile: EmbeddingProfile;
  pendingOrder: string[];
  pendingItems: Map<string, PendingEmbeddingItem>;
  timer: NodeJS.Timeout | null;
  flushing: boolean;
  idleTimer: NodeJS.Timeout | null;
};

export class EmbeddingBatchBroker {
  private readonly queues = new Map<string, ProfileQueue>();
  private readonly inflightFlushes = new Set<Promise<void>>();

  async embedBatch(profile: EmbeddingProfile, texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const promises = texts.map((text) => this.enqueue(profile, text));
    return Promise.all(promises);
  }

  async shutdown(): Promise<void> {
    for (const queue of this.queues.values()) {
      if (queue.timer) {
        clearTimeout(queue.timer);
        queue.timer = null;
      }
      if (queue.idleTimer) {
        clearTimeout(queue.idleTimer);
        queue.idleTimer = null;
      }
      if (queue.pendingOrder.length > 0) {
        void this.flush(queue);
      }
    }
    await Promise.all([...this.inflightFlushes]);
  }

  private enqueue(profile: EmbeddingProfile, text: string): Promise<number[]> {
    const queue = this.getQueue(profile);
    const contentHash = embeddingCacheHash(text);

    return new Promise<number[]>((resolve, reject) => {
      const waiter: BrokerWaiter = {
        resolve,
        reject: (error) => reject(error)
      };

      const current = queue.pendingItems.get(contentHash);
      if (current) {
        current.waiters.push(waiter);
      } else {
        queue.pendingOrder.push(contentHash);
        queue.pendingItems.set(contentHash, {
          text,
          waiters: [waiter]
        });
      }

      this.scheduleFlush(queue);
    });
  }

  private getQueue(profile: EmbeddingProfile): ProfileQueue {
    const profileKey = buildEmbeddingProfileCacheKey(profile);
    const existing = this.queues.get(profileKey);
    if (existing) {
      return existing;
    }

    const queue: ProfileQueue = {
      profile,
      pendingOrder: [],
      pendingItems: new Map(),
      timer: null,
      flushing: false,
      idleTimer: null
    };
    this.queues.set(profileKey, queue);
    return queue;
  }

  private scheduleFlush(queue: ProfileQueue): void {
    if (queue.timer) {
      return;
    }

    queue.timer = setTimeout(() => {
      queue.timer = null;
      void this.flush(queue);
    }, getBrokerWindowMs());
    queue.timer.unref();
  }

  private async flush(queue: ProfileQueue): Promise<void> {
    if (queue.flushing) {
      this.scheduleFlush(queue);
      return;
    }

    if (queue.pendingOrder.length === 0) {
      return;
    }

    queue.flushing = true;
    if (queue.idleTimer) {
      clearTimeout(queue.idleTimer);
      queue.idleTimer = null;
    }
    const snapshot = takePendingSnapshot(queue);

    const doFlush = async (): Promise<void> => {
      try {
        const client = createEmbeddingClient(queue.profile);
        const batches = createEmbeddingBatches(snapshot.items.map((item) => item.text));

        await runWithConcurrency(batches, getBatchConcurrency(), async (batch) => {
          try {
            embeddingMetricsCollector.recordProviderCalls(1);
            const response = await client.embeddings.create({
              model: queue.profile.model!,
              input: batch.items.map((item) => item.text)
            });

            const vectors = response.data
              .slice()
              .sort((left, right) => left.index - right.index)
              .map((item) => item.embedding);

            if (vectors.length !== batch.items.length) {
              throw new Error(
                `Embedding profile "${queue.profile.name}" returned ${vectors.length} vectors for ${batch.items.length} inputs.`
              );
            }

            batch.items.forEach((item, index) => {
              const vector = vectors[index];
              if (!vector || vector.length === 0) {
                throw new Error(`Embedding profile "${queue.profile.name}" returned an empty vector.`);
              }

              const pendingItem = snapshot.items[item.originalIndex];
              for (const waiter of pendingItem.waiters) {
                waiter.resolve(vector);
              }
            });
          } catch (error) {
            const safeError = error instanceof Error ? error : new Error(String(error));
            for (const item of batch.items) {
              const pendingItem = snapshot.items[item.originalIndex];
              for (const waiter of pendingItem.waiters) {
                waiter.reject(safeError);
              }
            }
          }
        });
      } finally {
        queue.flushing = false;
        if (queue.pendingOrder.length > 0) {
          this.scheduleFlush(queue);
        } else {
          this.scheduleIdleRelease(queue);
        }
        this.inflightFlushes.delete(flushPromise);
      }
    };

    const flushPromise = doFlush();
    this.inflightFlushes.add(flushPromise);
  }

  private scheduleIdleRelease(queue: ProfileQueue): void {
    if (queue.idleTimer) {
      return;
    }

    queue.idleTimer = setTimeout(() => {
      queue.idleTimer = null;
      const profileKey = buildEmbeddingProfileCacheKey(queue.profile);
      if (queue.pendingOrder.length === 0 && !queue.flushing) {
        this.queues.delete(profileKey);
      }
    }, getIdleTimeoutMs());
    queue.idleTimer.unref();
  }
}

export const sharedEmbeddingBatchBroker = new EmbeddingBatchBroker();

export function createEmbeddingBatches(texts: string[]): EmbeddingBatch[] {
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

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
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

export function estimateEmbeddingTokens(text: string): number {
  if (text.length === 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildEmbeddingProfileCacheKey(profile: EmbeddingProfile): string {
  return [
    profile.name,
    profile.kind,
    profile.model ?? "",
    profile.baseUrl ?? "",
    String(profile.dimensions)
  ].join("|");
}

function takePendingSnapshot(queue: ProfileQueue): { items: PendingEmbeddingItem[] } {
  const items = queue.pendingOrder
    .map((key) => queue.pendingItems.get(key))
    .filter((item): item is PendingEmbeddingItem => Boolean(item));

  queue.pendingOrder = [];
  queue.pendingItems = new Map();
  return { items };
}

function createEmbeddingClient(profile: EmbeddingProfile): OpenAI {
  if (!profile.model || !profile.baseUrl || !profile.apiKeyEnv) {
    throw new Error(`Embedding profile "${profile.name}" is missing model/baseUrl/apiKeyEnv.`);
  }

  const apiKey = process.env[profile.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Environment variable ${profile.apiKeyEnv} is required for embedding profile "${profile.name}".`);
  }

  return new OpenAI({
    apiKey,
    baseURL: profile.baseUrl
  });
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

function getBrokerWindowMs(): number {
  return parsePositiveInt(process.env.MIND_KEEPER_EMBED_BROKER_WINDOW_MS, DEFAULT_BROKER_WINDOW_MS);
}

function getIdleTimeoutMs(): number {
  return parsePositiveInt(process.env.MIND_KEEPER_EMBED_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS);
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
