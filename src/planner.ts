import type { ContextTaskStage, MemorySourceKind, TaskIntentSubtype } from "./types.js";

export type RecallWaveName = "intent" | "stable_memory" | "local_project" | "recent_history" | "fallback";
export type ProjectQueryFocus = "current_file" | "related_files" | "module" | "broad_project";

export interface RecallWaveDefinition {
  name: RecallWaveName;
  label: string;
  description: string;
  sourceKinds: MemorySourceKind[];
  budget: number;
  minScore: number;
  optional?: boolean;
}

export interface RecallWaveResult {
  name: RecallWaveName;
  label: string;
  description: string;
  budget: number;
  minScore: number;
  used: boolean;
  resultCount: number;
}

export interface TaskWaveStopDecision {
  waveName: RecallWaveName;
  shouldStop: boolean;
  reason: string | null;
  coverageScore: number;
  confidenceScore: number;
  redundancyScore: number;
  conflictScore: number;
  finalScore: number;
  threshold: number;
}

export interface TaskIntentAnchors {
  currentFile: string | null;
  moduleName: string | null;
  symbol: string | null;
  language: string | null;
  branchName: string | null;
  relatedFiles: string[];
  diagnosticFiles: string[];
  diagnosticSymbols: string[];
  hasSelectedText: boolean;
  hasDiagnostics: boolean;
}

export interface TaskIntentPlan {
  intentType: ContextTaskStage;
  intentSubtype: TaskIntentSubtype;
  anchors: TaskIntentAnchors;
  queryPlan: {
    stableSourceKinds: MemorySourceKind[];
    localSourceKinds: MemorySourceKind[];
    recentSourceKinds: MemorySourceKind[];
    fallbackSourceKinds: MemorySourceKind[];
    projectQueryOrder: ProjectQueryFocus[];
    symbolBias: "exact" | "diagnostic-first" | "none";
    branchBias: "prefer_current_branch" | "soft";
  };
}

export interface TaskWaveBudgetProfile {
  overallBudget: number;
  stableBudget: number;
  localBudget: number;
  recentBudget: number;
  fallbackBudget: number;
  profileName: "documentation-biased" | "exploration-biased" | "balanced";
  intentSubtype: TaskIntentSubtype;
}

export function buildTaskIntentPlan(input: {
  taskStage: ContextTaskStage;
  intentSubtype: TaskIntentSubtype;
  anchors: TaskIntentAnchors;
}): TaskIntentPlan {
  const projectQueryOrder: ProjectQueryFocus[] = [];
  const pushFocus = (focus: ProjectQueryFocus) => {
    if (!projectQueryOrder.includes(focus)) {
      projectQueryOrder.push(focus);
    }
  };

  if (input.anchors.currentFile) {
    pushFocus("current_file");
  }

  if ((input.taskStage === "explore" || input.intentSubtype === "architecture_review") && input.anchors.moduleName) {
    pushFocus("module");
  }

  if (input.anchors.relatedFiles.length > 0) {
    pushFocus("related_files");
  }

  if (input.intentSubtype === "migration" || input.intentSubtype === "api_change") {
    pushFocus("related_files");
    if (input.anchors.moduleName) {
      pushFocus("module");
    }
  }

  if (input.intentSubtype === "architecture_review") {
    pushFocus("module");
    pushFocus("broad_project");
  }

  if (input.taskStage !== "explore" && input.intentSubtype !== "architecture_review" && input.anchors.moduleName) {
    pushFocus("module");
  }

  pushFocus("broad_project");

  const stableSourceKinds: MemorySourceKind[] = ["manual", "decision"];
  const localSourceKinds: MemorySourceKind[] = ["project"];
  const recentSourceKinds: MemorySourceKind[] = ["diary", "imported"];
  const fallbackSourceKinds: MemorySourceKind[] = ["manual", "decision", "diary", "project", "imported"];

  if (input.intentSubtype === "migration") {
    stableSourceKinds.push("imported");
  } else if (input.intentSubtype === "architecture_review") {
    recentSourceKinds.unshift("imported");
  } else if (input.intentSubtype === "bug_root_cause" || input.intentSubtype === "test_repair") {
    recentSourceKinds.unshift("diary");
  }

  return {
    intentType: input.taskStage,
    intentSubtype: input.intentSubtype,
    anchors: input.anchors,
    queryPlan: {
      stableSourceKinds: dedupeKinds(stableSourceKinds),
      localSourceKinds: dedupeKinds(localSourceKinds),
      recentSourceKinds: dedupeKinds(recentSourceKinds),
      fallbackSourceKinds: dedupeKinds(fallbackSourceKinds),
      projectQueryOrder,
      symbolBias: input.anchors.symbol
        ? "exact"
        : input.anchors.diagnosticSymbols.length > 0
          ? "diagnostic-first"
          : "none",
      branchBias: input.anchors.branchName ? "prefer_current_branch" : "soft"
    }
  };
}

