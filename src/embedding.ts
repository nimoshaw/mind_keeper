import crypto from "node:crypto";
import OpenAI from "openai";
import type { EmbeddingProfile } from "./types.js";

export class EmbeddingService {
  async embed(profile: EmbeddingProfile, text: string): Promise<number[]> {
    if (profile.kind === "hash") {
      return hashEmbedding(text, profile.dimensions);
    }

    if (!profile.model || !profile.baseUrl || !profile.apiKeyEnv) {
      throw new Error(`Embedding profile "${profile.name}" is missing model/baseUrl/apiKeyEnv.`);
    }

    const apiKey = process.env[profile.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Environment variable ${profile.apiKeyEnv} is required for embedding profile "${profile.name}".`);
    }

    const client = new OpenAI({
      apiKey,
      baseURL: profile.baseUrl
    });

    const response = await client.embeddings.create({
      model: profile.model,
      input: text
    });

    const vector = response.data[0]?.embedding;
    if (!vector || vector.length === 0) {
      throw new Error(`Embedding profile "${profile.name}" returned an empty vector.`);
    }

    return vector;
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
