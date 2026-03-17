import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("recall prefers stable knowledge over working diary when the content is otherwise similar", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-distiller-ranking-"));
  const service = new MindKeeperService();
  const content = "Use exact branch first, sibling branch second, and cross-branch recall with a penalty.";

  try {
    const knowledge = await service.summarizeSession({
      projectRoot,
      title: "Branch retrieval runbook",
      sessionText: [
        "Checklist: use exact branch first, sibling branch second, and cross-branch recall with a penalty.",
        "This is a reusable debugging guideline for retrieval regressions."
      ].join("\n")
    });

    const diary = await service.summarizeSession({
      projectRoot,
      title: "Branch retrieval progress",
      sessionText: [
        "Implemented exact branch first, sibling branch second, and cross-branch recall with a penalty.",
        "Updated tests and docs."
      ].join("\n")
    });

    assert.equal(knowledge.persisted, true);
    assert.equal(knowledge.kind, "knowledge");
    assert.equal(diary.persisted, true);
    assert.equal(diary.kind, "diary");

    const results = await service.recall({
      projectRoot,
      query: content,
      topK: 6,
      minScore: 0,
      explain: true
    });

    const knowledgeIndex = results.findIndex((item) => item.docId === knowledge.docId);
    const diaryIndex = results.findIndex((item) => item.docId === diary.docId);

    assert.ok(knowledgeIndex >= 0);
    assert.ok(diaryIndex >= 0);
    assert.ok(knowledgeIndex < diaryIndex);
    assert.equal(results[knowledgeIndex]?.memoryTier, "stable");
    assert.equal(results[diaryIndex]?.memoryTier, "working");
    assert.ok((results[knowledgeIndex]?.scoreDetails?.tierBoost ?? 0) > (results[diaryIndex]?.scoreDetails?.tierBoost ?? 0));
    assert.ok((results[knowledgeIndex]?.scoreDetails?.stabilityBoost ?? 0) > (results[diaryIndex]?.scoreDetails?.stabilityBoost ?? 0));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