export function buildTaskWavePlan(input: {
  taskStage: ContextTaskStage;
  intentSubtype: TaskIntentSubtype;
  budget: number;
  minScore: number;
}): RecallWaveDefinition[] {
  const budgetProfile = buildTaskWaveBudgetProfile({
    taskStage: input.taskStage,
    intentSubtype: input.intentSubtype,
    budget: input.budget
  });
  const recentOptional =
    input.taskStage !== "debug" &&
    input.taskStage !== "verify" &&
    input.taskStage !== "explore" &&
    input.intentSubtype !== "bug_root_cause" &&
    input.intentSubtype !== "migration" &&
    input.intentSubtype !== "architecture_review";

  return [
    {
      name: "intent",
      label: "Intent Wave",
      description: "Anchor task intent, code focus, diagnostics, and branch hints before retrieval starts.",
      sourceKinds: [],
      budget: 0,
      minScore: 0
    },
    {
      name: "stable_memory",
      label: "Stable Memory Wave",
      description: "Prioritize durable project knowledge before expanding into code-local context.",
      sourceKinds: ["manual", "decision"],
      budget: budgetProfile.stableBudget,
      minScore: input.minScore
    },
    {
      name: "local_project",
      label: "Local Project Wave",
      description: "Gather current-file, related-file, and module-local project context.",
      sourceKinds: ["project"],
      budget: budgetProfile.localBudget,
      minScore: input.minScore
    },
    {
      name: "recent_history",
      label: "Recent History Wave",
      description: "Only expand into diary and imported notes when the first two waves do not produce enough context.",
      sourceKinds: ["diary", "imported"],
      budget: budgetProfile.recentBudget,
      minScore: Math.max(0, input.minScore - 0.03),
      optional: recentOptional
    },
    {
      name: "fallback",
      label: "Fallback Wave",
      description: "As a last resort, relax thresholds and search across all sources.",
      sourceKinds: ["manual", "decision", "diary", "project", "imported"],
      budget: budgetProfile.fallbackBudget,
      minScore: 0,
      optional: true
    }
  ];
}

