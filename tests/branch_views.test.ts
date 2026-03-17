import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("recall prefers exact branch, then sibling branch, and branch views summarize stored memory", { skip: !hasGit() }, async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-branch-views-"));
  const service = new MindKeeperService();

  try {
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Mind Keeper"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "mindkeeper@example.com"], { cwd: projectRoot, stdio: "ignore" });
    await fs.writeFile(path.join(projectRoot, "README.md"), "# temp\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["branch", "-M", "main"], { cwd: projectRoot, stdio: "ignore" });

    await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Main branch workflow",
      content: "Use diagnostics-aware context recall and inspect the current symbol before changing retrieval code.",
      tags: ["retrieval", "workflow"]
    });

    execFileSync("git", ["checkout", "-b", "feature/memory"], { cwd: projectRoot, stdio: "ignore" });
    const exact = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Feature memory workflow",
      content: "Use diagnostics-aware context recall and inspect the current symbol before changing retrieval code.",
      tags: ["retrieval", "workflow"]
    });

    execFileSync("git", ["checkout", "main"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "feature/docs"], { cwd: projectRoot, stdio: "ignore" });
    const sibling = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Feature docs workflow",
      content: "Use diagnostics-aware context recall and inspect the current symbol before changing retrieval code.",
      tags: ["retrieval", "workflow"]
    });

    const results = await service.recall({
      projectRoot,
      query: "diagnostics aware context recall current symbol retrieval code",
      branchName: "feature/memory",
      topK: 5,
      minScore: 0,
      explain: true
    });

    const exactIndex = results.findIndex((item) => item.docId === exact.docId);
    const siblingIndex = results.findIndex((item) => item.docId === sibling.docId);
    assert.ok(exactIndex >= 0);
    assert.ok(siblingIndex >= 0);
    assert.equal(results[exactIndex]?.branchName, "feature/memory");
    assert.equal(results[siblingIndex]?.branchName, "feature/docs");
    assert.ok(exactIndex < siblingIndex);
    assert.ok((results[exactIndex]?.scoreDetails?.branchBoost ?? 0) > (results[siblingIndex]?.scoreDetails?.branchBoost ?? 0));

    const branchViews = await service.listBranchViews(projectRoot);
    const branchNames = branchViews.map((item) => item.branchName);
    assert.ok(branchNames.includes("main"));
    assert.ok(branchNames.includes("feature/memory"));
    assert.ok(branchNames.includes("feature/docs"));

    const memoryView = branchViews.find((item) => item.branchName === "feature/memory");
    assert.ok(memoryView);
    assert.ok((memoryView?.sourceCounts.manual ?? 0) >= 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
