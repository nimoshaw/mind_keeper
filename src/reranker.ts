import OpenAI from "openai";
import type { ChunkRecord, RerankerProfile } from "./types.js";

export class RerankerService {
  async score(profile: RerankerProfile, query: string, chunks: ChunkRecord[]): Promise<number[]> {
    if (chunks.length === 0) {
      return [];
    }

    if (profile.kind === "heuristic") {
      return chunks.map((chunk) => heuristicRerankScore(query, chunk));
    }

    if (!profile.model || !profile.baseUrl || !profile.apiKeyEnv) {
      throw new Error(`Reranker profile "${profile.name}" is missing model/baseUrl/apiKeyEnv.`);
    }

    const apiKey = process.env[profile.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Environment variable ${profile.apiKeyEnv} is required for reranker profile "${profile.name}".`);
    }

    const client = new OpenAI({
      apiKey,
      baseURL: profile.baseUrl
    });

    const snippets = chunks.map((chunk, index) =>
      [
        `[[CHUNK ${index}]]`,
        `path: ${chunk.path}`,
        `title: ${chunk.title ?? ""}`,
        `module: ${chunk.moduleName ?? ""}`,
        `language: ${chunk.language ?? ""}`,
        `symbol: ${chunk.symbol ?? ""}`,
        `content: ${truncate(chunk.content, profile.maxInputChars ?? 1600)}`
      ].join("\n")
    );

    const completion = await client.chat.completions.create({
      model: profile.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You score relevance for IDE memory retrieval. Return strict JSON with this shape: " +
            "{\"scores\":[{\"index\":0,\"score\":0.0}]}. Scores must be numbers from 0 to 1."
        },
        {
          role: "user",
          content: [
            `Query:\n${query}`,
            "",
            "Candidate chunks:",
            snippets.join("\n\n")
          ].join("\n")
        }
      ]
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) {
      throw new Error(`Reranker profile "${profile.name}" returned an empty response.`);
    }

    return parseScores(text, chunks.length);
  }
}

function heuristicRerankScore(query: string, chunk: ChunkRecord): number {
  const queryTokens = tokenize(query);
  const contentTokens = tokenize(chunk.content);
  const titleTokens = tokenize(chunk.title ?? "");
  const symbolTokens = tokenize(chunk.symbol ?? "");
  const moduleTokens = tokenize(chunk.moduleName ?? "");
  const pathTokens = tokenize(chunk.path);
  const tagTokens = chunk.tags.flatMap((tag) => tokenize(tag));

  const contentCoverage = coverage(queryTokens, contentTokens);
  const titleCoverage = coverage(queryTokens, titleTokens);
  const symbolCoverage = coverage(queryTokens, symbolTokens);
  const moduleCoverage = coverage(queryTokens, moduleTokens);
  const pathCoverage = coverage(queryTokens, pathTokens);
  const tagCoverage = coverage(queryTokens, tagTokens);
  const exactPhrase = longestInterestingPhrase(query);
  const exactContent = exactPhrase && chunk.content.toLowerCase().includes(exactPhrase.toLowerCase()) ? 1 : 0;

  // Tier signal: durable knowledge ranks higher
  const tierSignal =
    chunk.sourceKind === "decision" || chunk.sourceKind === "manual" ? 0.06
      : chunk.sourceKind === "project" ? 0.02
        : 0;

  // Recency signal: fresher memories rank higher
  const ageDays = chunk.updatedAt ? Math.max(0, (Date.now() - chunk.updatedAt) / (1000 * 60 * 60 * 24)) : 999;
  const recencySignal = ageDays <= 7 ? 0.04 : ageDays <= 30 ? 0.02 : 0;

  return Math.max(
    0,
    Math.min(
      1,
      exactContent * 0.25 +
        contentCoverage * 0.25 +
        titleCoverage * 0.13 +
        symbolCoverage * 0.13 +
        moduleCoverage * 0.07 +
        pathCoverage * 0.03 +
        tagCoverage * 0.04 +
        tierSignal +
        recencySignal
    )
  );
}

function parseScores(text: string, length: number): number[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Reranker response did not contain JSON.");
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    scores?: Array<{ index?: number; score?: number }>;
  };

  const output = new Array<number>(length).fill(0);
  for (const item of parsed.scores ?? []) {
    if (
      typeof item.index === "number" &&
      Number.isInteger(item.index) &&
      item.index >= 0 &&
      item.index < length &&
      typeof item.score === "number" &&
      Number.isFinite(item.score)
    ) {
      output[item.index] = Math.max(0, Math.min(1, item.score));
    }
  }

  return output;
}

function coverage(queryTokens: string[], candidateTokens: string[]): number {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }
  const set = new Set(candidateTokens);
  let hits = 0;
  for (const token of queryTokens) {
    if (set.has(token)) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}

function longestInterestingPhrase(query: string): string | null {
  const phrases = query
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/).length >= 3)
    .sort((a, b) => b.length - a.length);
  return phrases[0] ?? null;
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}