export function buildTaskWaveBudgetProfile(input: {
  taskStage: ContextTaskStage;
  intentSubtype: TaskIntentSubtype;
  budget: number;
}): TaskWaveBudgetProfile {
  const overallBudget = Math.max(1, input.budget);
  let stableBudget = Math.min(overallBudget, Math.max(1, Math.ceil(overallBudget * 0.55)));
  let localBudget = Math.min(overallBudget, Math.max(2, Math.ceil(overallBudget * 0.85)));
  let recentBudget = Math.min(overallBudget, overallBudget >= 4 ? 2 : 1);
  let profileName: TaskWaveBudgetProfile["profileName"] = "balanced";

  if (input.taskStage === "document") {
    stableBudget = Math.min(overallBudget, Math.max(2, Math.ceil(overallBudget * 0.75)));
    localBudget = Math.min(overallBudget, Math.max(1, Math.ceil(overallBudget * 0.5)));
    recentBudget = 1;
    profileName = "documentation-biased";
  } else if (input.taskStage === "explore") {
    stableBudget = Math.min(overallBudget, Math.max(2, Math.ceil(overallBudget * 0.5)));
    localBudget = Math.min(overallBudget, Math.max(2, Math.ceil(overallBudget * 0.95)));
    recentBudget = Math.min(overallBudget, overallBudget >= 3 ? 2 : 1);
    profileName = "exploration-biased";
  }

  switch (input.intentSubtype) {
    case "bug_root_cause":
      stableBudget = Math.min(overallBudget, Math.max(stableBudget, Math.ceil(overallBudget * 0.6)));
      localBudget = Math.min(overallBudget, Math.max(localBudget, Math.ceil(overallBudget * 0.95)));
      recentBudget = Math.min(overallBudget, Math.max(recentBudget, overallBudget >= 4 ? 2 : 1));
      break;
    case "test_repair":
      localBudget = Math.min(overallBudget, Math.max(localBudget, Math.ceil(overallBudget * 0.95)));
      recentBudget = Math.min(overallBudget, Math.max(recentBudget, 1));
      break;
    case "migration":
      stableBudget = Math.min(overallBudget, Math.max(stableBudget, Math.ceil(overallBudget * 0.7)));
      localBudget = Math.min(overallBudget, Math.max(2, Math.ceil(overallBudget * 0.75)));
      recentBudget = Math.min(overallBudget, Math.max(recentBudget, overallBudget >= 4 ? 2 : 1));
      break;
    case "api_change":
      stableBudget = Math.min(overallBudget, Math.max(stableBudget, Math.ceil(overallBudget * 0.6)));
      localBudget = Math.min(overallBudget, Math.max(localBudget, Math.ceil(overallBudget * 0.9)));
      break;
    case "refactor_safety":
      stableBudget = Math.min(overallBudget, Math.max(stableBudget, Math.ceil(overallBudget * 0.65)));
      localBudget = Math.min(overallBudget, Math.max(2, Math.ceil(overallBudget * 0.8)));
      break;
    case "architecture_review":
      stableBudget = Math.min(overallBudget, Math.max(stableBudget, Math.ceil(overallBudget * 0.75)));
      localBudget = Math.min(overallBudget, Math.max(1, Math.ceil(overallBudget * 0.55)));
      recentBudget = Math.min(overallBudget, Math.max(recentBudget, 1));
      profileName = "documentation-biased";
      break;
    case "docs_update":
      stableBudget = Math.min(overallBudget, Math.max(stableBudget, Math.ceil(overallBudget * 0.75)));
      localBudget = Math.min(overallBudget, Math.max(1, Math.ceil(overallBudget * 0.5)));
      profileName = "documentation-biased";
      break;
    default:
      break;
  }

  return {
    overallBudget,
    stableBudget,
    localBudget,
    recentBudget,
    fallbackBudget: overallBudget,
    profileName,
    intentSubtype: input.intentSubtype
  };
}

function dedupeKinds(values: MemorySourceKind[]): MemorySourceKind[] {
  return Array.from(new Set(values));
}

export function evaluateTaskWaveStop(input: {
  waveName: RecallWaveName;
  taskStage: ContextTaskStage;
  budget: number;
  selectedCount: number;
  stableCount: number;
  projectCount: number;
  recentCount: number;
  knowledgeReserve: number;
  projectReserve: number;
  uniqueDocCount: number;
  topScore: number;
  averageScore: number;
  decisionCount: number;
}): TaskWaveStopDecision {
  const emptyDecision = {
    waveName: input.waveName,
    shouldStop: false,
    reason: null,
    coverageScore: 0,
    confidenceScore: 0,
    redundancyScore: 0,
    conflictScore: 0,
    finalScore: 0,
    threshold: thresholdForWave(input.waveName, input.taskStage)
  } satisfies TaskWaveStopDecision;

  if (input.selectedCount <= 0) {
    return emptyDecision;
  }

  const threshold = thresholdForWave(input.waveName, input.taskStage);
  const stableCoverage = Math.min(1, input.stableCount / Math.max(1, input.knowledgeReserve));
  const projectCoverage = Math.min(1, input.projectCount / Math.max(1, input.projectReserve));
  const budgetCoverage = Math.min(1, input.selectedCount / Math.max(1, input.budget));
  const recentCoverage = input.recentCount > 0 ? 1 : 0;
  const coverageScore = round4(calculateCoverageScore({
    waveName: input.waveName,
    stableCoverage,
    projectCoverage,
    budgetCoverage,
    recentCoverage
  }));
  const confidenceScore = round4(calculateConfidenceScore(input.topScore, input.averageScore));
  const redundancyScore = round4(
    input.selectedCount <= 1
      ? 0
      : clamp01(1 - input.uniqueDocCount / input.selectedCount)
  );
  const conflictScore = round4(calculateConflictScore(input));
  const finalScore = round4(
    coverageScore * 0.5 +
    confidenceScore * 0.35 +
    (1 - redundancyScore) * 0.1 +
    (1 - conflictScore) * 0.05
  );
  const legacyReason = legacyStopReason(input);
  const confidenceReason = confidenceStopReason(input.waveName);
  const shouldStop =
    (Boolean(legacyReason) && finalScore >= Math.max(0.55, threshold - 0.12)) ||
    (
      Boolean(confidenceReason) &&
      finalScore >= threshold &&
      coverageScore >= minimumCoverageForWave(input.waveName) &&
      conflictScore <= 0.55
    );
  const reason = shouldStop ? legacyReason ?? confidenceReason : null;

  return {
    waveName: input.waveName,
    shouldStop,
    reason,
    coverageScore,
    confidenceScore,
    redundancyScore,
    conflictScore,
    finalScore,
    threshold
  };
}

