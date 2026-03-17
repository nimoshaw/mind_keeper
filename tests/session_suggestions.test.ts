import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("suggest_session_memory recommends decision when the session contains clear policy signals", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-session-suggest-decision-"));
  const service = new MindKeeperService();

  try {
    const result = await service.suggestSessionMemory({
      projectRoot,
      moduleName: "retrieval",
      sessionText: [
        "We decided to keep branch_name as a ranking perspective instead of a hard filter.",
        "Prefer exact branch first, sibling branch second, and cross-branch recall with a penalty.",
        "This should become the default policy for branch-aware memory views.",
        "Need to document the new behavior in README and MCP docs."
      ].join("\n")
    });

    assert.equal(result.shouldPersist, true);
    assert.equal(result.recommendedKind, "decision");
    assert.equal(result.recommendedTier, "stable");
    assert.ok((result.stabilityScore ?? 0) >= 0.8);
    assert.ok(result.confidence >= 0.5);
    assert.ok(result.reasons.some((item) => /durable decision language/i.test(item)));
    assert.ok(result.tags.includes("decision"));
    assert.ok(result.tags.includes("retrieval"));
    assert.equal(result.alternatives[0]?.kind, "decision");
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("suggest_session_memory recommends diary for implementation-heavy progress notes", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-session-suggest-diary-"));
  const service = new MindKeeperService();

  try {
    const result = await service.suggestSessionMemory({
      projectRoot,
      sessionText: [
        "Implemented token-budget trimming for context_for_task.",
        "Added regression tests for omittedByTokenBudget and usedTokenBudgetGate.",
        "Updated docs and verified npm run check, npm test, and npm run build.",
        "Next: benchmark larger project trees."
      ].join("\n")
    });

    assert.equal(result.shouldPersist, true);
    assert.equal(result.recommendedKind, "diary");
    assert.equal(result.recommendedTier, "working");
    assert.ok(result.confidence >= 0.45);
    assert.ok(result.reasons.some((item) => /implementation progress/i.test(item)));
    assert.ok(result.tags.includes("diary"));
    assert.ok(result.followUps.length >= 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("suggest_session_memory can promote reusable notes into stable knowledge", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-session-suggest-knowledge-"));
  const service = new MindKeeperService();

  try {
    const result = await service.suggestSessionMemory({
      projectRoot,
      moduleName: "retrieval",
      sessionText: [
        "Checklist: when branch-aware recall looks wrong, inspect exact branch first, then sibling branch, then cross-branch penalties.",
        "This is a reusable debugging guideline for retrieval regressions.",
        "Keep this runbook near the project docs."
      ].join("\n")
    });

    assert.equal(result.shouldPersist, true);
    assert.equal(result.recommendedKind, "knowledge");
    assert.equal(result.recommendedTier, "stable");
    assert.ok(result.stabilityScore >= 0.7);
    assert.ok(result.tags.includes("knowledge"));
    assert.ok(result.reasons.some((item) => /reusable guidance|pitfall-like content/i.test(item)));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("summarize_session can discard low-signal notes instead of polluting long-term memory", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-session-discard-"));
  const service = new MindKeeperService();

  try {
    const result = await service.summarizeSession({
      projectRoot,
      title: "Scratch notes",
      sessionText: [
        "maybe",
        "tmp scratch"
      ].join("\n")
    });

    assert.equal(result.persisted, false);
    assert.equal(result.kind, "discard");
    assert.equal(result.docId, null);
    assert.ok(result.discardReason);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
