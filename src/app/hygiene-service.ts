import fs from "node:fs/promises";
import { ensureProjectScaffold } from "../project.js";
import { MindKeeperStorage, type MemorySourceRecord } from "../storage.js";
import type { MemorySourceKind, RememberDecisionInput, RememberInput } from "../types.js";

type RememberResult = { docId: string; chunkCount: number; path: string };

type HygieneRememberers = {
  remember: (input: RememberInput) => Promise<RememberResult>;
  rememberDecision: (input: RememberDecisionInput) => Promise<RememberResult>;
};

export class HygieneService {
  constructor(private readonly rememberers: HygieneRememberers) {}

  async suggestConsolidations(input: {
    projectRoot: string;
    topK?: number;
    minScore?: number;
    sourceKinds?: Array<Exclude<MemorySourceKind, "project">>;
    includeDisabled?: boolean;
  }): Promise<Array<{
    docIds: string[];
    titles: string[];
    suggestedTitle: string;
    suggestedKind: "knowledge" | "decision";
    score: number;
    reasons: string[];
  }>> {
    await ensureProjectScaffold(input.projectRoot);
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const allowedKinds = input.sourceKinds?.length
        ? input.sourceKinds
        : ["manual", "decision", "diary", "imported"];
      const candidates = storage
        .listSources()
        .filter((item) => allowedKinds.includes(item.sourceKind as Exclude<MemorySourceKind, "project">))
        .filter((item) => input.includeDisabled ? true : !item.isDisabled);

      if (candidates.length < 2) {
        return [];
      }

      const contents = new Map<string, string>();
      await Promise.all(candidates.map(async (item) => {
        contents.set(item.docId, await safeReadText(item.path));
      }));

      const pairSuggestions: PairSuggestion[] = [];
      const minScore = input.minScore ?? 0.44;
      for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
          const suggestion = scoreConsolidationPair(candidates[i], candidates[j], contents);
          if (suggestion.score >= minScore) {
            pairSuggestions.push(suggestion);
          }
        }
      }

      const grouped = buildConsolidationGroups(pairSuggestions, candidates)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.topK ?? 8)
        .map((group) => ({
          docIds: group.docIds,
          titles: group.titles,
          suggestedTitle: group.suggestedTitle,
          suggestedKind: group.suggestedKind,
          score: round4(group.score),
          reasons: group.reasons.slice(0, 4)
        }));

      return grouped;
    } finally {
      storage.close();
    }
  }

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

      return buildConflictPairs(decisions, contents)
        .sort((left, right) => right.score - left.score)
        .slice(0, input.topK ?? 10);
    } finally {
      storage.close();
    }
  }

  async listConflictClusters(input: {
    projectRoot: string;
    topK?: number;
  }): Promise<Array<{
    subject: string;
    docIds: string[];
    titles: string[];
    docCount: number;
    pairCount: number;
    score: number;
    reasons: string[];
    suggestedAction: string;
  }>> {
    await ensureProjectScaffold(input.projectRoot);
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const decisions = storage.listSources().filter((item) => item.sourceKind === "decision");
      return buildConflictClusters(decisions, await buildContentsMap(decisions))
        .sort((left, right) => right.score - left.score || right.docCount - left.docCount || right.pairCount - left.pairCount)
        .slice(0, input.topK ?? 8);
    } finally {
      storage.close();
    }
  }

  async suggestConflictResolutions(input: {
    projectRoot: string;
    topK?: number;
    minScore?: number;
    includeDisabled?: boolean;
  }): Promise<Array<{
    subject: string;
    docIds: string[];
    titles: string[];
    suggestedTitle: string;
    suggestedKind: "decision";
    suggestedTags: string[];
    score: number;
    reasons: string[];
    suggestedAction: string;
    disableInputsRecommended: boolean;
  }>> {
    await ensureProjectScaffold(input.projectRoot);
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const decisions = storage
        .listSources()
        .filter((item) => item.sourceKind === "decision")
        .filter((item) => input.includeDisabled ? true : !item.isDisabled);
      const contents = await buildContentsMap(decisions);
      const clusters = buildConflictClusters(decisions, contents);
      const minScore = input.minScore ?? 0.68;

      return clusters
        .filter((cluster) => cluster.score >= minScore)
        .map((cluster) => ({
          subject: cluster.subject,
          docIds: cluster.docIds,
          titles: cluster.titles,
          suggestedTitle: suggestConflictResolutionTitle(cluster),
          suggestedKind: "decision" as const,
          suggestedTags: Array.from(new Set(["conflict-resolution", cluster.subject, "decision-drift"])),
          score: round4(cluster.score + 0.04),
          reasons: dedupeReasons([
            ...cluster.reasons,
            `This cluster is strong enough to draft one canonical decision for "${cluster.subject}".`
          ]).slice(0, 5),
          suggestedAction: `Review this cluster, then run consolidate_memories with kind=decision to publish one canonical policy for "${cluster.subject}".`,
          disableInputsRecommended: cluster.docCount <= 5
        }))
        .sort((left, right) => right.score - left.score || right.docIds.length - left.docIds.length)
        .slice(0, input.topK ?? 6);
    } finally {
      storage.close();
    }
  }

  async planConflictResolutions(input: {
    projectRoot: string;
    topK?: number;
    minScore?: number;
    includeDisabled?: boolean;
  }): Promise<Array<{
    subject: string;
    docIds: string[];
    titles: string[];
    score: number;
    consolidateInput: {
      docIds: string[];
      title: string;
      kind: "decision";
      moduleName?: string;
      tags: string[];
      disableInputs: boolean;
    };
    rememberDecisionDraft: {
      title: string;
      decision: string;
      rationale: string;
      impact: string;
      moduleName?: string;
      tags: string[];
    };
  }>> {
    const suggestions = await this.suggestConflictResolutions(input);
    return suggestions.map((suggestion) => {
      const moduleName = inferModuleNameFromTitles(suggestion.titles);
      const tags = Array.from(new Set([
        ...suggestion.suggestedTags,
        moduleName ?? "project-memory"
      ]));

      return {
        subject: suggestion.subject,
        docIds: suggestion.docIds,
        titles: suggestion.titles,
        score: suggestion.score,
        consolidateInput: {
          docIds: suggestion.docIds,
          title: suggestion.suggestedTitle,
          kind: "decision",
          moduleName,
          tags,
          disableInputs: suggestion.disableInputsRecommended
        },
        rememberDecisionDraft: {
          title: suggestion.suggestedTitle,
          decision: `Adopt one canonical policy for ${humanizeSubject(suggestion.subject)} and retire conflicting guidance.`,
          rationale: [
            `Mind Keeper detected conflicting decision memories around ${humanizeSubject(suggestion.subject)}.`,
            `Source decisions: ${suggestion.titles.join("; ")}.`
          ].join(" "),
          impact: `After review, retrieval should prefer this canonical decision and older conflicting entries should be disabled or archived.`,
          moduleName,
          tags
        }
      };
    });
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

type PairSuggestion = {
  leftDocId: string;
  rightDocId: string;
  score: number;
  reasons: string[];
};

type ConflictPair = {
  leftDocId: string;
  rightDocId: string;
  leftTitle: string | null;
  rightTitle: string | null;
  subject: string;
  score: number;
  reason: string;
};

type ConflictCluster = {
  subject: string;
  docIds: string[];
  titles: string[];
  docCount: number;
  pairCount: number;
  score: number;
  reasons: string[];
  suggestedAction: string;
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

async function buildContentsMap(candidates: MemorySourceRecord[]): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  await Promise.all(candidates.map(async (item) => {
    contents.set(item.docId, await safeReadText(item.path));
  }));
  return contents;
}

function buildConflictPairs(
  decisions: MemorySourceRecord[],
  contents: Map<string, string>
): ConflictPair[] {
  const conflicts: ConflictPair[] = [];

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

  return conflicts;
}

function buildConflictClusters(
  decisions: MemorySourceRecord[],
  contents: Map<string, string>
): ConflictCluster[] {
  const conflictPairs = buildConflictPairs(decisions, contents);
  if (conflictPairs.length === 0) {
    return [];
  }

  const decisionMap = new Map(decisions.map((item) => [item.docId, item]));
  const grouped = new Map<string, ConflictPair[]>();
  for (const pair of conflictPairs) {
    const current = grouped.get(pair.subject) ?? [];
    current.push(pair);
    grouped.set(pair.subject, current);
  }

  return Array.from(grouped.entries()).map(([subject, pairs]) => {
    const docIds = Array.from(new Set(pairs.flatMap((pair) => [pair.leftDocId, pair.rightDocId])));
    const docs = docIds
      .map((docId) => decisionMap.get(docId))
      .filter((item): item is MemorySourceRecord => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const scoreBase = pairs.reduce((sum, pair) => sum + pair.score, 0) / pairs.length;
    const docSpreadBoost = Math.min(0.12, Math.max(0, docs.length - 2) * 0.05);
    const pairDensityBoost = Math.min(0.06, Math.max(0, pairs.length - 1) * 0.02);
    const reasons = dedupeReasons([
      `Multiple decisions disagree on "${subject}".`,
      ...pairs.map((pair) => pair.reason)
    ]);

    return {
      subject,
      docIds: docs.map((item) => item.docId),
      titles: docs.map((item) => item.title ?? item.docId),
      docCount: docs.length,
      pairCount: pairs.length,
      score: round4(Math.min(1, scoreBase + docSpreadBoost + pairDensityBoost)),
      reasons: reasons.slice(0, 5),
      suggestedAction: `Review and consolidate ${docs.length} conflicting decisions about "${subject}".`
    };
  });
}

function scoreConsolidationPair(
  left: MemorySourceRecord,
  right: MemorySourceRecord,
  contents: Map<string, string>
): PairSuggestion {
  const leftTitleTokens = tokenizeForConsolidation(left.title ?? left.docId);
  const rightTitleTokens = tokenizeForConsolidation(right.title ?? right.docId);
  const leftBodyTokens = tokenizeForConsolidation(contents.get(left.docId) ?? "");
  const rightBodyTokens = tokenizeForConsolidation(contents.get(right.docId) ?? "");

  const titleOverlap = jaccard(leftTitleTokens, rightTitleTokens);
  const bodyOverlap = jaccard(leftBodyTokens, rightBodyTokens);
  const sharedParent = parentBucket(left.path) === parentBucket(right.path);
  const sameKind = left.sourceKind === right.sourceKind;
  const sameTier = (left.memoryTier ?? null) === (right.memoryTier ?? null);
  const updatedDeltaDays = Math.abs(left.updatedAt - right.updatedAt) / (1000 * 60 * 60 * 24);
  const recencyCloseness = Math.max(0, 1 - updatedDeltaDays / 90);

  const score =
    titleOverlap * 0.36 +
    bodyOverlap * 0.34 +
    (sharedParent ? 0.12 : 0) +
    (sameKind ? 0.08 : 0) +
    (sameTier ? 0.04 : 0) +
    recencyCloseness * 0.06;

  const reasons: string[] = [];
  if (titleOverlap >= 0.2) {
    reasons.push("titles overlap around the same topic");
  }
  if (bodyOverlap >= 0.18) {
    reasons.push("content overlap suggests duplicated or adjacent guidance");
  }
  if (sharedParent) {
    reasons.push("both memories live in the same project area");
  }
  if (sameKind) {
    reasons.push(`both memories are ${left.sourceKind} notes`);
  }
  if (sameTier) {
    reasons.push(`both memories currently sit in the ${left.memoryTier ?? "unknown"} tier`);
  }

  return {
    leftDocId: left.docId,
    rightDocId: right.docId,
    score,
    reasons
  };
}

function buildConsolidationGroups(
  pairs: PairSuggestion[],
  candidates: MemorySourceRecord[]
): Array<{
  docIds: string[];
  titles: string[];
  suggestedTitle: string;
  suggestedKind: "knowledge" | "decision";
  score: number;
  reasons: string[];
}> {
  if (pairs.length === 0) {
    return [];
  }

  const neighborMap = new Map<string, Set<string>>();
  for (const pair of pairs) {
    addNeighbor(neighborMap, pair.leftDocId, pair.rightDocId);
    addNeighbor(neighborMap, pair.rightDocId, pair.leftDocId);
  }

  const candidateMap = new Map(candidates.map((item) => [item.docId, item]));
  const visited = new Set<string>();
  const groups: Array<{
    docIds: string[];
    titles: string[];
    suggestedTitle: string;
    suggestedKind: "knowledge" | "decision";
    score: number;
    reasons: string[];
  }> = [];

  for (const docId of neighborMap.keys()) {
    if (visited.has(docId)) {
      continue;
    }
    const component = collectComponent(docId, neighborMap, visited);
    if (component.length < 2) {
      continue;
    }

    const componentPairs = pairs.filter((pair) => component.includes(pair.leftDocId) && component.includes(pair.rightDocId));
    const docs = component
      .map((id) => candidateMap.get(id))
      .filter((item): item is MemorySourceRecord => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt);

    if (docs.length < 2) {
      continue;
    }

    groups.push({
      docIds: docs.map((item) => item.docId),
      titles: docs.map((item) => item.title ?? item.docId),
      suggestedTitle: suggestConsolidationTitle(docs),
      suggestedKind: docs.some((item) => item.sourceKind === "decision") ? "decision" : "knowledge",
      score: componentPairs.reduce((sum, pair) => sum + pair.score, 0) / componentPairs.length,
      reasons: dedupeReasons(componentPairs.flatMap((pair) => pair.reasons))
    });
  }

  return groups;
}

function addNeighbor(map: Map<string, Set<string>>, key: string, neighbor: string): void {
  const current = map.get(key) ?? new Set<string>();
  current.add(neighbor);
  map.set(key, current);
}

function collectComponent(
  start: string,
  neighbors: Map<string, Set<string>>,
  visited: Set<string>
): string[] {
  const queue = [start];
  const component: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    component.push(current);

    for (const next of neighbors.get(current) ?? []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return component;
}

function suggestConsolidationTitle(docs: MemorySourceRecord[]): string {
  const commonTokens = intersectTokenSets(
    docs.map((doc) => new Set(tokenizeForConsolidation(doc.title ?? doc.docId)))
  ).filter((token) => token.length >= 4);

  if (commonTokens.length > 0) {
    return `Consolidated ${commonTokens.slice(0, 3).join(" ")} guidance`;
  }

  const parent = parentBucket(docs[0].path);
  if (parent && parent !== ".") {
    return `Consolidated ${parent.replace(/[\\/]/g, " ")} guidance`;
  }

  return "Consolidated related memories";
}

function suggestConflictResolutionTitle(cluster: ConflictCluster): string {
  const normalizedSubject = cluster.subject.replace(/[-_/]+/g, " ").trim();
  if (normalizedSubject.length > 0) {
    return `Canonical ${normalizedSubject} decision`;
  }
  return "Canonical conflict resolution decision";
}

function dedupeReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const reason of reasons) {
    if (!reason || seen.has(reason)) {
      continue;
    }
    seen.add(reason);
    output.push(reason);
  }
  return output;
}

function inferModuleNameFromTitles(titles: string[]): string | undefined {
  const normalized = titles
    .flatMap((title) => tokenizeForConsolidation(title))
    .filter((token) => !["prefer", "avoid", "choose", "canonical", "decision", "policy", "do", "not", "use"].includes(token));
  const counts = new Map<string, number>();
  for (const token of normalized) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const winner = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)[0]?.[0];
  return winner && winner.length >= 4 ? winner : undefined;
}

function humanizeSubject(subject: string): string {
  return subject.replace(/[-_/]+/g, " ").trim();
}

function parentBucket(filePath: string): string {
  return filePath.split(/[\\/]/).slice(-2, -1)[0] ?? ".";
}

function tokenizeForConsolidation(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => token.length >= 3)
    .slice(0, 64);
}

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function intersectTokenSets(sets: Array<Set<string>>): string[] {
  if (sets.length === 0) {
    return [];
  }

  const [head, ...rest] = sets;
  const output: string[] = [];
  for (const token of head) {
    if (rest.every((set) => set.has(token))) {
      output.push(token);
    }
  }
  return output;
}
