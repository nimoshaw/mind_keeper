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

function runGit(projectRoot: string, args: string[]): void {
  execFileSync("git", args, { cwd: projectRoot, stdio: "ignore" });
}

test("workflow fixture keeps exact-branch helpful memory ahead of noisy sibling notes during debug recall", { skip: !hasGit() }, async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-workflow-branch-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const recallFile = path.join(srcDir, "recall.ts");
  await fs.writeFile(
    recallFile,
    [
      "export function rankByBranch(branch: string, score: number) {",
      "  return `${branch}:${score}`;",
      "}",
      "",
      "export function contextForTask(task: string) {",
      "  return task;",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    runGit(projectRoot, ["init"]);
    runGit(projectRoot, ["config", "user.name", "Mind Keeper"]);
    runGit(projectRoot, ["config", "user.email", "mindkeeper@example.com"]);
    runGit(projectRoot, ["add", "."]);
    runGit(projectRoot, ["commit", "-m", "init"]);
    runGit(projectRoot, ["branch", "-M", "main"]);

    await service.indexProject(projectRoot, { force: true });
    await service.rememberDecision({
      projectRoot,
      title: "Branch ranking stays soft",
      decision: "Use exact branch memories first, sibling branch memories second, and cross-branch memories only as a fallback.",
      rationale: "IDE recall should preserve local branch context without hiding durable decisions.",
      impact: "branch_name stays a ranking perspective instead of a hard filter.",
      moduleName: "retrieval",
      tags: ["branch", "retrieval", "policy"]
    });

    runGit(projectRoot, ["checkout", "-b", "feature/retrieval"]);
    const helpful = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Feature retrieval debug note",
      content: "When diagnostics mention rankByBranch, inspect the current symbol and keep branch ranking as a soft preference.",
      moduleName: "retrieval",
      tags: ["branch", "debug", "retrieval"]
    });
    await service.rateSource({ projectRoot, docId: helpful.docId, signal: "helpful" });
    await service.rateSource({ projectRoot, docId: helpful.docId, signal: "helpful" });

    runGit(projectRoot, ["checkout", "main"]);
    runGit(projectRoot, ["checkout", "-b", "feature/docs"]);
    const noisy = await service.remember({
      projectRoot,
      sourceKind: "manual",
      title: "Feature docs stale note",
      content: "When diagnostics mention rankByBranch, inspect the current symbol and keep branch ranking as a soft preference.",
      moduleName: "docs",
      tags: ["branch", "debug", "docs"]
    });
    await service.rateSource({ projectRoot, docId: noisy.docId, signal: "noisy" });
    await service.rateSource({ projectRoot, docId: noisy.docId, signal: "noisy" });

    const recallResults = await service.recall({
      projectRoot,
      query: "rankByBranch diagnostics current symbol branch ranking soft preference",
      branchName: "feature/retrieval",
      topK: 6,
      minScore: 0,
      explain: true
    });

    const helpfulIndex = recallResults.findIndex((item) => item.docId === helpful.docId);
    const noisyIndex = recallResults.findIndex((item) => item.docId === noisy.docId);
    assert.ok(helpfulIndex >= 0);
    assert.ok(noisyIndex >= 0);
    assert.ok(helpfulIndex < noisyIndex);
    assert.ok((recallResults[helpfulIndex]?.scoreDetails?.feedbackBoost ?? 0) > 0);
    assert.ok((recallResults[noisyIndex]?.scoreDetails?.feedbackBoost ?? 0) < 0);
    assert.ok((recallResults[helpfulIndex]?.scoreDetails?.branchBoost ?? 0) > (recallResults[noisyIndex]?.scoreDetails?.branchBoost ?? 0));

    const context = await service.contextForTask({
      projectRoot,
      task: "Fix branch-aware debug recall for rankByBranch diagnostics",
      currentFile: recallFile,
      currentSymbol: "rankByBranch",
      diagnostics: "TypeError in src/recall.ts: rankByBranch should keep branch ranking soft and symbol aware",
      branchName: "feature/retrieval",
      topK: 6
    });

    assert.equal(context.gates.usedDiagnosticsGate, true);
    assert.equal(context.gates.usedSymbolGate, true);
    assert.equal(context.gates.taskStage, "debug");
    assert.ok(context.results.some((item) => item.docId === helpful.docId));
    assert.ok(context.results.some((item) => item.sourceKind === "decision"));

    const contextHelpfulIndex = context.results.findIndex((item) => item.docId === helpful.docId);
    const contextNoisyIndex = context.results.findIndex((item) => item.docId === noisy.docId);
    assert.ok(contextHelpfulIndex >= 0);
    if (contextNoisyIndex >= 0) {
      assert.ok(contextHelpfulIndex < contextNoisyIndex);
    }
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("workflow fixture can suggest, persist, and recall a decision from session notes", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-workflow-session-"));
  const docsDir = path.join(projectRoot, "docs");
  await fs.mkdir(docsDir, { recursive: true });

  const architectureFile = path.join(docsDir, "ARCHITECTURE.md");
  await fs.writeFile(
    architectureFile,
    [
      "# Architecture",
      "",
      "Describe how branch-aware recall works in Mind Keeper."
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();
  const sessionText = [
    "We decided to keep branch_name as a ranking perspective instead of a hard filter.",
    "Prefer exact branch first, sibling branch second, and cross-branch recall only with a penalty.",
    "Document this policy in ARCHITECTURE and the MCP tool guide.",
    "This should become the default branch-aware retrieval policy."
  ].join("\n");

  try {
    await service.indexProject(projectRoot, { force: true });

    const suggestion = await service.suggestSessionMemory({
      projectRoot,
      title: "Branch-aware retrieval policy",
      moduleName: "retrieval",
      sessionText
    });

    assert.equal(suggestion.shouldPersist, true);
    assert.equal(suggestion.recommendedKind, "decision");
    assert.ok(suggestion.confidence >= 0.5);

    const stored = await service.summarizeSession({
      projectRoot,
      title: suggestion.suggestedTitle,
      sessionText,
      kind: suggestion.recommendedKind,
      moduleName: "retrieval",
      tags: suggestion.tags
    });

    assert.equal(stored.persisted, true);
    assert.equal(stored.kind, "decision");
    const recallResults = await service.recall({
      projectRoot,
      query: "branch-aware retrieval policy exact branch sibling branch penalty",
      moduleName: "retrieval",
      topK: 5,
      minScore: 0
    });

    assert.ok(recallResults.some((item) => item.docId === stored.docId));

    const context = await service.contextForTask({
      projectRoot,
      task: "Document the branch-aware retrieval policy in the architecture guide",
      currentFile: architectureFile,
      selectedText: "# Architecture",
      topK: 4
    });

    assert.equal(context.gates.taskStage, "document");
    assert.ok(context.results.some((item) => item.docId === stored.docId));
    assert.ok(context.gates.selectedBySource.decision >= 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
