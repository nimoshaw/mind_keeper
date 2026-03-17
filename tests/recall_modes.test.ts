import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("recallFast stays on the fast path while recallDeep can expand into history", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-recall-modes-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const projectFile = path.join(srcDir, "memory.ts");
  await fs.writeFile(
    projectFile,
    [
      "export function recallModes(query: string) {",
      "  return query;",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    await service.rememberDecision({
      projectRoot,
      title: "Recall modes stay split",
      decision: "Fast recall should stay on stable and project-local sources, while deep recall can expand into historical notes.",
      rationale: "IDE latency stays predictable when the shallow path is explicit.",
      impact: "Expose recallFast and recallDeep as separate entry points.",
      moduleName: "retrieval",
      tags: ["retrieval", "planner"]
    });
    await service.remember({
      projectRoot,
      sourceKind: "diary",
      title: "Historical retrieval note",
      content: "Deep recall should include older diary notes when someone asks for historical retrieval experiments.",
      moduleName: "retrieval",
      tags: ["history", "retrieval"]
    });
    await service.remember({
      projectRoot,
      sourceKind: "imported",
      title: "Imported retrieval archive",
      content: "Historical retrieval experiments mention archive recall, imported notes, and deep context expansion.",
      moduleName: "retrieval",
      tags: ["archive", "retrieval"]
    });

    const fastResults = await service.recallFast({
      projectRoot,
      query: "historical retrieval archive imported notes and deep context expansion",
      topK: 6,
      minScore: 0
    });
    const deepResults = await service.recallDeep({
      projectRoot,
      query: "historical retrieval archive imported notes and deep context expansion",
      topK: 6,
      minScore: 0
    });

    assert.ok(fastResults.length >= 1);
    assert.ok(fastResults.every((item) => item.sourceKind !== "diary" && item.sourceKind !== "imported"));
    assert.ok(deepResults.some((item) => item.sourceKind === "diary" || item.sourceKind === "imported"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
