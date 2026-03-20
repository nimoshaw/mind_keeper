import fs from "node:fs/promises";
import path from "node:path";
import { mindkeeperRoot } from "../config.js";
import { clamp01, defaultMemoryTierForSource, defaultStabilityForSource, sha1, slugify } from "../memory-defaults.js";
import { ensureProjectScaffold } from "../project.js";
import type { MemorySourceKind, RememberDecisionInput, RememberInput, RememberLogInput } from "../types.js";
import { ProjectIndexService } from "./project-index-service.js";

export class MemoryWriteService {
  constructor(private readonly projectIndexService: ProjectIndexService) {}

  async remember(input: RememberInput): Promise<{ docId: string; chunkCount: number; path: string }> {
    await ensureProjectScaffold(input.projectRoot);
    const targetDir = path.join(mindkeeperRoot(input.projectRoot), sourceDir(input.sourceKind));
    await fs.mkdir(targetDir, { recursive: true });

    const safeTitle = slugify(input.title ?? `${input.sourceKind}-${Date.now()}`);
    const targetPath = path.join(targetDir, `${safeTitle}.md`);
    await fs.writeFile(targetPath, input.content.trim(), "utf8");

    const docId = `manual:${sha1(targetPath)}`;
    const memoryTier = input.memoryTier ?? defaultMemoryTierForSource(input.sourceKind);
    const stabilityScore = clamp01(input.stabilityScore ?? defaultStabilityForSource(input.sourceKind));
    const { chunkCount } = await this.projectIndexService.persistRememberedDocument({
      projectRoot: input.projectRoot,
      docId,
      sourceKind: input.sourceKind,
      absolutePath: targetPath,
      title: input.title,
      content: input.content.trim(),
      tags: input.tags ?? [],
      moduleName: input.moduleName,
      memoryTier,
      stabilityScore,
      distillConfidence: input.distillConfidence,
      distillReason: input.distillReason
    });

    return { docId, chunkCount, path: targetPath };
  }

  async rememberDecision(input: RememberDecisionInput): Promise<{ docId: string; chunkCount: number; path: string }> {
    const content = [
      `# ${input.title}`,
      "",
      "## Decision",
      input.decision.trim(),
      "",
      ...(input.rationale
        ? [
            "## Rationale",
            input.rationale.trim(),
            ""
          ]
        : []),
      ...(input.impact
        ? [
            "## Impact",
            input.impact.trim(),
            ""
          ]
        : []),
      ...(input.tags?.length
        ? [
            "## Tags",
            ...input.tags.map((tag) => `- ${tag}`),
            ""
          ]
        : [])
    ].join("\n");

    return this.remember({
      projectRoot: input.projectRoot,
      content,
      sourceKind: "decision",
      title: input.title,
      moduleName: input.moduleName,
      tags: input.tags,
      memoryTier: "stable",
      stabilityScore: 0.95,
      distillConfidence: 0.95,
      distillReason: "Structured decision memories are treated as stable long-term project knowledge."
    });
  }

  async rememberLog(input: RememberLogInput): Promise<{ docId: string; chunkCount: number; path: string }> {
    const content = [
      `# Log: ${input.event}`,
      "",
      `**Time**: ${new Date().toLocaleString()}`,
      input.model ? `**Model**: ${input.model}` : "",
      input.action ? `**Action**: ${input.action}` : "",
      input.testResult ? `**Test Result**: ${input.testResult}` : "",
      "",
      "## Details",
      input.notes || "No additional notes provided.",
      "",
      ...(input.tags?.length
        ? [
            "## Tags",
            ...input.tags.map((tag: string) => `- ${tag}`),
            ""
          ]
        : [])
    ].filter(Boolean).join("\n");

    return this.remember({
      projectRoot: input.projectRoot,
      content,
      sourceKind: "log",
      title: input.event,
      tags: input.tags,
      memoryTier: "working",
      stabilityScore: 0.5,
      distillConfidence: 0.8,
      distillReason: "Project logs record temporal progress and model performance observations."
    });
  }
}

function sourceDir(sourceKind: MemorySourceKind): string {
  switch (sourceKind) {
    case "manual":
      return "knowledge";
    case "decision":
      return "decisions";
    case "diary":
      return "diary";
    case "imported":
      return "imports";
    case "log":
      return "logs";
    default:
      return "other";
  }
}

