import type { ContextTaskStage, MemorySourceKind } from "./types.js";

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

export function buildTaskIntentPlan(input: {
  taskStage: ContextTaskStage;
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

  if (input.taskStage === "explore" && input.anchors.moduleName) {
    pushFocus("module");
  }

  if (input.anchors.relatedFiles.length > 0) {
    pushFocus("related_files");
  }

  if (input.taskStage !== "explore" && input.anchors.moduleName) {
    pushFocus("module");
  }

  pushFocus("broad_project");

  return {
    intentType: input.taskStage,
    anchors: input.anchors,
    queryPlan: {
      stableSourceKinds: ["manual", "decision"],
      localSourceKinds: ["project"],
      recentSourceKinds: ["diary", "imported"],
      fallbackSourceKinds: ["manual", "decision", "diary", "project", "imported"],
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
  budget: number;
  minScore: number;
}): RecallWaveDefinition[] {
  const safeBudget = Math.max(1, input.budget);
  const recentOptional = input.taskStage !== "debug" && input.taskStage !== "verify" && input.taskStage !== "explore";

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
      budget: safeBudget,
      minScore: input.minScore
    },
    {
      name: "local_project",
      label: "Local Project Wave",
      description: "Gather current-file, related-file, and module-local project context.",
      sourceKinds: ["project"],
      budget: safeBudget,
      minScore: input.minScore
    },
    {
      name: "recent_history",
      label: "Recent History Wave",
      description: "Only expand into diary and imported notes when the first two waves do not produce enough context.",
      sourceKinds: ["diary", "imported"],
      budget: safeBudget,
      minScore: Math.max(0, input.minScore - 0.03),
      optional: recentOptional
    },
    {
      name: "fallback",
      label: "Fallback Wave",
      description: "As a last resort, relax thresholds and search across all sources.",
      sourceKinds: ["manual", "decision", "diary", "project", "imported"],
      budget: safeBudget,
      minScore: 0,
      optional: true
    }
  ];
}

export function shouldStopTaskWave(input: {
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
