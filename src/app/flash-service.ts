import fs from "node:fs/promises";
import path from "node:path";
import { mindkeeperRoot } from "../config.js";
import { ensureProjectScaffold } from "../project.js";
import type {
  ContextTaskStage,
  FlashCheckpointFreshness,
  FlashCheckpointInput,
  FlashCheckpointRecord,
  FlashCheckpointResult,
  FlashClearReport,
  FlashResumeReport,
  TaskIntentSubtype
} from "../types.js";

const ACTIVE_FILENAME = "active.json";
const DRAFT_FILENAME = "draft.json";
const AUTO_PROMOTION_MIN_INTERVAL_MS = 90_000;
const AUTO_DRAFT_MIN_INTERVAL_MS = 20_000;
const MANUAL_ACTIVE_GRACE_MS = 30 * 60_000;

type AutoFlashObservation = {
  projectRoot: string;
  task: string;
  currentFile?: string;
  currentSymbol?: string;
  diagnostics?: string;
  branchName?: string | null;
  relatedFiles: string[];
  selectedPaths: string[];
  intentType: ContextTaskStage;
  intentSubtype: TaskIntentSubtype;
  explainHeadline: string;
  nextActions: string[];
  stopReason: string;
  conflictSubjects: string[];
};

export class FlashService {
  async checkpoint(input: FlashCheckpointInput): Promise<FlashCheckpointResult> {
    await ensureProjectScaffold(input.projectRoot);
    const root = flashRoot(input.projectRoot);
    const historyRoot = flashHistoryRoot(input.projectRoot);
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(historyRoot, { recursive: true });

    const now = Date.now();
    const checkpoint: FlashCheckpointRecord = {
      id: buildCheckpointId(now, input.title),
      title: input.title.trim(),
      sessionGoal: input.sessionGoal.trim(),
      currentStatus: input.currentStatus.trim(),
      workingMemory: input.workingMemory?.trim() ?? "",
      nextSteps: cleanStringList(input.nextSteps),
      blockers: cleanStringList(input.blockers),
      openQuestions: cleanStringList(input.openQuestions),
      branchName: input.branchName?.trim() || null,
      touchedFiles: cleanPathList(input.touchedFiles),
      importantCommands: cleanStringList(input.importantCommands),
      tags: cleanStringList(["flash", "manual", ...(input.tags ?? [])]),
      createdAt: now,
      updatedAt: now
    };

    const activePath = flashActivePath(input.projectRoot);
    const historyPath = path.join(historyRoot, `${checkpoint.id}.json`);
    const payload = JSON.stringify(checkpoint, null, 2);
    await fs.writeFile(activePath, payload, "utf8");
    await fs.writeFile(historyPath, payload, "utf8");

    return {
      projectRoot: input.projectRoot,
      activePath,
      historyPath,
      checkpoint,
      summary: `Saved flash checkpoint "${checkpoint.title}" with ${checkpoint.nextSteps.length} next steps.`
    };
  }

  async resume(projectRoot: string): Promise<FlashResumeReport> {
    await ensureProjectScaffold(projectRoot);
    const activePath = flashActivePath(projectRoot);
    const checkpoint = await readFlashCheckpoint(projectRoot);
    if (!checkpoint) {
      return {
        projectRoot,
        found: false,
        activePath,
        checkpoint: null,
        freshness: null,
        ageHours: null,
        shouldInject: false,
        resumePrompt: null,
        summary: "No active flash checkpoint is available for this project."
      };
    }

    const ageHours = Math.max(0, (Date.now() - checkpoint.updatedAt) / 3_600_000);
    const freshness = classifyFreshness(ageHours);
    const shouldInject = freshness !== "stale";
    return {
      projectRoot,
      found: true,
      activePath,
      checkpoint,
      freshness,
      ageHours: round2(ageHours),
      shouldInject,
      resumePrompt: buildResumePrompt(checkpoint, freshness),
      summary: `Loaded ${freshness} flash checkpoint "${checkpoint.title}".`
    };
  }

  async clear(projectRoot: string): Promise<FlashClearReport> {
    await ensureProjectScaffold(projectRoot);
    const activePath = flashActivePath(projectRoot);
    let cleared = false;
    try {
      await fs.unlink(activePath);
      cleared = true;
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }

    return {
      projectRoot,
      cleared,
      activePath,
      summary: cleared ? "Cleared the active flash checkpoint." : "No active flash checkpoint was present."
    };
  }

