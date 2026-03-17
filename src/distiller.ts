import type { DistilledMemoryKind, MemoryTier } from "./types.js";

export interface SessionSummary {
  summary: string;
  keyPoints: string[];
  followUps: string[];
}

export interface DistilledMemorySuggestion {
  shouldPersist: boolean;
  recommendedKind: DistilledMemoryKind;
  confidence: number;
  recommendedTier: MemoryTier;
  stabilityScore: number;
  suggestedTitle: string;
  tags: string[];
  reasons: string[];
  discardReason: string | null;
  alternatives: Array<{ kind: DistilledMemoryKind; score: number }>;
}

export function summarizeSessionText(sessionText: string): SessionSummary {
  const lines = sessionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const summary = truncate(lines.slice(0, 4).join(" "), 320) || "Session summary unavailable.";
  const keyPoints = lines
    .filter((line) => /^[-*]/.test(line) || /fixed|added|changed|updated|implemented|decided|refactor|documented|standardized|codified/i.test(line))
    .map((line) => line.replace(/^[-*\s]+/, ""))
    .slice(0, 6);

  const followUps = lines
    .filter((line) => /todo|next|follow up|later|remaining|need to|should|plan to/i.test(line))
    .map((line) => line.replace(/^[-*\s]+/, ""))
    .slice(0, 6);

  return { summary, keyPoints, followUps };
}

export function distillSessionMemory(
  summary: SessionSummary,
  sessionText: string,
  title?: string,
  moduleName?: string
): DistilledMemorySuggestion {
  const normalized = sessionText.toLowerCase();
  const lineCount = sessionText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  const keyPointMatches = summary.keyPoints.length;
  const followUpMatches = summary.followUps.length;
  const decisionMatches = countMatches(normalized, [
    /decid/g,
    /prefer/g,
    /choose/g,
    /policy/g,
    /standard/g,
    /rule/g,
    /convention/g,
    /architecture/g,
    /default behavior/g
  ]);
  const knowledgeMatches = countMatches(normalized, [
    /guideline/g,
    /runbook/g,
    /checklist/g,
    /playbook/g,
    /pitfall/g,
    /gotcha/g,
    /reusable/g,
    /pattern/g,
    /best practice/g,
    /tip/g
  ]);
  const implementationMatches = countMatches(normalized, [
    /implemented/g,
    /added/g,
    /changed/g,
    /updated/g,
    /fixed/g,
    /refactor/g,
    /wired/g,
    /integrat/g,
    /tested/g,
    /verified/g
  ]);
  const noiseMatches = countMatches(normalized, [
    /\bwip\b/g,
    /\bscratch\b/g,
    /\btmp\b/g,
    /\bmaybe\b/g,
    /\btrying\b/g
  ]);

  const decisionScore = clamp01(
    0.22 +
    decisionMatches * 0.17 +
    keyPointMatches * 0.05 +
    followUpMatches * 0.05 +
    (moduleName ? 0.04 : 0)
  );
  const knowledgeScore = clamp01(
    0.18 +
    knowledgeMatches * 0.16 +
    keyPointMatches * 0.05 +
    (followUpMatches > 0 ? 0.02 : 0) +
    (moduleName ? 0.04 : 0)
  );
  const diaryScore = clamp01(
    0.18 +
    implementationMatches * 0.1 +
    followUpMatches * 0.08 +
    keyPointMatches * 0.04 +
    Math.min(0.12, lineCount / 40)
  );
  const discardScore = clamp01(
    0.16 +
    (lineCount <= 2 ? 0.16 : 0) +
    (keyPointMatches === 0 ? 0.14 : 0) +
    (decisionMatches === 0 && implementationMatches === 0 && knowledgeMatches === 0 ? 0.18 : 0) +
    noiseMatches * 0.08
  );

  const alternatives = sortAlternatives([
    { kind: "decision", score: round4(decisionScore) },
    { kind: "knowledge", score: round4(knowledgeScore) },
    { kind: "diary", score: round4(diaryScore) },
    { kind: "discard", score: round4(discardScore) }
  ]);
  const top = alternatives[0] ?? { kind: "discard" as const, score: 0 };
  const shouldPersist = top.kind !== "discard" && (top.score >= 0.45 || keyPointMatches >= 2 || followUpMatches >= 1);
  const recommendedKind = shouldPersist ? top.kind : "discard";
  const confidence = round4(top.score);

  const reasons: string[] = [];
  if (decisionMatches > 0) {
    reasons.push("Detected durable decision language such as policy, preference, or default behavior.");
  }
  if (knowledgeMatches > 0) {
    reasons.push("Detected reusable guidance or pitfall-like content that fits long-term project knowledge.");
  }
  if (implementationMatches > 0) {
    reasons.push("Detected implementation progress that is useful as project history.");
  }
  if (followUpMatches > 0) {
    reasons.push("Found explicit follow-ups or next steps worth preserving.");
  }
  if (keyPointMatches >= 2) {
    reasons.push("The notes already contain multiple concrete points, so a distilled memory would be high-signal.");
  }

  const discardReason = shouldPersist
    ? null
    : "The notes look too lightweight or noisy to justify a durable memory yet.";

  if (!shouldPersist && reasons.length === 0) {
    reasons.push("The notes are currently too thin to earn long-term storage.");
  } else if (reasons.length === 0) {
    reasons.push("The notes contain enough structured content to justify a compact memory.");
  }

  const titleKind = shouldPersist && recommendedKind !== "discard" ? recommendedKind : "diary";

  return {
    shouldPersist,
    recommendedKind,
    confidence,
    recommendedTier: inferMemoryTier(recommendedKind),
    stabilityScore: inferStabilityScore(recommendedKind, confidence),
    suggestedTitle: suggestSessionTitle(title, summary.summary, titleKind),
    tags: inferSessionTags(sessionText, moduleName, recommendedKind),
    reasons,
    discardReason,
    alternatives
  };
}

