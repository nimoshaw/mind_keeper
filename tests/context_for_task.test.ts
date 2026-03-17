import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MindKeeperService } from "../src/mindkeeper.js";

test("context_for_task prioritizes decision memory and current file context", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-task-test-project-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const targetFile = path.join(srcDir, "memory.ts");
  await fs.writeFile(
    targetFile,
    [
      "export class MemoryStore {",
      "  remember(text: string) {",
      "    return text;",
      "  }",
      "}",
      "",
      ...new Array(140).fill("// padding so remember and recallTask land in different chunks"),
      "",
      "export function recallTask(query: string) {",
      "  return query;",
      "}"
    ].join("\n"),
    "utf8"
  );

  const relatedFile = path.join(srcDir, "context.ts");
  await fs.writeFile(
    relatedFile,
    [
      "export function buildContext() {",
      "  return 'context';",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    await service.rememberDecision({
      projectRoot,
      title: "Prefer diagnostics-aware context recall",
      decision: "context_for_task should prioritize decision memory and the current file when diagnostics mention remember.",
      rationale: "Developers need current-file and symbol-aware recall in IDE workflows.",
      impact: "Pass current_file, current_symbol, diagnostics, and related_files whenever possible.",
      moduleName: "retrieval",
      tags: ["context", "diagnostics", "remember"]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Fix diagnostics-aware context recall for remember workflow",
      currentFile: targetFile,
      currentSymbol: "remember",
      selectedText: "remember(text: string) { return text; }",
      diagnostics: "TypeError in src/memory.ts: remember should prefer diagnostics-aware context recall",
      relatedFiles: [relatedFile],
      topK: 6
    });

    assert.equal(result.gates.usedFileGate, true);
    assert.equal(result.gates.usedSymbolGate, true);
    assert.equal(result.gates.usedDiagnosticsGate, true);
    assert.equal(result.gates.usedRelatedFileGate, true);
    assert.equal(result.gates.symbol, "remember");
    assert.equal(result.gates.taskStage, "debug");
    assert.equal(result.gates.usedTaskStageGate, true);
    assert.equal(result.gates.intentType, "debug");
    assert.equal(result.gates.intentAnchors.currentFile, "memory.ts");
    assert.equal(result.gates.intentAnchors.moduleName, "src");
    assert.equal(result.gates.intentAnchors.symbol, "remember");
    assert.equal(result.gates.queryPlan.projectQueryOrder[0], "current_file");
    assert.ok(result.gates.queryPlan.projectQueryOrder.includes("related_files"));
    assert.ok(result.gates.knowledgeReserve >= 2);
    assert.ok(result.gates.projectReserve >= 1);
    assert.ok(result.gates.budgetPolicy.length > 0);
    assert.equal(result.gates.wavePlanType, "light-wave");
    assert.ok(result.gates.wavePlan.some((item) => item.name === "intent" && item.used));
    assert.ok(result.gates.wavePlan.some((item) => item.name === "stable_memory" && item.used));
    assert.ok(result.gates.wavePlan.some((item) => item.name === "local_project" && item.used));
    assert.ok(result.gates.stopReason.length > 0);
    assert.ok(result.gates.confidenceStop.finalScore >= 0);
    assert.ok(result.gates.confidenceStop.threshold > 0);
    assert.ok(result.gates.confidenceStop.coverageScore >= 0);
    assert.ok(result.gates.confidenceStop.confidenceScore >= 0);
    assert.ok(result.results.length > 0);
    assert.ok(result.results.some((item) => item.sourceKind === "decision"));
    assert.ok(result.results.some((item) => /src[\\/]+memory\.ts$/.test(item.path)));
    assert.ok(result.gates.selectedBySource.decision >= 1);
    assert.equal(result.gates.fallbackUsed, false);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("context_for_task infers documentation stage and explains source budget", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-doc-stage-project-"));
  const docsDir = path.join(projectRoot, "docs");
  await fs.mkdir(docsDir, { recursive: true });

  const architectureFile = path.join(docsDir, "ARCHITECTURE.md");
  await fs.writeFile(
    architectureFile,
    [
      "# Architecture",
      "",
      "Mind Keeper uses project-scoped memory and explainable retrieval."
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    await service.rememberDecision({
      projectRoot,
      title: "Document task context behavior",
      decision: "Docs should explain why context_for_task preserves both code-local and decision memories.",
      rationale: "Users need a clear explanation of gated context behavior.",
      impact: "Document the source budget and task-stage behavior in README and tool docs.",
      moduleName: "docs",
      tags: ["docs", "context"]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Document the context_for_task budget behavior in the README guide",
      currentFile: architectureFile,
      selectedText: "# Architecture",
      topK: 4
    });

    assert.equal(result.gates.taskStage, "document");
    assert.equal(result.gates.usedTaskStageGate, true);
    assert.equal(result.gates.intentType, "document");
    assert.equal(result.gates.intentAnchors.currentFile, "ARCHITECTURE.md");
    assert.equal(result.gates.queryPlan.projectQueryOrder[0], "current_file");
    assert.ok(/Documentation stage/i.test(result.gates.budgetPolicy));
    assert.equal(result.gates.wavePlanType, "light-wave");
    assert.ok(result.gates.wavePlan.some((item) => item.name === "intent" && item.used));
    assert.ok(result.gates.wavePlan.some((item) => item.name === "stable_memory"));
    assert.ok(result.gates.usedConfidenceStop || result.gates.stopReason.length > 0);
    assert.ok(result.gates.knowledgeReserve >= 2);
    assert.ok(result.gates.selectedBySource.decision >= 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("context_for_task enforces token budget and reports omitted chunks", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-token-budget-project-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const targetFile = path.join(srcDir, "memory.ts");
  await fs.writeFile(
    targetFile,
    [
      "export function rememberLargeContext(input: string) {",
      "  return input;",
      "}",
      "",
      ...new Array(220).fill("const detail = 'this is intentionally verbose so the chunk token estimate gets large enough for budget trimming';")
    ].join("\n"),
    "utf8"
  );

  const configPath = path.join(projectRoot, ".mindkeeper", "config.toml");
  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    let configText = await fs.readFile(configPath, "utf8");
    if (/taskContextTokenBudget\s*=/.test(configText)) {
      configText = configText.replace(/taskContextTokenBudget\s*=\s*[0-9_]+/, "taskContextTokenBudget = 120");
    } else {
      configText = configText.replace("[retrieval]", "[retrieval]\ntaskContextTokenBudget = 120");
    }
    await fs.writeFile(configPath, configText, "utf8");

    await service.rememberDecision({
      projectRoot,
      title: "Keep token budget visible",
      decision: "When task context gets large, the service should omit low-priority chunks and explain that token budget caused it.",
      rationale: "IDE clients need predictable context size.",
      impact: "Return token budget metadata with omitted counts.",
      moduleName: "retrieval",
      tags: ["budget", "context"]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Fix bug in rememberLargeContext with diagnostics and token budget handling",
      currentFile: targetFile,
      currentSymbol: "rememberLargeContext",
      diagnostics: "TypeError in src/memory.ts: rememberLargeContext should keep token budget under control",
      topK: 6
    });

    assert.ok(result.results.length >= 1);
    assert.equal(result.gates.usedTokenBudgetGate, true);
    assert.equal(result.gates.intentType, "debug");
    assert.ok(result.query.includes("intent: debug"));
    assert.ok(result.gates.confidenceStop.finalScore >= 0);
    assert.ok(result.gates.confidenceStop.redundancyScore >= 0);
    assert.ok(result.gates.confidenceStop.conflictScore >= 0);
    assert.equal(result.gates.usedFallbackWave, false);
    assert.ok(result.gates.omittedByTokenBudget >= 1);
    assert.ok(result.gates.estimatedTokensUsed <= result.gates.tokenBudget || result.results.length === 1);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
