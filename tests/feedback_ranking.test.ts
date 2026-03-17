import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("source feedback can down-rank noisy memories and up-rank helpful ones", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-feedback-ranking-"));
  const service = new MindKeeperService();

  try {
    const helpful = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Helpful diagnostics workflow",
      content: "Use diagnostics-aware context recall and inspect the current symbol before changing retrieval code.",
      tags: ["diagnostics", "retrieval"]
    });

    const noisy = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Noisy diagnostics workflow",
      content: "Use diagnostics-aware context recall and inspect the current symbol before changing retrieval code.",
      tags: ["diagnostics", "retrieval"]
    });

    const helpfulVote1 = await service.rateSource({
      projectRoot,
      docId: helpful.docId,
      signal: "helpful"
    });
    const helpfulVote2 = await service.rateSource({
      projectRoot,
      docId: helpful.docId,
      signal: "helpful"
    });
    const noisyVote1 = await service.rateSource({
      projectRoot,
      docId: noisy.docId,
      signal: "noisy"
    });
    const noisyVote2 = await service.rateSource({
      projectRoot,
      docId: noisy.docId,
      signal: "noisy"
    });

    const results = await service.recall({
      projectRoot,
      query: "diagnostics aware context recall current symbol retrieval code",
      topK: 5,
      minScore: 0,
      explain: true
    });

    const helpfulIndex = results.findIndex((item) => item.docId === helpful.docId);
    const noisyIndex = results.findIndex((item) => item.docId === noisy.docId);

    assert.ok(helpfulIndex >= 0);
    assert.ok(noisyIndex >= 0);
    assert.ok(helpfulIndex < noisyIndex);

    const helpfulResult = results[helpfulIndex];
    const noisyResult = results[noisyIndex];
    assert.ok((helpfulResult.scoreDetails?.feedbackBoost ?? 0) > 0);
    assert.ok((noisyResult.scoreDetails?.feedbackBoost ?? 0) < 0);
    assert.ok(helpfulResult.explainReasons?.includes("helpful feedback history"));
    assert.ok(noisyResult.explainReasons?.includes("noisy feedback penalty"));
    assert.equal(helpfulVote1.helpfulVotes, 1);
    assert.equal(helpfulVote2.helpfulVotes, 2);
    assert.equal(helpfulVote2.netFeedback, 2);
    assert.equal(noisyVote1.noisyVotes, 1);
    assert.equal(noisyVote2.noisyVotes, 2);
    assert.equal(noisyVote2.netFeedback, -2);

    const listed = await service.listSources(projectRoot);
    const helpfulSource = listed.find((item) => item.docId === helpful.docId);
    const noisySource = listed.find((item) => item.docId === noisy.docId);
    assert.equal(helpfulSource?.helpfulVotes, 2);
    assert.equal(helpfulSource?.noisyVotes, 0);
    assert.equal(noisySource?.helpfulVotes, 0);
    assert.equal(noisySource?.noisyVotes, 2);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("stale noisy memories decay faster than recent noisy ones", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-feedback-time-"));
  const service = new MindKeeperService();

  try {
    const helpful = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Recent helpful memory",
      content: "Use diagnostics-aware context recall and inspect the current symbol before changing retrieval code.",
      tags: ["diagnostics", "retrieval"]
    });

    const recentNoisy = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Recent noisy memory",
      content: "Use diagnostics-aware context recall and inspect the current symbol before changing retrieval code.",
      tags: ["diagnostics", "retrieval"]
    });

    const staleNoisy = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Stale noisy memory",
      content: "Use diagnostics-aware context recall and inspect the current symbol before changing retrieval code.",
      tags: ["diagnostics", "retrieval"]
    });

    await service.rateSource({ projectRoot, docId: helpful.docId, signal: "helpful" });
    await service.rateSource({ projectRoot, docId: helpful.docId, signal: "helpful" });
    await service.rateSource({ projectRoot, docId: recentNoisy.docId, signal: "noisy" });
    await service.rateSource({ projectRoot, docId: recentNoisy.docId, signal: "noisy" });
    await service.rateSource({ projectRoot, docId: staleNoisy.docId, signal: "noisy" });
    await service.rateSource({ projectRoot, docId: staleNoisy.docId, signal: "noisy" });

    const dbPath = path.join(projectRoot, ".mindkeeper", "vector", "mindkeeper.sqlite");
    const db = new Database(dbPath);
    try {
      const staleTs = Date.now() - 180 * 24 * 60 * 60 * 1000;
      db.prepare("UPDATE chunks SET updated_at = ? WHERE doc_id = ?").run(staleTs, staleNoisy.docId);
      db.prepare("UPDATE file_manifests SET updated_at = ? WHERE doc_id = ?").run(staleTs, staleNoisy.docId);
      db.prepare("UPDATE source_feedback SET last_feedback_at = ? WHERE doc_id = ?").run(staleTs, staleNoisy.docId);
    } finally {
      db.close();
    }

    const results = await service.recall({
      projectRoot,
      query: "diagnostics aware context recall current symbol retrieval code",
      topK: 6,
      minScore: 0,
      explain: true
    });

    const helpfulIndex = results.findIndex((item) => item.docId === helpful.docId);
    const recentNoisyIndex = results.findIndex((item) => item.docId === recentNoisy.docId);
    const staleNoisyIndex = results.findIndex((item) => item.docId === staleNoisy.docId);

    assert.ok(helpfulIndex >= 0);
    assert.ok(recentNoisyIndex >= 0);
    assert.ok(staleNoisyIndex >= 0);
    assert.ok(helpfulIndex < recentNoisyIndex);
    assert.ok(recentNoisyIndex < staleNoisyIndex);

    const recentNoisyResult = results[recentNoisyIndex];
    const staleNoisyResult = results[staleNoisyIndex];
    assert.ok((staleNoisyResult.scoreDetails?.feedbackBoost ?? 0) < (recentNoisyResult.scoreDetails?.feedbackBoost ?? 0));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