  async observeTaskContext(observation: AutoFlashObservation): Promise<FlashCheckpointRecord | null> {
    await ensureProjectScaffold(observation.projectRoot);
    const root = flashRoot(observation.projectRoot);
    await fs.mkdir(root, { recursive: true });

    const now = Date.now();
    const candidate = buildAutoCheckpoint(observation, now);
    if (!candidate) {
      return null;
    }

    const [draft, active] = await Promise.all([
      readFlashFile(flashDraftPath(observation.projectRoot)),
      readFlashFile(flashActivePath(observation.projectRoot))
    ]);

    if (shouldWriteDraft(draft, candidate, now)) {
      const nextDraft = mergeCheckpointWithExisting(candidate, draft);
      await writeFlashFile(flashDraftPath(observation.projectRoot), nextDraft);
    }

    if (!shouldPromoteActive(active, candidate, now)) {
      return active;
    }

    const nextActive = mergeCheckpointWithExisting(candidate, active);
    await writeFlashFile(flashActivePath(observation.projectRoot), nextActive);
    return nextActive;
  }
}

export async function readFlashCheckpoint(projectRoot: string): Promise<FlashCheckpointRecord | null> {
  return readFlashFile(flashActivePath(projectRoot));
}

export function classifyFreshness(ageHours: number): FlashCheckpointFreshness {
  if (ageHours <= 72) {
    return "fresh";
  }
  if (ageHours <= 24 * 14) {
    return "recent";
  }
  return "stale";
}

export function buildResumePrompt(
  checkpoint: FlashCheckpointRecord,
  freshness: FlashCheckpointFreshness
): string {
  const lines = [
    `Resume ${freshness} work context: ${checkpoint.title}`,
    `Goal: ${checkpoint.sessionGoal}`,
    `Status: ${checkpoint.currentStatus}`
  ];

  if (checkpoint.workingMemory) {
    lines.push(`Working memory: ${checkpoint.workingMemory}`);
  }
  if (checkpoint.nextSteps.length) {
    lines.push(`Next steps: ${checkpoint.nextSteps.join(" | ")}`);
  }
  if (checkpoint.blockers.length) {
    lines.push(`Blockers: ${checkpoint.blockers.join(" | ")}`);
  }
  if (checkpoint.openQuestions.length) {
    lines.push(`Open questions: ${checkpoint.openQuestions.join(" | ")}`);
  }
  if (checkpoint.branchName) {
    lines.push(`Branch: ${checkpoint.branchName}`);
  }
  if (checkpoint.touchedFiles.length) {
    lines.push(`Touched files: ${checkpoint.touchedFiles.join(", ")}`);
  }

  return lines.join("\n");
}

function flashRoot(projectRoot: string): string {
  return path.join(mindkeeperRoot(projectRoot), "flash");
}

function flashHistoryRoot(projectRoot: string): string {
  return path.join(flashRoot(projectRoot), "history");
}

function flashActivePath(projectRoot: string): string {
  return path.join(flashRoot(projectRoot), ACTIVE_FILENAME);
}

function flashDraftPath(projectRoot: string): string {
  return path.join(flashRoot(projectRoot), DRAFT_FILENAME);
}

function cleanStringList(values: string[] | undefined): string[] {
  return dedupeStrings(values ?? []);
}