export function shouldStopTaskWave(input: Parameters<typeof evaluateTaskWaveStop>[0]): string | null {
  return evaluateTaskWaveStop(input).reason;
}

function legacyStopReason(input: {
  waveName: RecallWaveName;
  taskStage: ContextTaskStage;
  budget: number;
  selectedCount: number;
  stableCount: number;
  projectCount: number;
  recentCount: number;
  knowledgeReserve: number;
  projectReserve: number;
}): string | null {
  if (input.selectedCount <= 0) {
    return null;
  }

  if (input.waveName === "stable_memory") {
    if (input.taskStage === "document" && input.stableCount >= Math.min(input.budget, Math.max(2, input.knowledgeReserve))) {
      return "stable_memory_satisfied_document_stage";
    }
    return null;
  }

  if (input.waveName === "local_project") {
    if (input.selectedCount >= input.budget) {
      return "budget_satisfied_after_local_project";
    }

    if (
      input.projectCount >= Math.max(1, input.projectReserve) &&
      input.stableCount >= Math.min(input.knowledgeReserve, Math.max(1, input.selectedCount - input.projectCount))
    ) {
      return "balanced_context_ready_after_local_project";
    }

    return null;
  }

  if (input.waveName === "recent_history" && input.selectedCount > 0) {
    if (input.recentCount >= 1 || input.selectedCount >= Math.min(input.budget, Math.max(2, input.knowledgeReserve + input.projectReserve))) {
      return "recent_history_completed_context";
    }
  }

  return null;
}

function calculateCoverageScore(input: {
  waveName: RecallWaveName;
  stableCoverage: number;
  projectCoverage: number;
  budgetCoverage: number;
  recentCoverage: number;
}): number {
  if (input.waveName === "stable_memory") {
    return input.stableCoverage * 0.75 + input.budgetCoverage * 0.25;
  }

  if (input.waveName === "local_project") {
    return input.stableCoverage * 0.4 + input.projectCoverage * 0.35 + input.budgetCoverage * 0.25;
  }

  if (input.waveName === "recent_history") {
    return (
      input.stableCoverage * 0.25 +
      input.projectCoverage * 0.2 +
      input.budgetCoverage * 0.2 +
      input.recentCoverage * 0.35
    );
  }

  return input.budgetCoverage;
}

function calculateConfidenceScore(topScore: number, averageScore: number): number {
  const normalizedTop = clamp01(topScore / 0.75);
  const normalizedAverage = clamp01(averageScore / 0.55);
  return normalizedTop * 0.6 + normalizedAverage * 0.4;
}

function calculateConflictScore(input: {
  waveName: RecallWaveName;
  taskStage: ContextTaskStage;
  projectCount: number;
  decisionCount: number;
}): number {
  let score = 0;

  if (input.decisionCount >= 2 && input.taskStage !== "document") {
    score += 0.18 + Math.min(0.18, (input.decisionCount - 2) * 0.08);
  }

  if (input.waveName === "stable_memory" && input.projectCount === 0 && (input.taskStage === "debug" || input.taskStage === "implement")) {
    score += 0.16;
  }

  return clamp01(score);
}

function thresholdForWave(waveName: RecallWaveName, taskStage: ContextTaskStage): number {
  if (waveName === "stable_memory") {
    return taskStage === "document" ? 0.7 : 0.84;
  }

  if (waveName === "local_project") {
    return 0.68;
  }

  if (waveName === "recent_history") {
    return 0.62;
  }

  return 1;
}

function minimumCoverageForWave(waveName: RecallWaveName): number {
  if (waveName === "stable_memory") {
    return 0.72;
  }

  if (waveName === "local_project") {
    return 0.64;
  }

  if (waveName === "recent_history") {
    return 0.58;
  }

  return 1;
}

function confidenceStopReason(waveName: RecallWaveName): string | null {
  if (waveName === "stable_memory") {
    return "confidence_stop_after_stable_memory";
  }
  if (waveName === "local_project") {
    return "confidence_stop_after_local_project";
  }
  if (waveName === "recent_history") {
    return "confidence_stop_after_recent_history";
  }
  return null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
