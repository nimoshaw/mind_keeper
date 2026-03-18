import { repairProfileRegistry, validateActiveProfileIndex } from "../profile-registry.js";
import type {
  ProfileIndexRecoveryFailure,
  ProfileIndexRecoveryReport,
  ProfileIndexRecoveryFailureCode,
  ProfileIndexRecoveryStrategy,
  ProfileIndexValidationReport
} from "../types.js";
import { ProjectIndexService } from "./project-index-service.js";

type RecoverActiveProfileIndexInput = {
  projectRoot: string;
  strategy?: ProfileIndexRecoveryStrategy;
  autoRepair?: boolean;
  autoRebuild?: boolean;
  autoIndex?: boolean;
  forceIndex?: boolean;
  dryRun?: boolean;
};

export class ProfileOpsService {
  constructor(private readonly projectIndexService: ProjectIndexService) {}

  async recoverActiveProfileIndex(input: RecoverActiveProfileIndexInput): Promise<ProfileIndexRecoveryReport> {
    const startedAt = Date.now();
    const strategy = input.strategy ?? "standard";
    const strategyDefaults = resolveStrategyDefaults(strategy);
    const autoRepair = input.autoRepair ?? strategyDefaults.autoRepair;
    const autoRebuild = input.autoRebuild ?? strategyDefaults.autoRebuild;
    const autoIndex = input.autoIndex ?? strategyDefaults.autoIndex;
    const forceIndex = input.forceIndex ?? strategyDefaults.forceIndex;
    const dryRun = input.dryRun ?? false;
    const initialValidation = await validateActiveProfileIndex(input.projectRoot);
    const steps: ProfileIndexRecoveryReport["steps"] = [];

    let currentValidation = initialValidation;
    let repairReport: ProfileIndexRecoveryReport["repairReport"] = null;
    let rebuildReport: ProfileIndexRecoveryReport["rebuildReport"] = null;
    let indexProjectResult: ProfileIndexRecoveryReport["indexProjectResult"] = null;
    let failedAction: ProfileIndexRecoveryReport["failedAction"] = null;
    let failure: ProfileIndexRecoveryReport["failure"] = null;
    let errorMessage: string | null = null;

    if (currentValidation.recommendedAction === "repair_profile_registry") {
      if (dryRun) {
        steps.push({
          action: "repair_profile_registry",
          status: "planned",
          reason: "Would repair missing config or profile descriptors before continuing recovery.",
          recommendedActionAfter: currentValidation.recommendedAction
        });
      } else if (autoRepair) {
        try {
          repairReport = await repairProfileRegistry(input.projectRoot);
          currentValidation = repairReport.validationAfter;
          steps.push({
            action: "repair_profile_registry",
            status: "executed",
            reason: "Repaired missing config or profile descriptors before continuing recovery.",
            recommendedActionAfter: currentValidation.recommendedAction
          });
        } catch (error) {
          failedAction = "repair_profile_registry";
          errorMessage = getErrorMessage(error);
          failure = classifyRecoveryFailure(error, failedAction);
          steps.push({
            action: "repair_profile_registry",
            status: "failed",
            reason: "Tried to repair missing config or profile descriptors before continuing recovery.",
            recommendedActionAfter: currentValidation.recommendedAction,
            failureCode: failure.code,
            errorMessage
          });
        }
      } else {
        steps.push({
          action: "repair_profile_registry",
          status: "skipped",
          reason: "autoRepair is disabled, so registry repair was not executed.",
          recommendedActionAfter: currentValidation.recommendedAction
        });
      }
    }

    if (!failedAction && currentValidation.recommendedAction === "rebuild_active_profile_index") {
      if (dryRun) {
        steps.push({
          action: "rebuild_active_profile_index",
          status: "planned",
          reason: "Would rebuild the active embedding profile index from canonical memory and project files.",
          recommendedActionAfter: currentValidation.recommendedAction
        });
      } else if (autoRebuild) {
        try {
          rebuildReport = await this.projectIndexService.rebuildActiveProfileIndex(input.projectRoot);
          currentValidation = rebuildReport.validationAfter;
          steps.push({
            action: "rebuild_active_profile_index",
            status: "executed",
            reason: "Rebuilt the active embedding profile index from canonical memory and project files.",
            recommendedActionAfter: currentValidation.recommendedAction
          });
        } catch (error) {
          failedAction = "rebuild_active_profile_index";
          errorMessage = getErrorMessage(error);
          failure = classifyRecoveryFailure(error, failedAction);
          steps.push({
            action: "rebuild_active_profile_index",
            status: "failed",
            reason: "Tried to rebuild the active embedding profile index from canonical memory and project files.",
            recommendedActionAfter: currentValidation.recommendedAction,
            failureCode: failure.code,
            errorMessage
          });
        }
      } else {
        steps.push({
          action: "rebuild_active_profile_index",
          status: "skipped",
          reason: "autoRebuild is disabled, so index rebuild was not executed.",
          recommendedActionAfter: currentValidation.recommendedAction
        });
      }
    }

    if (!failedAction && currentValidation.recommendedAction === "index_project") {
      if (dryRun) {
        steps.push({
          action: "index_project",
          status: "planned",
          reason: "Would index project files so the active profile index is ready for retrieval.",
          recommendedActionAfter: currentValidation.recommendedAction
        });
      } else if (autoIndex) {
        try {
          indexProjectResult = await this.projectIndexService.indexProject(input.projectRoot, { force: forceIndex });
          currentValidation = await validateActiveProfileIndex(input.projectRoot);
          steps.push({
            action: "index_project",
            status: "executed",
            reason: "Indexed project files so the active profile index is ready for retrieval.",
            recommendedActionAfter: currentValidation.recommendedAction
          });
        } catch (error) {
          failedAction = "index_project";
          errorMessage = getErrorMessage(error);
          failure = classifyRecoveryFailure(error, failedAction);
          steps.push({
            action: "index_project",
            status: "failed",
            reason: "Tried to index project files so the active profile index would be ready for retrieval.",
            recommendedActionAfter: currentValidation.recommendedAction,
            failureCode: failure.code,
            errorMessage
          });
        }
      } else {
        steps.push({
          action: "index_project",
          status: "skipped",
          reason: "autoIndex is disabled, so project indexing was not executed.",
          recommendedActionAfter: currentValidation.recommendedAction
        });
      }
    }

    const finalValidation =
      !dryRun && !failedAction && steps.length > 0 && currentValidation.recommendedAction !== "none"
        ? await validateActiveProfileIndex(input.projectRoot)
        : currentValidation;
    const resolved = !dryRun && !failedAction && finalValidation.recommendedAction === "none";
    const manualActions = buildManualActions(finalValidation, dryRun, failedAction, failure);
    const summary = buildRecoverySummary(initialValidation, finalValidation, steps, resolved, dryRun, failedAction);

    return {
      projectRoot: input.projectRoot,
      startedAt,
      completedAt: Date.now(),
      options: {
        strategy,
        autoRepair,
        autoRebuild,
        autoIndex,
        forceIndex,
        dryRun
      },
      initialValidation,
      steps,
      repairReport,
      rebuildReport,
      indexProjectResult,
      finalValidation,
      failedAction,
      failure,
      errorMessage,
      manualActions,
      resolved,
      summary
    };
  }
}

