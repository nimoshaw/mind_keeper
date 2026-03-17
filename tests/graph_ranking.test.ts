import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("recall explain includes relation boosts from lightweight memory graph edges", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-graph-ranking-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const graphFile = path.join(srcDir, "graph.ts");
  await fs.writeFile(
    graphFile,
    [
      "export function buildMemoryGraph(query: string) {",
      "  const explanation = 'memory graph relation planner context';",
      "  return `${query}:${explanation}`;",
      "}"
    ].join("\n"),
    "utf8"
  );

  const helperFile = path.join(srcDir, "helper.ts");
  await fs.writeFile(
    helperFile,
    [
      "export function helperContext(query: string) {",
      "  const explanation = 'memory graph relation planner context';",
      "  return `${query}:${explanation}`;",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });

    const results = await service.recall({
      projectRoot,
      query: "buildMemoryGraph relation planner context",
      relatedPaths: [graphFile],
      explain: true,
      topK: 5,
      minScore: 0
    });

    assert.ok(results.length >= 1);
    assert.ok(/src[\\/]+graph\.ts$/.test(results[0]?.path ?? ""));
    assert.ok((results[0]?.scoreDetails?.relationBoost ?? 0) > 0);
    assert.ok((results[0]?.relationHits ?? []).some((item) => item.includes("symbol:buildmemorygraph") || item.includes("path:graph.ts")));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
