import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { MindKeeperService } from "../src/mindkeeper.js";
import { ensureProjectScaffold } from "../src/project.js";
import { MindKeeperStorage } from "../src/storage.js";

type StepResult = {
  name: string;
  durationMs: number;
  details?: Record<string, unknown>;
};

async function main(): Promise<void> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mind-keeper-smoke-"));
  const srcDir = path.join(projectRoot, "src");
  const docsDir = path.join(projectRoot, "docs");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.mkdir(docsDir, { recursive: true });

  await fs.writeFile(
    path.join(srcDir, "memory.ts"),
    [
      "export function remember(text: string) {",
      "  return text;",
      "}",
      "",
      "export function recallTask(query: string) {",
      "  return query;",
      "}"
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(docsDir, "ARCHITECTURE.md"),
    [
      "# Architecture",
      "",
      "Mind Keeper keeps project memory scoped to the active repository."
    ].join("\n"),
    "utf8"
  );

  const service = new MindKeeperService();
  const steps: StepResult[] = [];

  try {
    const config = await timed("bootstrap_project", steps, async () => ensureProjectScaffold(projectRoot));
    assert.equal(config.projectName, path.basename(projectRoot));

    const indexResult = await timed("index_project", steps, async () => service.indexProject(projectRoot, { force: true }));
    assert.ok(indexResult.indexedFiles >= 2);

    const decision = await timed("remember_decision", steps, async () =>
      service.rememberDecision({
        projectRoot,
        title: "Keep branch recall soft",
        decision: "branch_name stays a ranking perspective instead of a hard filter.",
        rationale: "Developers still need durable decisions even when they switch branches.",
        impact: "context_for_task should preserve decision memory while preferring current-branch project chunks.",
        moduleName: "retrieval",
        tags: ["branch", "retrieval"]
      })
    );
    assert.ok(decision.chunkCount >= 1);

    const imported = await timed("remember_imported", steps, async () =>
      service.remember({
        projectRoot,
        title: "Legacy cross-branch import ledger",
        content: [
          "# Legacy import note",
          "",
          "Legacy cross branch import ledger should stay available for deep recall only.",
          "Do not inject this note into the fast path unless the user asks for older history."
        ].join("\n"),
        sourceKind: "imported",
        moduleName: "retrieval",
        tags: ["imported", "history", "deep-recall"]
      })
    );
    assert.ok(imported.chunkCount >= 1);

    const suggestion = await timed("suggest_session_memory", steps, async () =>
      service.suggestSessionMemory({
        projectRoot,
        moduleName: "retrieval",
        sessionText: [
          "We decided to keep branch_name as a ranking perspective instead of a hard filter.",
          "Prefer exact branch first, sibling branch second, and cross-branch recall with a penalty.",
          "Document the policy in ARCHITECTURE and README."
        ].join("\n")
      })
    );
    assert.equal(suggestion.shouldPersist, true);
    assert.equal(suggestion.recommendedKind, "decision");

    const summary = await timed("summarize_session", steps, async () =>
      service.summarizeSession({
        projectRoot,
        title: suggestion.suggestedTitle,
        sessionText: [
          "Implemented branch-aware retrieval ranking.",
          "Verified context_for_task preserves decision memory.",
          "Updated docs for the new behavior."
        ].join("\n"),
        kind: "diary",
        moduleName: "retrieval",
        tags: ["session", "retrieval"]
      })
    );
    assert.equal(summary.kind, "diary");

    const sqliteYes = await timed("remember_decision_sqlite_yes", steps, async () =>
      service.rememberDecision({
        projectRoot,
        title: "Use SQLite for manifests",
        decision: "Use SQLite for manifests and project metadata.",
        rationale: "A single embedded store keeps the project portable and fast.",
        impact: "Manifest and vector metadata stay local to the repository.",
        moduleName: "storage",
        tags: ["storage", "sqlite"]
      })
    );
    assert.ok(sqliteYes.chunkCount >= 1);

    const sqliteNo = await timed("remember_decision_sqlite_no", steps, async () =>
      service.rememberDecision({
        projectRoot,
        title: "Do not use SQLite for manifests",
        decision: "Do not use SQLite for manifests and project metadata.",
        rationale: "A flat file could simplify inspection in some environments.",
        impact: "This intentionally conflicts with the existing storage decision for smoke coverage.",
        moduleName: "storage",
        tags: ["storage", "sqlite", "conflict"]
      })
    );
    assert.ok(sqliteNo.chunkCount >= 1);

    const context = await timed("context_for_task", steps, async () =>
      service.contextForTask({
        projectRoot,
        task: "Fix recallTask diagnostics in the current branch",
        currentFile: path.join(srcDir, "memory.ts"),
        currentSymbol: "recallTask",
        diagnostics: "TypeError in src/memory.ts: recallTask should preserve branch-aware decision context",
        topK: 5
      })
    );
    assert.ok(context.results.some((item) => item.sourceKind === "decision"));
    assert.equal(context.gates.wavePlanType, "light-wave");
    assert.equal(context.gates.intentType, "debug");
    assert.equal(context.gates.intentSubtype, "bug_fix");
    assert.ok(context.gates.wavePlan.some((item) => item.name === "intent" && item.used));
    assert.ok(context.gates.queryPlan.projectQueryOrder.includes("current_file"));
    assert.ok(context.gates.waveBudgetProfile.localBudget >= context.gates.waveBudgetProfile.stableBudget);
    assert.equal(context.gates.usedConflictGate, true);
    assert.ok(context.gates.conflictSummary.subjects.includes("sqlite"));
    assert.ok(context.gates.conflictSummary.suppressedDocIds.length >= 1);
    assert.ok(Array.isArray(context.gates.memoryMesh.expandedDocIds));
    assert.ok(context.gates.confidenceStop.finalScore >= 0);
    assert.ok(context.results[0]?.explainReasons?.length);
    assert.ok(context.gates.explainSummary.whyTheseMemories.length > 0);
    assert.ok(context.gates.wavePlan.length >= 3);
    assert.ok(Boolean(context.gates.stopReason));

    const historyContext = await timed("context_for_task_history", steps, async () =>
      service.contextForTask({
        projectRoot,
        task: "Document the previous retrieval history and legacy branch notes",
        currentFile: path.join(docsDir, "ARCHITECTURE.md"),
        topK: 5
      })
    );
    assert.equal(historyContext.gates.usedAdaptiveDeepWaveGate, true);
    assert.equal(historyContext.gates.intentSubtype, "docs_update");
    assert.ok(historyContext.gates.deepWaveTriggers.includes("history_hint"));
    assert.equal(historyContext.gates.usedRecentWave, true);

    const recall = await timed("recall", steps, async () =>
      service.recall({
        projectRoot,
        query: "branch aware retrieval policy context recallTask",
        topK: 5,
        minScore: 0,
        explain: true,
        relatedPaths: [path.join(srcDir, "memory.ts")]
      })
    );
    assert.ok(recall.length > 0);
    assert.ok(recall.some((item) => (item.scoreDetails?.relationBoost ?? 0) > 0 || (item.relationHits?.length ?? 0) > 0));

    const fastRecall = await timed("recall_fast", steps, async () =>
      service.recallFast({
        projectRoot,
        query: "legacy cross branch import ledger",
        topK: 5,
        minScore: 0
      })
    );
    assert.ok(!fastRecall.some((item) => item.sourceKind === "imported"));

    const deepRecall = await timed("recall_deep", steps, async () =>
      service.recallDeep({
        projectRoot,
        query: "legacy cross branch import ledger",
        topK: 5,
        minScore: 0
      })
    );
    assert.ok(deepRecall.some((item) => item.sourceKind === "imported"));

    const storage = new MindKeeperStorage(projectRoot);
    try {
      storage.setDocumentUpdatedAt(summary.docId, Date.now() - 90 * 24 * 60 * 60 * 1000);
    } finally {
      storage.close();
    }

    const archived = await timed("archive_stale_memories", steps, async () =>
      service.archiveStaleMemories({
        projectRoot,
        olderThanDays: 30,
        sourceKinds: ["diary"]
      })
    );
    assert.ok(archived.docIds.includes(summary.docId));

    const conflicts = await timed("list_conflicts", steps, async () =>
      service.listConflicts({
        projectRoot,
        topK: 5
      })
    );
    assert.ok(conflicts.some((item) => item.subject.includes("sqlite")));

    const conflictClusters = await timed("list_conflict_clusters", steps, async () =>
      service.listConflictClusters({
        projectRoot,
        topK: 5
      })
    );
    assert.ok(conflictClusters.some((item) => item.subject.includes("sqlite")));

    const conflictResolutions = await timed("suggest_conflict_resolutions", steps, async () =>
      service.suggestConflictResolutions({
        projectRoot,
        topK: 5,
        minScore: 0.6
      })
    );
    assert.ok(conflictResolutions.some((item) => item.subject.includes("sqlite")));

    const conflictPlans = await timed("plan_conflict_resolutions", steps, async () =>
      service.planConflictResolutions({
        projectRoot,
        topK: 5,
        minScore: 0.6
      })
    );
    assert.ok(conflictPlans.some((item) => item.subject.includes("sqlite")));

    const conflictValidation = await timed("validate_conflict_resolution_plan", steps, async () =>
      service.validateConflictResolutionPlan({
        projectRoot,
        docIds: conflictPlans[0]?.consolidateInput.docIds ?? [],
        title: conflictPlans[0]?.rememberDecisionDraft.title ?? "Canonical sqlite decision",
        decision: conflictPlans[0]?.rememberDecisionDraft.decision ?? "Adopt one canonical policy for sqlite.",
        disableInputs: true
      })
    );
    assert.equal(conflictValidation.canExecute, true);

    const executedConflictResolution = await timed("execute_conflict_resolution_plan", steps, async () =>
      service.executeConflictResolutionPlan({
        projectRoot,
        docIds: conflictPlans[0]?.consolidateInput.docIds ?? [],
        title: conflictPlans[0]?.rememberDecisionDraft.title ?? "Canonical sqlite decision",
        decision: conflictPlans[0]?.rememberDecisionDraft.decision ?? "Adopt one canonical policy for sqlite.",
        rationale: conflictPlans[0]?.rememberDecisionDraft.rationale,
        impact: conflictPlans[0]?.rememberDecisionDraft.impact,
        moduleName: conflictPlans[0]?.rememberDecisionDraft.moduleName,
        tags: conflictPlans[0]?.rememberDecisionDraft.tags,
        disableInputs: true
      })
    );
    assert.equal(executedConflictResolution.persisted, true);

    const conflictVerification = await timed("verify_conflict_resolution_execution", steps, async () =>
      service.verifyConflictResolutionExecution({
        projectRoot,
        canonicalDocId: executedConflictResolution.docId ?? "",
        supersededDocIds: conflictPlans[0]?.consolidateInput.docIds ?? []
      })
    );
    assert.equal(conflictVerification.verified, true);

    const conflictFollowup = await timed("suggest_conflict_resolution_followup", steps, async () =>
      service.suggestConflictResolutionFollowup({
        projectRoot,
        canonicalDocId: executedConflictResolution.docId ?? "",
        supersededDocIds: conflictPlans[0]?.consolidateInput.docIds ?? []
      })
    );
    assert.ok(["archive", "keep_both", "disable", "review"].includes(conflictFollowup.recommendedAction));

    const executedConflictFollowup = await timed("execute_conflict_resolution_followup", steps, async () =>
      service.executeConflictResolutionFollowup({
        projectRoot,
        canonicalDocId: executedConflictResolution.docId ?? "",
        supersededDocIds: conflictPlans[0]?.consolidateInput.docIds ?? []
      })
    );
    assert.ok(["archive", "keep_both", "disable", "review"].includes(executedConflictFollowup.action));

    const consolidated = await timed("consolidate_memories", steps, async () =>
      service.consolidateMemories({
        projectRoot,
        docIds: [decision.docId, imported.docId],
        title: "Branch retrieval operating notes",
        kind: "knowledge",
        moduleName: "retrieval",
        tags: ["retrieval", "consolidated", "smoke"],
        disableInputs: true
      })
    );
    assert.equal(consolidated.persisted, true);
    assert.ok(consolidated.docId);
    assert.equal(consolidated.disabledInputs, 2);

    const report = {
      ok: true,
      projectRoot,
      activeEmbeddingProfile: config.activeEmbeddingProfile,
      activeRerankerProfile: config.activeRerankerProfile,
      steps,
      summary: {
        indexedFiles: indexResult.indexedFiles,
        decisionDocId: decision.docId,
        importedDocId: imported.docId,
        sessionDocId: summary.docId,
        contextHits: context.results.length,
        intentType: context.gates.intentType,
        intentSubtype: context.gates.intentSubtype,
        waveBudgetProfile: context.gates.waveBudgetProfile.profileName,
        usedConflictGate: context.gates.usedConflictGate,
        conflictSubjects: context.gates.conflictSummary.subjects,
        usedMemoryMesh: context.gates.usedMemoryMesh,
        explainSummarySample: context.gates.explainSummary.whyTheseMemories[0],
        historyWaveTriggered: historyContext.gates.usedAdaptiveDeepWaveGate,
        historyIntentSubtype: historyContext.gates.intentSubtype,
        historyWaveTriggers: historyContext.gates.deepWaveTriggers,
        confidenceStopReason: context.gates.confidenceStop.reason,
        recallHits: recall.length,
        fastRecallHits: fastRecall.length,
        deepRecallHits: deepRecall.length,
        archivedCount: archived.archivedCount,
        conflictCount: conflicts.length,
        conflictClusterCount: conflictClusters.length,
        conflictResolutionCount: conflictResolutions.length,
        conflictPlanCount: conflictPlans.length,
        conflictValidationWarnings: conflictValidation.warnings.length,
        executedConflictResolutionDocId: executedConflictResolution.docId,
        conflictVerificationWarnings: conflictVerification.warnings.length,
        conflictFollowupAction: conflictFollowup.recommendedAction,
        executedConflictFollowupAction: executedConflictFollowup.action,
        consolidatedDocId: consolidated.docId
      }
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}

async function timed<T>(name: string, steps: StepResult[], fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await fn();
  steps.push({
    name,
    durationMs: round2(performance.now() - started),
    details: summarizeResult(result)
  });
  return result;
}

function summarizeResult(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of ["projectName", "activeEmbeddingProfile", "activeRerankerProfile", "indexedFiles", "chunkCount", "docId", "kind", "recommendedKind", "shouldPersist"]) {
    if (key in record) {
      picked[key] = record[key];
    }
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

await main();
