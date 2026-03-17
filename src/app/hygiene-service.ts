import fs from "node:fs/promises";
import { ensureProjectScaffold } from "../project.js";
import { MindKeeperStorage } from "../storage.js";
import type { RememberDecisionInput, RememberInput } from "../types.js";

type RememberResult = { docId: string; chunkCount: number; path: string };

type HygieneRememberers = {
  remember: (input: RememberInput) => Promise<RememberResult>;
  rememberDecision: (input: RememberDecisionInput) => Promise<RememberResult>;
};

export class HygieneService {
  constructor(private readonly rememberers: HygieneRememberers) {}

  async archiveStaleMemories(input: {
    projectRoot: string;
    olderThanDays?: number;
    sourceKinds?: Array<"diary" | "imported">;
    noisyOnly?: boolean;
  }): Promise<{
    archivedCount: number;
    scannedCount: number;
    docIds: string[];
    reason: string;
  }> {
    await ensureProjectScaffold(input.projectRoot);
    const olderThanDays = Math.max(1, input.olderThanDays ?? 45);
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const sourceKinds = input.sourceKinds?.length ? input.sourceKinds : ["diary", "imported"];

    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const candidates = storage.listSources().filter((item) => {
        if (!sourceKinds.includes(item.sourceKind as "diary" | "imported")) {
          return false;
        }
        if (item.updatedAt > cutoff) {
          return false;
        }
        if (input.noisyOnly && item.noisyVotes <= item.helpfulVotes) {
          return false;
        }
        return true;
      });

      for (const candidate of candidates) {
        storage.updateDocumentMetadata({
          docId: candidate.docId,
          memoryTier: "cold",
          stabilityScore: candidate.sourceKind === "diary" ? 0.24 : 0.33,
          distillReason: `Archived as stale memory after ${olderThanDays} days without recent activity.`
        });
      }

      return {
        archivedCount: candidates.length,
        scannedCount: storage.listSources().filter((item) => sourceKinds.includes(item.sourceKind as "diary" | "imported")).length,
        docIds: candidates.map((item) => item.docId),
        reason: candidates.length > 0
          ? `Archived ${candidates.length} stale memories into the cold tier.`
          : "No stale memories matched the archive policy."
      };
    } finally {
      storage.close();
    }
  }

  async listConflicts(input: {
    projectRoot: string;
    topK?: number;
  }): Promise<Array<{
    leftDocId: string;
    rightDocId: string;
    leftTitle: string | null;
    rightTitle: string | null;
    subject: string;
    score: number;
    reason: string;
  }>> {
    await ensureProjectScaffold(input.projectRoot);
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const decisions = storage.listSources().filter((item) => item.sourceKind === "decision");
      const contents = new Map<string, string>();
      await Promise.all(decisions.map(async (item) => {
        contents.set(item.docId, await safeReadText(item.path));
      }));

      const conflicts: Array<{
        leftDocId: string;
        rightDocId: string;
        leftTitle: string | null;
        rightTitle: string | null;
        subject: string;
        score: number;
        reason: string;
      }> = [];

      for (let i = 0; i < decisions.length; i += 1) {
        for (let j = i + 1; j < decisions.length; j += 1) {
          const left = decisions[i];
          const right = decisions[j];
          const leftClaims = extractDecisionClaims(`${left.title ?? ""}\n${contents.get(left.docId) ?? ""}`);
          const rightClaims = extractDecisionClaims(`${right.title ?? ""}\n${contents.get(right.docId) ?? ""}`);
          for (const leftClaim of leftClaims) {
            for (const rightClaim of rightClaims) {
              if (leftClaim.subject !== rightClaim.subject || leftClaim.polarity === rightClaim.polarity) {
                continue;
              }
              const overlapBoost = overlappingTags(left.path, right.path) ? 0.08 : 0;
              const score = Math.min(1, 0.62 + overlapBoost + leftClaim.confidence * 0.12 + rightClaim.confidence * 0.12);
              conflicts.push({
                leftDocId: left.docId,
                rightDocId: right.docId,
                leftTitle: left.title,
                rightTitle: right.title,
                subject: leftClaim.subject,
                score: round4(score),
                reason: `Opposing decision language detected around "${leftClaim.subject}".`
              });
            }
          }
        }
      }

      return conflicts
        .sort((left, right) => right.score - left.score)
        .slice(0, input.topK ?? 10);
    } finally {
      storage.close();
    }
  }

  async consolidateMemories(input: {
    projectRoot: string;
    docIds: string[];
    title: string;
    kind?: "knowledge" | "decision";
    moduleName?: string;
    tags?: string[];
    disableInputs?: boolean;
  }): Promise<{
    persisted: boolean;
    kind: "knowledge" | "decision";
    docId: string | null;
    chunkCount: number;
    path: string | null;
    sourceCount: number;
    disabledInputs: number;
  }> {
    await ensureProjectScaffold(input.projectRoot);
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const selected = storage.listSources().filter((item) => input.docIds.includes(item.docId));
      if (selected.length === 0) {
        return {
          persisted: false,
          kind: input.kind ?? "knowledge",
          docId: null,
          chunkCount: 0,
          path: null,
          sourceCount: 0,
          disabledInputs: 0
        };
      }

      const entries = await Promise.all(selected.map(async (item) => ({
        title: item.title ?? item.docId,
        sourceKind: item.sourceKind,
        content: await safeReadText(item.path)
      })));
      const kind = input.kind ?? inferConsolidationKind(selected.map((item) => item.sourceKind));
      const summary = summarizeConsolidation(entries);
      const tagSet = Array.from(new Set([...(input.tags ?? []), "consolidated"]));

      let result: RememberResult;
      if (kind === "decision") {
        result = await this.rememberers.rememberDecision({
          projectRoot: input.projectRoot,
          title: input.title,
          decision: summary.summary,
          rationale: summary.keyPoints.join("\n"),
          impact: `Consolidated from ${selected.length} memories.`,
          moduleName: input.moduleName,
          tags: tagSet
        });
      } else {
        result = await this.rememberers.remember({
          projectRoot: input.projectRoot,
          sourceKind: "manual",
          title: input.title,
          content: [
            `# ${input.title}`,
            "",
            "## Consolidated Knowledge",
            summary.summary,
            "",
            "## Key Points",
            ...summary.keyPoints.map((item) => `- ${item}`),
            "",
            "## Source Memories",
            ...selected.map((item) => `- ${item.title ?? item.docId}`)
          ].join("\n"),
          moduleName: input.moduleName,
          tags: tagSet,
          memoryTier: "stable",
          stabilityScore: 0.88,
          distillConfidence: 0.84,
          distillReason: `Consolidated from ${selected.length} related memories.`
        });
      }

      let disabledInputs = 0;
      if (input.disableInputs) {
        for (const item of selected) {
          storage.disableSource(item.docId, `Consolidated into ${result.docId}.`);
          disabledInputs += 1;
        }
      }

      return {
        persisted: true,
        kind,
        docId: result.docId,
        chunkCount: result.chunkCount,
        path: result.path,
        sourceCount: selected.length,
        disabledInputs
      };
    } finally {
      storage.close();
    }
  }
}

