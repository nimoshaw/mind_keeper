/**
 * End-to-end integration test for the full VCP vectorization pipeline
 * using a real local Qwen3-Embedding-8B model.
 *
 * Requires: MIND_KEEPER_EMBEDDING_API_KEY env var set, local model server running.
 *
 * Exercises: EmbeddingService → EmbeddingBatchBroker → OpenAI API
 *            + EmbeddingCache (SQLite) + VectorizationScheduler
 *            + EmbeddingMetrics
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EmbeddingService } from "../src/embedding.js";
import { EmbeddingBatchBroker } from "../src/app/embedding-batch-broker.js";
import { VectorizationScheduler } from "../src/app/vectorization-scheduler.js";
import { embeddingMetricsCollector } from "../src/embedding-metrics.js";
import type { EmbeddingProfile } from "../src/types.js";

const PROFILE: EmbeddingProfile = {
  name: "qwen3-8b",
  kind: "openai_compatible",
  dimensions: 4096,
  model: "Qwen/Qwen3-Embedding-8B",
  baseUrl: "http://localhost:3000/v1",
  apiKeyEnv: "MIND_KEEPER_EMBEDDING_API_KEY"
};

const TEXTS = [
  "Mind Keeper is a local-first project-scoped memory MCP for IDE workflows.",
  "VCP's vectorization pipeline uses token-aware batching and bounded concurrency.",
  "The embedding cache reuses vectors by profile identity plus normalized content hash.",
  "Flash memory should remain lightweight and never block context_for_task.",
  "Mind Keeper is a local-first project-scoped memory MCP for IDE workflows.",  // duplicate
];

async function main() {
  const apiKey = process.env.MIND_KEEPER_EMBEDDING_API_KEY;
  if (!apiKey) {
    console.log("⏭  Skipping: MIND_KEEPER_EMBEDDING_API_KEY not set");
    process.exit(0);
  }

  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mk-e2e-qwen-"));
  console.log(`📁 Temp project: ${projectRoot}`);

  try {
    embeddingMetricsCollector.setEnabled(true);
    embeddingMetricsCollector.reset();

    // ── Phase 1: Direct embedBatch (broker + cache) ──────────────────
    console.log("\n── Phase 1: embedBatch (first call, cold cache) ──");
    const service = new EmbeddingService();
    const t0 = performance.now();
    const result1 = await service.embedBatch(PROFILE, TEXTS, { projectRoot });
    const t1 = performance.now();
    const snap1 = embeddingMetricsCollector.snapshot();

    assert.equal(result1.length, TEXTS.length);
    for (const vec of result1) {
      assert.equal(vec.length, PROFILE.dimensions);
    }
    // Duplicate texts should yield identical vectors
    assert.deepEqual(result1[0], result1[4]);

    console.log(`  ✔ ${result1.length} vectors returned, dim=${result1[0].length}`);
    console.log(`  ⏱ ${(t1 - t0).toFixed(1)}ms`);
    console.log(`  📊 provider calls: ${snap1.providerCallCount}, cache hits: ${snap1.cacheHits}, misses: ${snap1.cacheMisses}`);

    // ── Phase 2: Same texts, warm cache ──────────────────────────────
    console.log("\n── Phase 2: embedBatch (same texts, warm cache) ──");
    embeddingMetricsCollector.reset();
    const t2 = performance.now();
    const result2 = await service.embedBatch(PROFILE, TEXTS, { projectRoot });
    const t3 = performance.now();
    const snap2 = embeddingMetricsCollector.snapshot();

    assert.deepEqual(result1, result2);
    assert.equal(snap2.cacheHits, TEXTS.length);
    assert.equal(snap2.providerCallCount, 0);

    console.log(`  ✔ All ${snap2.cacheHits} texts served from cache, 0 provider calls`);
    console.log(`  ⏱ ${(t3 - t2).toFixed(1)}ms (should be much faster)`);

    // ── Phase 3: VectorizationScheduler ──────────────────────────────
    console.log("\n── Phase 3: VectorizationScheduler (debounce aggregation) ──");
    embeddingMetricsCollector.reset();
    const broker = new EmbeddingBatchBroker();
    const scheduler = new VectorizationScheduler({
      broker,
      windowMs: 200,
      maxWindowMs: 800,
      flushItemThreshold: 10,
      flushTokenThreshold: 5000
    });

    const newTexts = [
      "The scheduler aggregates concurrent requests within a time window.",
      "Token-budget-aware flush triggers early when thresholds are met."
    ];
    const t4 = performance.now();
    const [sched1, sched2] = await Promise.all([
      scheduler.schedule(PROFILE, [newTexts[0]]),
      scheduler.schedule(PROFILE, [newTexts[1]])
    ]);
    const t5 = performance.now();

    assert.equal(sched1.length, 1);
    assert.equal(sched2.length, 1);
    assert.equal(sched1[0].length, PROFILE.dimensions);
    assert.equal(sched2[0].length, PROFILE.dimensions);

    console.log(`  ✔ Scheduler returned ${sched1.length + sched2.length} vectors`);
    console.log(`  ⏱ ${(t5 - t4).toFixed(1)}ms`);

    // ── Phase 4: Broker shutdown ─────────────────────────────────────
    console.log("\n── Phase 4: Broker shutdown ──");
    await broker.shutdown();
    console.log("  ✔ Broker shutdown completed cleanly");

    // ── Summary ──────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════════════");
    console.log("✅ All phases passed. VCP vectorization pipeline is working end-to-end.");
    console.log("══════════════════════════════════════════════════\n");

  } finally {
    embeddingMetricsCollector.reset();
    embeddingMetricsCollector.setEnabled(false);
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("❌ Integration test failed:", error);
  process.exit(1);
});
