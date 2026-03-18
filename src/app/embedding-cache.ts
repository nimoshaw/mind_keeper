import { sha1 } from "../memory-defaults.js";
import { MindKeeperStorage } from "../storage.js";

export class EmbeddingCacheService {
  getMany(projectRoot: string, profileKey: string, texts: string[]): Map<string, number[]> {
    if (texts.length === 0) {
      return new Map();
    }

    const hashes = texts.map((text) => embeddingCacheHash(text));
    const storage = new MindKeeperStorage(projectRoot);
    try {
      return storage.getEmbeddingCacheEntries(profileKey, hashes);
    } finally {
      storage.close();
    }
  }

  setMany(
    projectRoot: string,
    input: {
      profileKey: string;
      profileName: string;
      dimensions: number;
      entries: Array<{
        text: string;
        embedding: number[];
      }>;
    }
  ): void {
    if (input.entries.length === 0) {
      return;
    }

    const storage = new MindKeeperStorage(projectRoot);
    try {
      storage.upsertEmbeddingCacheEntries(
        input.entries.map((entry) => ({
          profileKey: input.profileKey,
          profileName: input.profileName,
          contentHash: embeddingCacheHash(entry.text),
          dimensions: input.dimensions,
          embedding: entry.embedding
        }))
      );
    } finally {
      storage.close();
    }
  }
}

export function normalizeEmbeddingText(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

export function embeddingCacheHash(input: string): string {
  return sha1(normalizeEmbeddingText(input));
}
