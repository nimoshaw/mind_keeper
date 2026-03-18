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
    assert.equal(result.gates.intentSubtype, "bug_fix");
    assert.equal(result.gates.usedTaskStageGate, true);
    assert.equal(result.gates.intentType, "debug");
    assert.equal(result.gates.intentAnchors.currentFile, "memory.ts");
    assert.equal(result.gates.intentAnchors.moduleName, "src");
    assert.equal(result.gates.intentAnchors.symbol, "remember");
    assert.equal(result.gates.queryPlan.projectQueryOrder[0], "current_file");
    assert.ok(result.gates.queryPlan.projectQueryOrder.includes("related_files"));
    assert.equal(result.gates.waveBudgetProfile.overallBudget, 6);
    assert.ok(result.gates.waveBudgetProfile.localBudget >= result.gates.waveBudgetProfile.stableBudget);
    assert.ok(result.gates.wavePlan.some((item) => item.name === "local_project" && item.budget === result.gates.waveBudgetProfile.localBudget));
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
    assert.ok(result.results[0]?.explainReasons?.length);
    assert.ok(result.results[0]?.explainCards?.length);
    assert.ok(result.gates.explainSummary.whyTheseMemories.length > 0);
    assert.ok(result.gates.explainSummary.whyNotOthers.length > 0);
    assert.ok(result.gates.explainPanel.headline.length > 0);
    assert.ok(result.gates.explainPanel.highlights.length > 0);
    assert.ok(result.gates.explainPanel.suppressions.length > 0);
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
    assert.equal(result.gates.intentSubtype, "architecture_review");
    assert.equal(result.gates.intentAnchors.currentFile, "ARCHITECTURE.md");
    assert.equal(result.gates.queryPlan.projectQueryOrder[0], "current_file");
    assert.equal(result.gates.waveBudgetProfile.profileName, "documentation-biased");
    assert.ok(result.gates.waveBudgetProfile.stableBudget >= result.gates.waveBudgetProfile.localBudget);
    assert.ok(/Documentation stage/i.test(result.gates.budgetPolicy));
    assert.equal(result.gates.wavePlanType, "light-wave");
    assert.ok(result.gates.wavePlan.some((item) => item.name === "intent" && item.used));
    assert.ok(result.gates.wavePlan.some((item) => item.name === "stable_memory"));
    assert.ok(result.gates.usedConfidenceStop || result.gates.stopReason.length > 0);
    assert.ok(result.gates.explainSummary.whyTheseMemories.length > 0);
    assert.ok(result.gates.explainPanel.headline.length > 0);
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
    assert.equal(result.gates.waveBudgetProfile.profileName, "balanced");
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

