import fs from "node:fs/promises";
import path from "node:path";
import { mindkeeperRoot } from "../config.js";
import { ensureProjectScaffold } from "../project.js";
import type {
  FlashCheckpointFreshness,
  FlashCheckpointInput,
  FlashCheckpointRecord,
  FlashCheckpointResult,
  FlashClearReport,
  FlashResumeReport
} from "../types.js";

const ACTIVE_FILENAME = "active.json";

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
      tags: cleanStringList(input.tags),
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
}

export async function readFlashCheckpoint(projectRoot: string): Promise<FlashCheckpointRecord | null> {
  const activePath = flashActivePath(projectRoot);
  try {
    const raw = await fs.readFile(activePath, "utf8");
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

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
