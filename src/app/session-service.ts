import { distillSessionMemory, summarizeSessionText } from "../distiller.js";
import { ensureProjectScaffold } from "../project.js";
import type { DistilledMemoryKind, MemoryTier, RememberDecisionInput, RememberInput, SuggestSessionMemoryInput, SummarizeSessionInput } from "../types.js";

type RememberResult = { docId: string; chunkCount: number; path: string };

type SessionRememberers = {
  remember: (input: RememberInput) => Promise<RememberResult>;
  rememberDecision: (input: RememberDecisionInput) => Promise<RememberResult>;
};

export type SuggestSessionMemoryResult = {
  shouldPersist: boolean;
  recommendedKind: DistilledMemoryKind;
  confidence: number;
  recommendedTier: MemoryTier;
  stabilityScore: number;
  suggestedTitle: string;
  summary: string;
  keyPoints: string[];
  followUps: string[];
  tags: string[];
  reasons: string[];
  discardReason: string | null;
  alternatives: Array<{ kind: DistilledMemoryKind; score: number }>;
};

export type SummarizeSessionResult = {
  persisted: boolean;
  kind: DistilledMemoryKind;
  docId: string | null;
  chunkCount: number;
  path: string | null;
  memoryTier: MemoryTier;
  stabilityScore: number;
  distillConfidence: number;
  discardReason: string | null;
};

export class SessionService {
  constructor(private readonly rememberers: SessionRememberers) {}

  async suggestSessionMemory(input: SuggestSessionMemoryInput): Promise<SuggestSessionMemoryResult> {
    await ensureProjectScaffold(input.projectRoot);
    const summary = summarizeSessionText(input.sessionText);
    const suggestion = distillSessionMemory(summary, input.sessionText, input.title, input.moduleName);

    return {
      shouldPersist: suggestion.shouldPersist,
      recommendedKind: suggestion.recommendedKind,
      confidence: suggestion.confidence,
      recommendedTier: suggestion.recommendedTier,
      stabilityScore: suggestion.stabilityScore,
      suggestedTitle: suggestion.suggestedTitle,
      summary: summary.summary,
      keyPoints: summary.keyPoints,
      followUps: summary.followUps,
      tags: suggestion.tags,
      reasons: suggestion.reasons,
      discardReason: suggestion.discardReason,
      alternatives: suggestion.alternatives
    };
  }

  async summarizeSession(input: SummarizeSessionInput): Promise<SummarizeSessionResult> {
    const suggestion = await this.suggestSessionMemory(input);
    const chosenKind = input.kind ?? suggestion.recommendedKind;

    if (chosenKind === "discard" && !input.kind) {
      return {
        persisted: false,
        kind: "discard",
        docId: null,
        chunkCount: 0,
        path: null,
        memoryTier: suggestion.recommendedTier,
        stabilityScore: suggestion.stabilityScore,
        distillConfidence: suggestion.confidence,
        discardReason: suggestion.discardReason
      };
    }

    if (chosenKind === "decision") {
      const result = await this.rememberers.rememberDecision({
        projectRoot: input.projectRoot,
        title: input.title,
        decision: suggestion.summary,
        rationale: suggestion.keyPoints.join("\n"),
        impact: suggestion.followUps.join("\n"),
        moduleName: input.moduleName,
        tags: input.tags
      });

      return {
        persisted: true,
        kind: chosenKind,
        ...result,
        memoryTier: "stable",
        stabilityScore: 0.95,
        distillConfidence: suggestion.confidence,
        discardReason: null
      };
    }

    if (chosenKind === "knowledge") {
      const knowledgeContent = [
        `# ${input.title}`,
        "",
        "## Reusable Knowledge",
        suggestion.summary,
        "",
        ...(suggestion.keyPoints.length
          ? [
              "## Key Points",
              ...suggestion.keyPoints.map((item) => `- ${item}`),
              ""
            ]
          : []),
        ...(suggestion.followUps.length
          ? [
              "## Follow Ups",
              ...suggestion.followUps.map((item) => `- ${item}`),
              ""
            ]
          : [])
      ].join("\n");

      const result = await this.rememberers.remember({
        projectRoot: input.projectRoot,
        content: knowledgeContent,
        sourceKind: "manual",
        title: input.title,
        moduleName: input.moduleName,
        tags: dedupeStrings([...(input.tags ?? []), "knowledge"]),
        memoryTier: "stable",
        stabilityScore: Math.max(0.76, suggestion.stabilityScore),
        distillConfidence: suggestion.confidence,
        distillReason: suggestion.reasons[0] ?? "Distilled as reusable project knowledge."
      });

      return {
        persisted: true,
        kind: chosenKind,
        ...result,
        memoryTier: "stable",
        stabilityScore: Math.max(0.76, suggestion.stabilityScore),
        distillConfidence: suggestion.confidence,
        discardReason: null
      };
    }

    const diaryContent = [
      `# ${input.title}`,
      "",
      "## Session Summary",
      suggestion.summary,
      "",
      ...(suggestion.keyPoints.length
        ? [
            "## Key Points",
            ...suggestion.keyPoints.map((item) => `- ${item}`),
            ""
          ]
        : []),
      ...(suggestion.followUps.length
        ? [
            "## Follow Ups",
            ...suggestion.followUps.map((item) => `- ${item}`),
            ""
          ]
        : [])
    ].join("\n");

    const result = await this.rememberers.remember({
      projectRoot: input.projectRoot,
      content: diaryContent,
      sourceKind: "diary",
      title: input.title,
      moduleName: input.moduleName,
      tags: input.tags,
      memoryTier: "working",
      stabilityScore: Math.min(0.62, Math.max(0.4, suggestion.stabilityScore)),
      distillConfidence: suggestion.confidence,
      distillReason: suggestion.reasons[0] ?? "Distilled as implementation history."
    });

    return {
      persisted: true,
      kind: chosenKind,
      ...result,
      memoryTier: "working",
      stabilityScore: Math.min(0.62, Math.max(0.4, suggestion.stabilityScore)),
      distillConfidence: suggestion.confidence,
      discardReason: null
    };
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}