type DecisionClaim = {
  subject: string;
  polarity: "positive" | "negative";
  confidence: number;
};

function extractDecisionClaims(text: string): DecisionClaim[] {
  const normalized = text.toLowerCase();
  const patterns: Array<{ regex: RegExp; polarity: "positive" | "negative"; confidence: number }> = [
    { regex: /\b(?:prefer|use|choose|adopt|enable|default to|standardize on)\s+([a-z0-9_/-]+)/g, polarity: "positive", confidence: 0.9 },
    { regex: /\b(?:avoid|disable|deprecate|reject|do not use|don't use|never use|not use)\s+([a-z0-9_/-]+)/g, polarity: "negative", confidence: 0.9 }
  ];
  const claims = new Map<string, DecisionClaim>();

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern.regex)) {
      const subject = normalizeSubject(match[1]);
      if (!subject) {
        continue;
      }
      claims.set(`${pattern.polarity}:${subject}`, {
        subject,
        polarity: pattern.polarity,
        confidence: pattern.confidence
      });
    }
  }

  return Array.from(claims.values());
}

function normalizeSubject(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/[^\w/-]+/g, "")
    .toLowerCase();
  return normalized || null;
}

function summarizeConsolidation(entries: Array<{ title: string; sourceKind: string; content: string }>): {
  summary: string;
  keyPoints: string[];
} {
  const snippets = entries.map((entry) => {
    const firstLine = entry.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? entry.title;
    return `${entry.title}: ${firstLine.replace(/^#+\s*/, "")}`;
  });

  return {
    summary: `This memory consolidates ${entries.length} related notes into one reusable summary.`,
    keyPoints: snippets.slice(0, 8)
  };
}

function inferConsolidationKind(sourceKinds: string[]): "knowledge" | "decision" {
  return sourceKinds.includes("decision") ? "decision" : "knowledge";
}

function overlappingTags(leftPath: string, rightPath: string): boolean {
  const leftBase = leftPath.split(/[\\/]/).slice(-2).join("/").toLowerCase();
  const rightBase = rightPath.split(/[\\/]/).slice(-2).join("/").toLowerCase();
  return leftBase === rightBase;
}

async function safeReadText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
