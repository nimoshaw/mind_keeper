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

test("reviewMemoryHealth summarizes stale, noisy, and conflicting cleanup hotspots", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-health-review-"));
  const service = new MindKeeperService();

  try {
    const staleDiary = await service.remember({
      projectRoot,
      sourceKind: "diary",
      title: "Old retrieval diary",
      content: "An old retrieval experiment that should cool down over time.",
      tags: ["retrieval", "history"]
    });
    const noisy = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Noisy retrieval note",
      content: "This note keeps getting marked noisy in review.",
      tags: ["retrieval", "noisy"]
    });
    await service.rateSource({ projectRoot, docId: noisy.docId, signal: "noisy" });
    await service.rateSource({ projectRoot, docId: noisy.docId, signal: "noisy" });

    await service.rememberDecision({
      projectRoot,
      title: "Prefer sqlite manifests",
      decision: "Prefer sqlite for manifests and project metadata.",
      moduleName: "storage",
      tags: ["sqlite", "storage"]
    });
    await service.rememberDecision({
      projectRoot,
      title: "Do not use sqlite manifests",
      decision: "Do not use sqlite for manifests and project metadata.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "conflict"]
    });

    const storage = new MindKeeperStorage(projectRoot);
    storage.setDocumentUpdatedAt(staleDiary.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    storage.close();

    const review = await service.reviewMemoryHealth({
      projectRoot,
      olderThanDays: 30,
      topK: 5
    });

    assert.ok(review.summary.staleCandidates >= 1);
    assert.ok(review.summary.noisyCandidates >= 1);
    assert.ok(review.summary.conflictClusters >= 1);
    assert.ok(review.recommendations.some((item) => item.action === "archive_stale_memories"));
    assert.ok(review.recommendations.some((item) => item.action === "disable_noisy_sources"));
    assert.ok(review.recommendations.some((item) => item.action === "review_conflicts"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("listStaleDecisions surfaces older superseded or conflict-prone decisions", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-stale-decisions-"));
  const service = new MindKeeperService();

  try {
    const oldA = await service.rememberDecision({
      projectRoot,
      title: "Prefer sqlite manifests",
      decision: "Prefer sqlite for manifests and project metadata.",
      moduleName: "storage",
      tags: ["sqlite", "storage"]
    });
    const oldB = await service.rememberDecision({
      projectRoot,
      title: "Do not use sqlite manifests",
      decision: "Do not use sqlite for manifests and project metadata.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "conflict"]
    });
    const canonical = await service.rememberDecision({
      projectRoot,
      title: "Canonical sqlite manifests decision",
      decision: "Use sqlite for manifests and project metadata as the canonical storage policy.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "canonical", "conflict-resolution"]
    });

    const storage = new MindKeeperStorage(projectRoot);
    storage.setDocumentUpdatedAt(oldA.docId, Date.now() - 120 * 24 * 60 * 60 * 1000);
    storage.setDocumentUpdatedAt(oldB.docId, Date.now() - 120 * 24 * 60 * 60 * 1000);
    storage.updateDocumentMetadata({
      docId: oldA.docId,
      stabilityScore: 0.18
    });
    storage.updateDocumentMetadata({
      docId: oldB.docId,
      stabilityScore: 0.2
    });
    storage.close();

    await service.markSuperseded({
      projectRoot,
      canonicalDocId: canonical.docId,
      supersededDocIds: [oldA.docId, oldB.docId]
    });

    const stale = await service.listStaleDecisions({
      projectRoot,
      olderThanDays: 30,
      topK: 5
    });

    assert.ok(stale.length >= 2);
    const docIds = stale.map((item) => item.docId);
    assert.ok(docIds.includes(oldA.docId));
    assert.ok(docIds.includes(oldB.docId));
    assert.ok(stale.some((item) => item.suggestedAction === "keep_cold" || item.suggestedAction === "mark_superseded"));
    assert.ok(stale.every((item) => item.reasons.length > 0));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("suggestMemoryCleanup combines health hotspots and stale decisions into one cleanup plan", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-cleanup-plan-"));
  const service = new MindKeeperService();

  try {
    const staleDiary = await service.remember({
      projectRoot,
      sourceKind: "diary",
      title: "Old rollout diary",
      content: "This is old rollout chatter that should be cooled down.",
      tags: ["rollout", "history"]
    });
    const noisy = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Noisy note",
      content: "This note has become noisy and should not dominate retrieval.",
      tags: ["noise"]
    });
    const oldDecision = await service.rememberDecision({
      projectRoot,
      title: "Temporary sqlite rollback",
      decision: "Temporarily avoid sqlite during one short-lived experiment.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "temporary"]
    });
    const newDecision = await service.rememberDecision({
      projectRoot,
      title: "Canonical sqlite manifests decision",
      decision: "Use sqlite for manifests and project metadata as the canonical storage policy.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "canonical", "conflict-resolution"]
    });

    await service.rateSource({ projectRoot, docId: noisy.docId, signal: "noisy" });
    await service.rateSource({ projectRoot, docId: noisy.docId, signal: "noisy" });

    const storage = new MindKeeperStorage(projectRoot);
    storage.setDocumentUpdatedAt(staleDiary.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    storage.setDocumentUpdatedAt(oldDecision.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    storage.updateDocumentMetadata({
      docId: oldDecision.docId,
      stabilityScore: 0.2
    });
    storage.close();

    await service.markSuperseded({
      projectRoot,
      canonicalDocId: newDecision.docId,
      supersededDocIds: [oldDecision.docId]
    });

    const cleanup = await service.suggestMemoryCleanup({
      projectRoot,
      olderThanDays: 30,
      topK: 5
    });

    assert.ok(cleanup.summary.recommendedActions >= 2);
    assert.ok(cleanup.summary.staleDecisionCandidates >= 1);
    assert.ok(cleanup.actions.some((item) => item.action === "archive_stale_memories"));
    assert.ok(cleanup.actions.some((item) => item.action === "disable_noisy_sources"));
    assert.ok(!cleanup.actions.some((item) => item.action === "healthy"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("markSuperseded cools and disables superseded decisions under a canonical decision", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-mark-superseded-"));
  const service = new MindKeeperService();

  try {
    const oldA = await service.rememberDecision({
      projectRoot,
      title: "Prefer sqlite manifests",
      decision: "Prefer sqlite for manifests and project metadata.",
      moduleName: "storage",
      tags: ["sqlite", "storage"]
    });
    const oldB = await service.rememberDecision({
      projectRoot,
      title: "Do not use sqlite manifests",
      decision: "Do not use sqlite for manifests and project metadata.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "conflict"]
    });
    const canonical = await service.rememberDecision({
      projectRoot,
      title: "Canonical conflict-resolution for sqlite manifests",
      decision: "Canonical conflict-resolution: adopt sqlite for manifests and project metadata.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "canonical", "conflict-resolution"]
    });

    const marked = await service.markSuperseded({
      projectRoot,
      canonicalDocId: canonical.docId,
      supersededDocIds: [oldA.docId, oldB.docId]
    });

    assert.equal(marked.updated, true);
    assert.equal(marked.supersededCount, 2);
    assert.equal(marked.disabledCount, 2);
    assert.equal(marked.cooledCount, 2);

    const listed = await service.listSources(projectRoot);
    const cooled = listed.filter((item) => [oldA.docId, oldB.docId].includes(item.docId));
    assert.equal(cooled.length, 2);
    assert.ok(cooled.every((item) => item.isDisabled));
    assert.ok(cooled.every((item) => item.memoryTier === "cold"));
    assert.ok(cooled.every((item) => /Superseded by canonical decision/i.test(item.distillReason ?? "")));
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

test("validateConflictResolutionPlan checks execution safety before writing a canonical decision", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-validate-"));
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

    const validation = await service.validateConflictResolutionPlan({
      projectRoot,
      docIds: [first.docId, second.docId],
      title: "Canonical hash local decision",
      decision: "Adopt one canonical policy for hash local and retire conflicting guidance.",
      disableInputs: true
    });

    assert.equal(validation.canExecute, true);
    assert.equal(validation.sourceCount, 2);
    assert.equal(validation.missingDocIds.length, 0);
    assert.equal(validation.warnings.length, 0);
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

    const verification = await service.verifyConflictResolutionExecution({
      projectRoot,
      canonicalDocId: executed.docId,
      supersededDocIds: [first.docId, second.docId]
    });
    assert.equal(verification.verified, true);
    assert.equal(verification.disabledSupersededCount, 2);
    assert.equal(verification.canonicalExists, true);
    assert.equal(verification.canonicalIsDecision, true);

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

test("suggestConflictResolutionFollowup recommends disable when superseded conflicts remain active", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-followup-disable-"));
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

    const executed = await service.executeConflictResolutionPlan({
      projectRoot,
      docIds: [first.docId, second.docId],
      title: "Canonical hash local decision",
      decision: "Adopt one canonical policy for hash local and retire conflicting guidance.",
      disableInputs: false
    });

    const followup = await service.suggestConflictResolutionFollowup({
      projectRoot,
      canonicalDocId: executed.docId ?? "",
      supersededDocIds: [first.docId, second.docId]
    });

    assert.equal(followup.recommendedAction, "disable");
    assert.equal(followup.expectedSupersededCount, 2);
    assert.equal(followup.disabledSupersededCount, 0);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("suggestConflictResolutionFollowup recommends archive when superseded conflicts are disabled and stale", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-followup-archive-"));
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

    const executed = await service.executeConflictResolutionPlan({
      projectRoot,
      docIds: [first.docId, second.docId],
      title: "Canonical hash local decision",
      decision: "Adopt one canonical policy for hash local and retire conflicting guidance.",
      disableInputs: true
    });

    const storage = new MindKeeperStorage(projectRoot);
    storage.setDocumentUpdatedAt(first.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    storage.setDocumentUpdatedAt(second.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    storage.close();

    const followup = await service.suggestConflictResolutionFollowup({
      projectRoot,
      canonicalDocId: executed.docId ?? "",
      supersededDocIds: [first.docId, second.docId],
      archiveAfterDays: 30
    });

    assert.equal(followup.recommendedAction, "archive");
    assert.equal(followup.archiveCandidateDocIds.length, 2);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("executeConflictResolutionFollowup disables active superseded decisions", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-followup-execute-disable-"));
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

    const executed = await service.executeConflictResolutionPlan({
      projectRoot,
      docIds: [first.docId, second.docId],
      title: "Canonical hash local decision",
      decision: "Adopt one canonical policy for hash local and retire conflicting guidance.",
      disableInputs: false
    });

    const followup = await service.executeConflictResolutionFollowup({
      projectRoot,
      canonicalDocId: executed.docId ?? "",
      supersededDocIds: [first.docId, second.docId]
    });

    assert.equal(followup.executed, true);
    assert.equal(followup.action, "disable");
    assert.equal(followup.disabledCount, 2);

    const listed = await service.listSources(projectRoot);
    assert.equal(listed.filter((item) => [first.docId, second.docId].includes(item.docId) && item.isDisabled).length, 2);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("executeConflictResolutionFollowup archives stale superseded decisions into the cold tier", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-followup-execute-archive-"));
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

    const executed = await service.executeConflictResolutionPlan({
      projectRoot,
      docIds: [first.docId, second.docId],
      title: "Canonical hash local decision",
      decision: "Adopt one canonical policy for hash local and retire conflicting guidance.",
      disableInputs: true
    });

    const storage = new MindKeeperStorage(projectRoot);
    storage.setDocumentUpdatedAt(first.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    storage.setDocumentUpdatedAt(second.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    storage.close();

    const followup = await service.executeConflictResolutionFollowup({
      projectRoot,
      canonicalDocId: executed.docId ?? "",
      supersededDocIds: [first.docId, second.docId],
      archiveAfterDays: 30
    });

    assert.equal(followup.executed, true);
    assert.equal(followup.action, "archive");
    assert.equal(followup.archivedCount, 2);

    const listed = await service.listSources(projectRoot);
    assert.equal(
      listed.filter((item) => [first.docId, second.docId].includes(item.docId) && item.memoryTier === "cold").length,
      2
    );
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
