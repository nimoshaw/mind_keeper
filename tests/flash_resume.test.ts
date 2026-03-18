import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("flash checkpoint can be saved, resumed, and cleared", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-flash-checkpoint-"));
  const service = new MindKeeperService();

  try {
    const checkpoint = await service.flashCheckpoint({
      projectRoot,
      title: "Resume manifest cleanup",
      sessionGoal: "Finish the manifest storage cleanup and reconnect the last work state.",
      currentStatus: "Index rebuild is done, but cleanup automation still needs one last pass.",
      workingMemory: "The main risk is over-pruning diary notes while testing cleanup heuristics.",
      nextSteps: [
        "Review the cleanup recommendations",
        "Run apply_memory_cleanup_plan with safe actions only"
      ],
      blockers: ["Need to confirm the stale threshold before auto-archive."],
      openQuestions: ["Should stale archive default to 45 days or stay configurable?"],
      branchName: "feature/cleanup",
      touchedFiles: ["src/app/hygiene-service.ts", "README.md"],
      importantCommands: ["npm run verify"],
      tags: ["flash", "cleanup"]
    });

    assert.match(checkpoint.activePath, /\.mindkeeper[\\/]flash[\\/]active\.json$/);
    assert.match(checkpoint.historyPath, /\.mindkeeper[\\/]flash[\\/]history[\\/].+\.json$/);
    await fs.access(checkpoint.activePath);
    await fs.access(checkpoint.historyPath);

    const resume = await service.flashResume(projectRoot);
    assert.equal(resume.found, true);
    assert.equal(resume.shouldInject, true);
    assert.equal(resume.freshness, "fresh");
    assert.ok(resume.resumePrompt?.includes("Goal: Finish the manifest storage cleanup"));
    assert.deepEqual(resume.checkpoint?.nextSteps, [
      "Review the cleanup recommendations",
      "Run apply_memory_cleanup_plan with safe actions only"
    ]);

    const cleared = await service.flashClear(projectRoot);
    assert.equal(cleared.cleared, true);

    const afterClear = await service.flashResume(projectRoot);
    assert.equal(afterClear.found, false);
    assert.equal(afterClear.resumePrompt, null);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("context_for_task loads active flash context and uses flash touched files as related hints", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-flash-context-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const storageFile = path.join(srcDir, "storage.ts");
  await fs.writeFile(
    storageFile,
    [
      "export function cleanupManifestState() {",
      "  return 'cleanup';",
      "}",
      "",
      "export function rebuildManifestIndex() {",
      "  return 'rebuild';",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    await service.flashCheckpoint({
      projectRoot,
      title: "Manifest cleanup handoff",
      sessionGoal: "Resume the manifest cleanup work exactly where the previous session stopped.",
      currentStatus: "The next pass should focus on cleanupManifestState and the final verify run.",
      workingMemory: "The storage module is already indexed and the risky part is preserving useful diary notes.",
      nextSteps: ["Inspect storage cleanup code", "Run npm run verify after cleanup changes"],
      blockers: ["Still need to confirm whether cleanup should archive or disable one noisy source."],
      touchedFiles: [storageFile]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Continue the manifest cleanup work from the previous session",
      topK: 4
    });

    assert.equal(result.gates.usedFlashGate, true);
    assert.equal(result.gates.flash.loaded, true);
    assert.equal(result.gates.flash.freshness, "fresh");
    assert.ok(result.gates.flash.resumePrompt?.includes("Resume fresh work context"));
    assert.ok(result.gates.flash.touchedFiles.some((item) => /src[\\/]storage\.ts$/.test(item)));
    assert.equal(result.gates.usedRelatedFileGate, true);
    assert.ok(result.query.includes("flash_goal: Resume the manifest cleanup work"));
    assert.ok(result.query.includes("flash_next_steps: Inspect storage cleanup code"));
    assert.ok(result.gates.explainPanel.highlights.some((item) => item.title === "Flash resume context loaded"));
    assert.ok(result.results.length > 0);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
