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

test("context_for_task can pull one-hop memory mesh neighbors after stable memory hits", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-memory-mesh-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const targetFile = path.join(srcDir, "mesh.ts");
  await fs.writeFile(
    targetFile,
    [
      "export function runMeshRecall(task: string) {",
      "  return task;",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    await service.rememberDecision({
      projectRoot,
      title: "Use a stable retrieval hub",
      decision: "Use one stable retrieval hub before code-local expansion.",
      moduleName: "retrieval",
      tags: ["mesh", "retrieval"]
    });
    const meshNote = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Neighbor note for mesh expansion",
      content: "This note explains adjacency stitching and shared graph edges without repeating the original task text.",
      moduleName: "retrieval",
      tags: ["mesh", "neighbor"]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Fix stable retrieval hub behavior for mesh recall",
      currentFile: targetFile,
      currentSymbol: "runMeshRecall",
      topK: 6
    });

    assert.equal(result.gates.usedMemoryMesh, true);
    assert.ok(result.gates.memoryMesh.expandedDocIds.includes(meshNote.docId));
    assert.ok(result.results.some((item) => item.docId === meshNote.docId));
    assert.ok(result.gates.memoryMesh.expansionHits.some((item) => item.includes("module:retrieval") || item.includes("tag:mesh")));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("context_for_task can open a controlled second mesh hop when stable seeds are strong", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-memory-mesh-two-hop-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const targetFile = path.join(srcDir, "mesh.ts");
  await fs.writeFile(
    targetFile,
    [
      "export function runMeshRecall(task: string) {",
      "  return task;",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    await service.rememberDecision({
      projectRoot,
      title: "Use a stable retrieval hub",
      decision: "Use one stable retrieval hub before code-local expansion.",
      moduleName: "retrieval",
      tags: ["mesh", "retrieval"]
    });
    await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "First-hop bridge note",
      content: "This bridge note links the stable retrieval hub to a follow-up bridge tag.",
      moduleName: "retrieval",
      tags: ["mesh", "bridge"]
    });
    const secondHopNote = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Second-hop bridge archive",
      content: "This archive note is intentionally only reachable through the bridge tag.",
      moduleName: "history",
      tags: ["bridge", "archive"]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Fix stable retrieval hub behavior for mesh recall",
      currentFile: targetFile,
      currentSymbol: "runMeshRecall",
      topK: 8
    });

    assert.equal(result.gates.usedMemoryMesh, true);
    assert.equal(result.gates.memoryMesh.usedSecondHop, true);
    assert.equal(result.gates.memoryMesh.expansionDepth, 2);
    assert.ok(result.gates.memoryMesh.secondHopDocIds.includes(secondHopNote.docId));
    assert.ok(result.gates.memoryMesh.expansionHits.some((item) => item.includes("mesh2:tag:bridge")));
    assert.ok(result.results.some((item) => item.docId === secondHopNote.docId));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