test("context_for_task uses conflict-aware wave gating to keep one canonical decision", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-conflict-wave-project-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const targetFile = path.join(srcDir, "storage.ts");
  await fs.writeFile(
    targetFile,
    [
      "export function loadManifestStore() {",
      "  return 'sqlite';",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });

    const preferSqlite = await service.rememberDecision({
      projectRoot,
      title: "Use SQLite for manifests",
      decision: "Use sqlite for manifests and project metadata.",
      rationale: "An embedded store keeps the repository portable.",
      impact: "Storage code should default to sqlite.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "manifest"]
    });

    const avoidSqlite = await service.rememberDecision({
      projectRoot,
      title: "Do not use SQLite for manifests",
      decision: "Do not use sqlite for manifests and project metadata.",
      rationale: "Some environments prefer plain files.",
      impact: "This intentionally conflicts with the prior storage note.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "manifest", "conflict"]
    });

    const canonical = await service.rememberDecision({
      projectRoot,
      title: "Canonical conflict-resolution for sqlite manifests",
      decision: "Canonical conflict-resolution: adopt sqlite for manifests and project metadata.",
      rationale: "The team reviewed the storage drift and chose one durable default.",
      impact: "Prefer the canonical sqlite decision and suppress superseded conflicts in task recall.",
      moduleName: "storage",
      tags: ["sqlite", "storage", "canonical", "conflict-resolution"]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Fix manifest storage behavior around sqlite decisions",
      currentFile: targetFile,
      currentSymbol: "loadManifestStore",
      diagnostics: "Conflict in src/storage.ts: sqlite manifest policy drift should resolve to the canonical decision",
      topK: 5
    });

    assert.equal(result.gates.usedConflictGate, true);
    assert.equal(result.gates.conflictSummary.canonicalPreferred, true);
    assert.equal(result.gates.intentSubtype, "bug_fix");
    assert.ok(result.gates.explainSummary.whyConflictWasSuppressed.some((item) => /canonical|suppressed/i.test(item)));
    assert.ok(result.gates.conflictSummary.subjects.includes("sqlite"));
    assert.ok(result.gates.conflictSummary.keptDocIds.includes(canonical.docId));
    assert.ok(result.gates.conflictSummary.suppressedDocIds.includes(preferSqlite.docId));
    assert.ok(result.gates.conflictSummary.suppressedDocIds.includes(avoidSqlite.docId));
    assert.ok(result.results.some((item) => item.docId === canonical.docId));
    assert.ok(!result.results.some((item) => item.docId === preferSqlite.docId));
    assert.ok(!result.results.some((item) => item.docId === avoidSqlite.docId));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("context_for_task can adaptively open the recent-history wave for history-focused tasks", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-adaptive-deep-wave-project-"));
  const docsDir = path.join(projectRoot, "docs");
  await fs.mkdir(docsDir, { recursive: true });

  const guideFile = path.join(docsDir, "GUIDE.md");
  await fs.writeFile(
    guideFile,
    [
      "# Retrieval Guide",
      "",
      "Document the current retrieval design."
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    await service.rememberDecision({
      projectRoot,
      title: "Current retrieval policy",
      decision: "Use stable memory first and keep deep history behind an adaptive wave.",
      rationale: "The IDE needs low-latency defaults.",
      impact: "Only open diary and imported notes when history is explicitly requested.",
      moduleName: "retrieval",
      tags: ["retrieval", "policy"]
    });
    const historyDiary = await service.remember({
      projectRoot,
      sourceKind: "diary",
      title: "Previous retrieval experiment log",
      content: "Historical note: earlier retrieval experiments used diary-first expansion before we adopted adaptive deep waves.",
      moduleName: "retrieval",
      tags: ["history", "retrieval", "legacy"]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Document the previous retrieval history and earlier experiments for the guide",
      currentFile: guideFile,
      topK: 5
    });

    assert.equal(result.gates.usedAdaptiveDeepWaveGate, true);
    assert.equal(result.gates.intentSubtype, "docs_update");
    assert.ok(result.gates.deepWaveTriggers.includes("history_hint"));
    assert.ok(result.gates.explainSummary.whyDeepWaveOpened.some((item) => /historical|previous/i.test(item)));
    assert.ok(result.gates.explainPanel.highlights.some((item) => /History wave opened/i.test(item.title)));
    assert.equal(result.gates.usedRecentWave, true);
    assert.ok(result.results.some((item) => item.docId === historyDiary.docId));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("context_for_task exposes migration intent subtype and migration-biased stable planning", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-migration-intent-project-"));
  const srcDir = path.join(projectRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const storageFile = path.join(srcDir, "storage.ts");
  await fs.writeFile(
    storageFile,
    [
      "export function migrateManifestStore() {",
      "  return 'sqlite';",
      "}"
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();

  try {
    await service.indexProject(projectRoot, { force: true });
    await service.remember({
      projectRoot,
      sourceKind: "imported",
      title: "Manifest migration guide",
      content: "Migration guide: move manifest storage from flat files to sqlite and keep an adapter for rollback.",
      moduleName: "storage",
      tags: ["migration", "sqlite", "storage"]
    });

    const result = await service.contextForTask({
      projectRoot,
      task: "Migrate manifest storage from flat files to sqlite and update the adapter",
      currentFile: storageFile,
      currentSymbol: "migrateManifestStore",
      topK: 5
    });

    assert.equal(result.gates.intentSubtype, "migration");
    assert.equal(result.gates.waveBudgetProfile.intentSubtype, "migration");
    assert.ok(result.gates.queryPlan.stableSourceKinds.includes("imported"));
    assert.ok(result.gates.deepWaveTriggers.includes("required_for_intent_subtype"));
    assert.ok(result.query.includes("intent_subtype: migration"));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