function buildRecoverySummary(
  initialValidation: ProfileIndexValidationReport,
  finalValidation: ProfileIndexValidationReport,
  steps: ProfileIndexRecoveryReport["steps"],
  resolved: boolean,
  dryRun: boolean,
  failedAction: ProfileIndexRecoveryReport["failedAction"]
): string {
  if (dryRun) {
    if (steps.length === 0) {
      return "Dry run found no recovery action to plan because the active profile index is already healthy.";
    }
    return `Dry run planned ${steps.length} action(s). Current recommendation remains "${initialValidation.recommendedAction}".`;
  }

  if (failedAction) {
    return `Recovery stopped because "${failedAction}" failed. Current recommendation remains "${finalValidation.recommendedAction}".`;
  }

  if (resolved) {
    if (steps.length === 0) {
      return "Active profile index was already healthy; no recovery action was needed.";
    }
    return `Recovery completed successfully after ${steps.length} action(s).`;
  }

  if (steps.length === 0) {
    return `No recovery action ran. Active recommendation remains "${initialValidation.recommendedAction}".`;
  }

  return `Recovery executed ${steps.length} action(s), but further work is still required: "${finalValidation.recommendedAction}".`;
}

function buildManualActions(
  finalValidation: ProfileIndexValidationReport,
  dryRun: boolean,
  failedAction: ProfileIndexRecoveryReport["failedAction"],
  failure: ProfileIndexRecoveryReport["failure"]
): ProfileIndexRecoveryReport["manualActions"] {
  const actions: ProfileIndexRecoveryReport["manualActions"] = [];
  const addAction = (action: ProfileIndexRecoveryReport["manualActions"][number]["action"], reason: string) => {
    if (!actions.some((item) => item.action === action)) {
      actions.push({ action, reason });
    }
  };

  if (dryRun) {
    addAction(finalValidation.recommendedAction === "none" ? "inspect_memory_access_surface" : finalValidation.recommendedAction, "Dry run only planned the recovery path and did not make changes.");
  }

  if (failedAction) {
    addAction(failedAction, "The last recovery attempt failed and should be reviewed before retrying.");
    addAction("inspect_memory_access_surface", "Inspect canonical/profile state before retrying or handing the project to another agent.");
  }

  if (failure?.code === "missing_embedding_api_key") {
    addAction("set_environment_variable", `Set ${failure.envVarName ?? "the required API key env var"} before retrying the active embedding profile.`);
    addAction("review_project_config", "Review whether the active embedding profile should stay remote or switch back to a local hash profile.");
  }

  if (failure?.code === "invalid_embedding_profile_config" || failure?.code === "unknown_embedding_profile") {
    addAction("review_project_config", "Fix the active embedding profile definition in .mindkeeper/config.toml before retrying recovery.");
  }

  if (finalValidation.recommendedAction === "review_project_config") {
    addAction("review_project_config", "The current project config must be corrected before profile validation or recovery can continue.");
  }

  if (finalValidation.recommendedAction !== "none") {
    addAction(finalValidation.recommendedAction, "The active profile index still needs this action before it is fully reusable.");
  } else if (!dryRun) {
    addAction("inspect_memory_access_surface", "Optional final inspection can confirm the project is safe for cross-agent reuse.");
  }

  return actions;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function classifyRecoveryFailure(
  error: unknown,
  action: ProfileIndexRecoveryReport["failedAction"]
): ProfileIndexRecoveryFailure {
  const detail = getErrorMessage(error);
  const missingApiKeyMatch = detail.match(/^Environment variable ([A-Z0-9_]+) is required for embedding profile "([^"]+)"\./);
  if (missingApiKeyMatch) {
    return {
      code: "missing_embedding_api_key",
      action,
      summary: `The active embedding profile needs ${missingApiKeyMatch[1]} before recovery can continue.`,
      detail,
      retryable: true,
      envVarName: missingApiKeyMatch[1],
      profileName: missingApiKeyMatch[2]
    };
  }

  const invalidProfileMatch = detail.match(/^Embedding profile "([^"]+)" is missing model\/baseUrl\/apiKeyEnv\./);
  if (invalidProfileMatch) {
    return {
      code: "invalid_embedding_profile_config",
      action,
      summary: `The active embedding profile "${invalidProfileMatch[1]}" is missing required connection fields.`,
      detail,
      retryable: false,
      profileName: invalidProfileMatch[1]
    };
  }

  const unknownProfileMatch = detail.match(/^Unknown embedding profile "([^"]+)"\./);
  if (unknownProfileMatch) {
    return {
      code: "unknown_embedding_profile",
      action,
      summary: `The active embedding profile "${unknownProfileMatch[1]}" does not exist in config.`,
      detail,
      retryable: false,
      profileName: unknownProfileMatch[1]
    };
  }

  if (/returned an empty vector/i.test(detail)) {
    return {
      code: "embedding_provider_empty_vector",
      action,
      summary: "The embedding provider returned an empty vector, so the profile rebuild could not complete.",
      detail,
      retryable: true
    };
  }

  if (/(connect|timeout|fetch failed|econnrefused|enotfound|401|403|429)/i.test(detail)) {
    return {
      code: "embedding_provider_request_failed",
      action,
      summary: "The embedding provider request failed during recovery.",
      detail,
      retryable: true
    };
  }

  return {
    code: "unknown_error",
    action,
    summary: "Recovery failed for an unexpected reason.",
    detail,
    retryable: false
  };
}

function resolveStrategyDefaults(
  strategy: ProfileIndexRecoveryStrategy
): Pick<ProfileIndexRecoveryReport["options"], "autoRepair" | "autoRebuild" | "autoIndex" | "forceIndex"> {
  switch (strategy) {
    case "safe":
      return {
        autoRepair: true,
        autoRebuild: false,
        autoIndex: false,
        forceIndex: false
      };
    case "aggressive":
      return {
        autoRepair: true,
        autoRebuild: true,
        autoIndex: true,
        forceIndex: true
      };
    case "standard":
    default:
      return {
        autoRepair: true,
        autoRebuild: true,
        autoIndex: true,
        forceIndex: false
      };
  }
}