export function inferMemoryTier(kind: DistilledMemoryKind): MemoryTier {
  switch (kind) {
    case "decision":
    case "knowledge":
      return "stable";
    case "discard":
      return "cold";
    case "diary":
    default:
      return "working";
  }
}

export function inferStabilityScore(kind: DistilledMemoryKind, confidence: number): number {
  const base = kind === "decision"
    ? 0.9
    : kind === "knowledge"
      ? 0.8
      : kind === "diary"
        ? 0.46
        : 0.12;

  return round4(clamp01(base * 0.7 + confidence * 0.3));
}

function suggestSessionTitle(title: string | undefined, summary: string, kind: Exclude<DistilledMemoryKind, "discard">): string {
  if (title?.trim()) {
    return title.trim();
  }

  const compact = summary
    .replace(/[.#*_`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const prefix = kind === "decision" ? "Decision:" : kind === "knowledge" ? "Knowledge:" : "Session:";
  return truncate(`${prefix} ${compact}`, 80);
}

function inferSessionTags(sessionText: string, moduleName: string | undefined, kind: DistilledMemoryKind): string[] {
  const tags = new Set<string>();
  if (kind !== "discard") {
    tags.add(kind);
  }
  if (moduleName?.trim()) {
    tags.add(slugify(moduleName).replace(/^-+|-+$/g, ""));
  }

  const normalized = sessionText.toLowerCase();
  const candidates = [
    "retrieval",
    "diagnostics",
    "context",
    "indexing",
    "rerank",
    "memory",
    "branch",
    "docs",
    "testing",
    "benchmark",
    "workflow"
  ];
  for (const candidate of candidates) {
    if (normalized.includes(candidate)) {
      tags.add(candidate);
    }
  }

  return Array.from(tags).filter(Boolean).slice(0, 6);
}

function sortAlternatives(
  alternatives: Array<{ kind: DistilledMemoryKind; score: number }>
): Array<{ kind: DistilledMemoryKind; score: number }> {
  return [...alternatives].sort((left, right) => right.score - left.score);
}

function countMatches(input: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    total += Array.from(input.matchAll(pattern)).length;
  }
  return total;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