function cleanPathList(values: string[] | undefined): string[] {
  return dedupeStrings((values ?? []).map((value) => value.replace(/\\/g, "/")));
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function buildCheckpointId(timestamp: number, title: string): string {
  const safeTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "flash";

  return `${new Date(timestamp).toISOString().replace(/[:.]/g, "-")}-${safeTitle}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildAutoCheckpoint(
  observation: AutoFlashObservation,
  now: number
): FlashCheckpointRecord | null {
  const task = observation.task.trim();
  if (!task) {
    return null;
  }

  const touchedFiles = cleanPathList([
    ...(observation.currentFile ? [observation.currentFile] : []),
    ...observation.relatedFiles,
    ...observation.selectedPaths
  ]).slice(0, 8);
  const blockers = deriveBlockers(observation);
  const nextSteps = cleanStringList(observation.nextActions).slice(0, 4);
  const workingMemory = [
    observation.currentSymbol ? `Current symbol: ${observation.currentSymbol}` : "",
    observation.stopReason ? `Stop reason: ${observation.stopReason}` : "",
    observation.diagnostics?.trim() ? `Diagnostics: ${truncateLine(observation.diagnostics.trim(), 220)}` : "",
    observation.conflictSubjects.length ? `Conflict subjects: ${observation.conflictSubjects.join(", ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: buildCheckpointId(now, buildAutoTitle(observation)),
    title: buildAutoTitle(observation),
    sessionGoal: task,
    currentStatus: observation.explainHeadline.trim() || `Continue ${task}`,
    workingMemory,
    nextSteps,
    blockers,
    openQuestions: [],
    branchName: observation.branchName?.trim() || null,
    touchedFiles,
    importantCommands: [],
    tags: cleanStringList(["flash", "auto", observation.intentType, observation.intentSubtype]),
    createdAt: now,
    updatedAt: now
  };
}

function buildAutoTitle(observation: AutoFlashObservation): string {
  const currentFile = observation.currentFile ? path.basename(observation.currentFile) : "";
  const task = observation.task.trim().replace(/\s+/g, " ");
  if (currentFile) {
    return truncateLine(`${currentFile}: ${task}`, 72);
  }
  return truncateLine(task, 72);
}

function deriveBlockers(observation: AutoFlashObservation): string[] {
  const output: string[] = [];
  if (observation.diagnostics?.trim()) {
    output.push(truncateLine(observation.diagnostics.trim(), 180));
  }
  for (const subject of observation.conflictSubjects) {
    output.push(`Resolve conflict around ${subject}`);
  }
  return cleanStringList(output).slice(0, 3);
}

async function readFlashFile(filePath: string): Promise<FlashCheckpointRecord | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<FlashCheckpointRecord>;
    if (!parsed.id || !parsed.title || !parsed.sessionGoal || !parsed.currentStatus) {
      return null;
    }

    return {
      id: parsed.id,
      title: parsed.title,
      sessionGoal: parsed.sessionGoal,
      currentStatus: parsed.currentStatus,
      workingMemory: parsed.workingMemory ?? "",
      nextSteps: cleanStringList(parsed.nextSteps),
      blockers: cleanStringList(parsed.blockers),
      openQuestions: cleanStringList(parsed.openQuestions),
      branchName: parsed.branchName?.trim() || null,
      touchedFiles: cleanPathList(parsed.touchedFiles),
      importantCommands: cleanStringList(parsed.importantCommands),
      tags: cleanStringList(parsed.tags),
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now()
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeFlashFile(filePath: string, checkpoint: FlashCheckpointRecord): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), "utf8");
}

function shouldWriteDraft(
  existingDraft: FlashCheckpointRecord | null,
  candidate: FlashCheckpointRecord,
  now: number
): boolean {
  if (!existingDraft) {
    return true;
  }

  if (fingerprint(existingDraft) !== fingerprint(candidate)) {
    return true;
  }

  return now - existingDraft.updatedAt >= AUTO_DRAFT_MIN_INTERVAL_MS;
}

function shouldPromoteActive(
  currentActive: FlashCheckpointRecord | null,
  candidate: FlashCheckpointRecord,
  now: number
): boolean {
  if (!currentActive) {
    return true;
  }

  if (fingerprint(currentActive) === fingerprint(candidate)) {
    return false;
  }

  const activeIsManual = currentActive.tags.includes("manual") && !currentActive.tags.includes("auto");
  if (activeIsManual && now - currentActive.updatedAt < MANUAL_ACTIVE_GRACE_MS) {
    return false;
  }

  return now - currentActive.updatedAt >= AUTO_PROMOTION_MIN_INTERVAL_MS || isMajorShift(currentActive, candidate);
}

function mergeCheckpointWithExisting(
  candidate: FlashCheckpointRecord,
  existing: FlashCheckpointRecord | null
): FlashCheckpointRecord {
  if (!existing || fingerprint(existing) !== fingerprint(candidate)) {
    return candidate;
  }

  return {
    ...candidate,
    id: existing.id,
    createdAt: existing.createdAt
  };
}

function fingerprint(checkpoint: FlashCheckpointRecord): string {
  return JSON.stringify({
    title: checkpoint.title,
    sessionGoal: checkpoint.sessionGoal,
    currentStatus: checkpoint.currentStatus,
    branchName: checkpoint.branchName,
    touchedFiles: checkpoint.touchedFiles,
    nextSteps: checkpoint.nextSteps,
    blockers: checkpoint.blockers
  });
}

function isMajorShift(left: FlashCheckpointRecord, right: FlashCheckpointRecord): boolean {
  if ((left.branchName ?? "") !== (right.branchName ?? "")) {
    return true;
  }

  if (left.sessionGoal.trim().toLowerCase() !== right.sessionGoal.trim().toLowerCase()) {
    return true;
  }

  const leftPrimary = left.touchedFiles[0] ?? "";
  const rightPrimary = right.touchedFiles[0] ?? "";
  return leftPrimary !== rightPrimary;
}

function truncateLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
