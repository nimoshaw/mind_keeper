import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { embeddingMetricsCollector } from "../src/embedding-metrics.js";
import { EmbeddingService } from "../src/embedding.js";
import { MindKeeperService } from "../src/mindkeeper.js";
import { ensureProjectScaffold } from "../src/project.js";

test("embedBatch returns the same hash vectors as repeated single-item embedding", async () => {
  const service = new EmbeddingService();
  const profile = defaultConfig("embedding-batch-test").embeddingProfiles.find((item) => item.name === "hash-local");

  assert.ok(profile);
  const texts = [
    "Mind Keeper keeps project memory local.",
    "Batch embedding should preserve output order.",
    "Flash memory should remain lightweight."
  ];

  const batch = await service.embedBatch(profile, texts);
  const singles = await Promise.all(texts.map((text) => service.embed(profile, text)));

  assert.equal(batch.length, texts.length);
  assert.deepEqual(batch, singles);
});

test("indexProject uses batch embedding for multi-chunk documents", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-embedding-batch-"));
  const docsDir = path.join(projectRoot, "docs");
  const service = new MindKeeperService();

  await fs.mkdir(docsDir, { recursive: true });
  await fs.writeFile(
    path.join(docsDir, "large-note.md"),
    [
      "# Large Note",
      "",
      "This document exists to force multiple chunks during indexing.",
      "",
      ...new Array(220).fill(
        "Mind Keeper should batch repeated chunk embeddings instead of issuing one logical provider call per chunk."
      )
    ].join("\n"),
    "utf8"
  );

  try {
    await ensureProjectScaffold(projectRoot);
    embeddingMetricsCollector.setEnabled(true);
    embeddingMetricsCollector.reset();

    const result = await service.indexProject(projectRoot, { force: true });
    const snapshot = embeddingMetricsCollector.snapshot();

    assert.ok(result.indexedFiles >= 1);
    assert.ok(snapshot.itemCount >= 2);
    assert.ok(snapshot.providerCallCount < snapshot.itemCount);
    assert.equal(snapshot.profileNames[0], "hash-local");
  } finally {
    embeddingMetricsCollector.reset();
    embeddingMetricsCollector.setEnabled(false);
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
