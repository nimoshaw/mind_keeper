import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";
import { MindKeeperStorage } from "../src/storage.js";

test("archiveStaleMemories moves stale diary notes into the cold tier", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-archive-stale-"));
  const service = new MindKeeperService();

  try {
    const memory = await service.remember({
      projectRoot,
      sourceKind: "diary",
      title: "Old retrieval diary",
      content: "We tried an older retrieval experiment and do not need it in the hot working tier anymore.",
      tags: ["retrieval", "history"]
    });

    const storage = new MindKeeperStorage(projectRoot);
    storage.setDocumentUpdatedAt(memory.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    storage.close();

    const archived = await service.archiveStaleMemories({
      projectRoot,
      olderThanDays: 30
    });

    assert.equal(archived.archivedCount, 1);
    const listed = await service.listSources(projectRoot);
    const archivedSource = listed.find((item) => item.docId === memory.docId);
    assert.ok(archivedSource);
    assert.equal(archivedSource?.memoryTier, "cold");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("listConflicts detects opposing decisions on the same subject", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflicts-"));
  const service = new MindKeeperService();

  try {
    await service.rememberDecision({
      projectRoot,
      title: "Prefer hash-local embeddings",
      decision: "Prefer hash-local for local development.",
      moduleName: "retrieval",
      tags: ["embedding"]
    });
    await service.rememberDecision({
      projectRoot,
      title: "Do not use hash-local embeddings",
      decision: "Do not use hash-local in this workflow because the policy changed.",
      moduleName: "retrieval",
      tags: ["embedding"]
    });

    const conflicts = await service.listConflicts({
      projectRoot,
      topK: 5
    });

    assert.ok(conflicts.length >= 1);
    assert.ok(conflicts[0].subject.includes("hash-local"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("listConflictClusters groups related decision drift into one subject cluster", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-clusters-"));
  const service = new MindKeeperService();

  try {
    const first = await service.rememberDecision({
      projectRoot,
      title: "Prefer hash-local embeddings for local work",
      decision: "Prefer hash-local for local development and fast recall experiments.",
      moduleName: "retrieval",
      tags: ["embedding", "local"]
    });
    const second = await service.rememberDecision({
      projectRoot,
      title: "Do not use hash-local embeddings",
      decision: "Do not use hash-local in this workflow because the policy changed.",
      moduleName: "retrieval",
      tags: ["embedding", "policy"]
    });
    const third = await service.rememberDecision({
      projectRoot,
      title: "Choose hash-local during offline prototyping",
      decision: "Choose hash-local when running offline prototyping on this module.",
      moduleName: "retrieval",
      tags: ["embedding", "prototype"]
    });

    const clusters = await service.listConflictClusters({
      projectRoot,
      topK: 5
    });

    assert.ok(clusters.length >= 1);
    const top = clusters[0];
    assert.equal(top.subject, "hash-local");
    assert.equal(top.docCount, 3);
    assert.equal(top.pairCount, 2);
    assert.ok(top.docIds.includes(first.docId));
    assert.ok(top.docIds.includes(second.docId));
    assert.ok(top.docIds.includes(third.docId));
    assert.match(top.suggestedAction, /consolidate 3 conflicting decisions/i);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("suggestConflictResolutions turns a conflict cluster into a canonical decision candidate", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-resolution-"));
  const service = new MindKeeperService();

  try {
    const first = await service.rememberDecision({
      projectRoot,
      title: "Prefer hash-local embeddings for local work",
      decision: "Prefer hash-local for local development and fast recall experiments.",
      moduleName: "retrieval",
      tags: ["embedding", "local"]
    });
    const second = await service.rememberDecision({
      projectRoot,
      title: "Do not use hash-local embeddings",
      decision: "Do not use hash-local in this workflow because the policy changed.",
      moduleName: "retrieval",
      tags: ["embedding", "policy"]
    });
    const third = await service.rememberDecision({
      projectRoot,
      title: "Choose hash-local during offline prototyping",
      decision: "Choose hash-local when running offline prototyping on this module.",
      moduleName: "retrieval",
      tags: ["embedding", "prototype"]
    });

    const suggestions = await service.suggestConflictResolutions({
      projectRoot,
      topK: 5,
      minScore: 0.6
    });

    assert.ok(suggestions.length >= 1);
    const top = suggestions[0];
    assert.equal(top.subject, "hash-local");
    assert.equal(top.suggestedKind, "decision");
    assert.ok(top.docIds.includes(first.docId));
    assert.ok(top.docIds.includes(second.docId));
    assert.ok(top.docIds.includes(third.docId));
    assert.ok(top.suggestedTitle.toLowerCase().includes("hash local"));
    assert.ok(top.suggestedTags.includes("conflict-resolution"));
    assert.equal(top.disableInputsRecommended, true);
    assert.match(top.suggestedAction, /consolidate_memories/i);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("planConflictResolutions returns executable templates for consolidation and canonical decision drafting", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-plan-"));
  const service = new MindKeeperService();

  try {
    const first = await service.rememberDecision({
      projectRoot,
      title: "Prefer hash-local embeddings for local work",
      decision: "Prefer hash-local for local development and fast recall experiments.",
      moduleName: "retrieval",
      tags: ["embedding", "local"]
    });
    const second = await service.rememberDecision({
      projectRoot,
      title: "Do not use hash-local embeddings",
      decision: "Do not use hash-local in this workflow because the policy changed.",
      moduleName: "retrieval",
      tags: ["embedding", "policy"]
    });

    const plans = await service.planConflictResolutions({
      projectRoot,
      topK: 5,
      minScore: 0.6
    });

    assert.ok(plans.length >= 1);
    const top = plans[0];
    assert.equal(top.subject, "hash-local");
    assert.equal(top.consolidateInput.kind, "decision");
    assert.ok(top.consolidateInput.docIds.includes(first.docId));
    assert.ok(top.consolidateInput.docIds.includes(second.docId));
    assert.ok(top.consolidateInput.tags.includes("conflict-resolution"));
    assert.ok(top.rememberDecisionDraft.title.toLowerCase().includes("hash local"));
    assert.match(top.rememberDecisionDraft.decision, /canonical policy/i);
    assert.match(top.rememberDecisionDraft.impact, /retrieval should prefer/i);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("executeConflictResolutionPlan writes a canonical decision and can disable superseded inputs", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-execute-"));
  const service = new MindKeeperService();

  try {
    const first = await service.rememberDecision({
      projectRoot,
      title: "Prefer hash-local embeddings for local work",
      decision: "Prefer hash-local for local development and fast recall experiments.",
      moduleName: "retrieval",
      tags: ["embedding", "local"]
    });
    const second = await service.rememberDecision({
      projectRoot,
      title: "Do not use hash-local embeddings",
      decision: "Do not use hash-local in this workflow because the policy changed.",
      moduleName: "retrieval",
      tags: ["embedding", "policy"]
    });

    const plans = await service.planConflictResolutions({
      projectRoot,
      topK: 5,
      minScore: 0.6
    });
    const plan = plans[0];
    assert.ok(plan);

    const executed = await service.executeConflictResolutionPlan({
      projectRoot,
      docIds: plan.consolidateInput.docIds,
      title: plan.rememberDecisionDraft.title,
      decision: plan.rememberDecisionDraft.decision,
      rationale: plan.rememberDecisionDraft.rationale,
      impact: plan.rememberDecisionDraft.impact,
      moduleName: plan.rememberDecisionDraft.moduleName,
      tags: plan.rememberDecisionDraft.tags,
      disableInputs: true
    });

    assert.equal(executed.persisted, true);
    assert.ok(executed.docId);
    assert.equal(executed.disabledInputs, 2);

    const recallResults = await service.recall({
      projectRoot,
      query: "canonical hash local decision conflict resolution",
      topK: 8,
      minScore: 0
    });
    assert.ok(recallResults.some((item) => item.docId === executed.docId));

    const listed = await service.listSources(projectRoot);
    assert.equal(listed.filter((item) => [first.docId, second.docId].includes(item.docId) && item.isDisabled).length, 2);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("consolidateMemories merges related notes into stable knowledge and can disable inputs", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-consolidate-"));
  const service = new MindKeeperService();

  try {
    const one = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Context planner note",
      content: "Light wave recall should start from stable memory and stop early when enough context is present.",
      moduleName: "retrieval",
      tags: ["planner"]
    });
    const two = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Context planner follow-up",
      content: "Fast recall should stay on stable and project-local sources before deep expansion.",
      moduleName: "retrieval",
      tags: ["planner"]
    });

    const consolidated = await service.consolidateMemories({
      projectRoot,
      docIds: [one.docId, two.docId],
      title: "Consolidated context planner guidance",
      kind: "knowledge",
      moduleName: "retrieval",
      tags: ["planner", "retrieval"],
      disableInputs: true
    });

    assert.equal(consolidated.persisted, true);
    assert.equal(consolidated.kind, "knowledge");
    assert.equal(consolidated.disabledInputs, 2);

    const recallResults = await service.recall({
      projectRoot,
      query: "consolidated context planner guidance stable memory fast recall",
      topK: 6,
      minScore: 0
    });
    assert.ok(recallResults.some((item) => item.docId === consolidated.docId));

    const listed = await service.listSources(projectRoot);
    assert.equal(listed.filter((item) => [one.docId, two.docId].includes(item.docId) && item.isDisabled).length, 2);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("suggestConsolidations finds related notes before a manual consolidation step", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-suggest-consolidation-"));
  const service = new MindKeeperService();

  try {
    const one = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Planner early stop rule",
      content: "Light wave planner should stop early when stable memory and current file context are already enough.",
      moduleName: "retrieval",
      tags: ["planner", "wave"]
    });
    const two = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Planner early stop guidance",
      content: "Context assembly should stop after stable memory plus local project context when the budget is already satisfied.",
      moduleName: "retrieval",
      tags: ["planner", "context"]
    });
    await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Unrelated benchmark note",
      content: "Java parser benchmark numbers improved and should be tracked separately from retrieval planner rules.",
      moduleName: "quality",
      tags: ["benchmark"]
    });

    const suggestions = await service.suggestConsolidations({
      projectRoot,
      topK: 5,
      minScore: 0.35,
      sourceKinds: ["manual"]
    });

    assert.ok(suggestions.length >= 1);
    const top = suggestions[0];
    assert.ok(top.docIds.includes(one.docId));
    assert.ok(top.docIds.includes(two.docId));
    assert.equal(top.suggestedKind, "knowledge");
    assert.ok(top.score >= 0.35);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
