import fs from "node:fs/promises";
import { ensureProjectScaffold } from "../project.js";
import { MindKeeperStorage } from "../storage.js";
import type { ForgetInput, MemorySourceKind, MemoryTier, RateSourceInput, ToggleSourceInput } from "../types.js";

export class SourceService {
  async forget(input: ForgetInput): Promise<{ deleted: boolean; docId: string | null; reason: string }> {
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      let docId = input.docId ?? null;
      let targetPath = input.path ?? null;

      if (!docId && input.path) {
        const resolved = storage.findDocumentByPath(input.path);
        docId = resolved?.docId ?? null;
        targetPath = input.path;
      }

      if (docId && !targetPath) {
        const source = storage.listSources().find((item) => item.docId === docId);
        targetPath = source?.path ?? null;
      }

      if (!docId) {
        return {
          deleted: false,
          docId: null,
          reason: "No matching memory document was found."
        };
      }

      storage.deleteDocument(docId);
      if (targetPath) {
        await fs.rm(targetPath, { force: true });
      }
      return {
        deleted: true,
        docId,
        reason: "Memory document file and its indexed chunks were removed."
      };
    } finally {
      storage.close();
    }
  }

  async disableSource(input: ToggleSourceInput): Promise<{ updated: boolean; docId: string | null; reason: string }> {
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const docId = resolveDocId(storage, input.docId, input.path);
      if (!docId) {
        return {
          updated: false,
          docId: null,
          reason: "No matching memory source was found."
        };
      }

      storage.disableSource(docId, input.reason);
      storage.recordSourceFeedback(docId, "noisy");
      return {
        updated: true,
        docId,
        reason: "The memory source is now disabled and excluded from recall results."
      };
    } finally {
      storage.close();
    }
  }

  async enableSource(input: ToggleSourceInput): Promise<{ updated: boolean; docId: string | null; reason: string }> {
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const docId = resolveDocId(storage, input.docId, input.path);
      if (!docId) {
        return {
          updated: false,
          docId: null,
          reason: "No matching memory source was found."
        };
      }

      const updated = storage.enableSource(docId);
      return {
        updated,
        docId,
        reason: updated
          ? "The memory source is enabled again and can participate in recall."
          : "The memory source was already enabled."
      };
    } finally {
      storage.close();
    }
  }

  async rateSource(input: RateSourceInput): Promise<{ updated: boolean; docId: string | null; signal: "helpful" | "noisy"; reason: string }> {
    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const docId = resolveDocId(storage, input.docId, input.path);
      if (!docId) {
        return {
          updated: false,
          docId: null,
          signal: input.signal,
          reason: "No matching memory source was found."
        };
      }

      storage.recordSourceFeedback(docId, input.signal);
      return {
        updated: true,
        docId,
        signal: input.signal,
        reason: input.signal === "helpful"
          ? "Recorded a helpful signal for this memory source."
          : "Recorded a noisy signal for this memory source."
      };
    } finally {
      storage.close();
    }
  }

  async listSources(projectRoot: string): Promise<Array<{
    docId: string;
    path: string;
    relativePath: string | null;
    sourceKind: string;
    title: string | null;
    chunkCount: number;
    updatedAt: number;
    isDisabled: boolean;
    disabledAt: number | null;
    disabledReason: string | null;
    helpfulVotes: number;
    noisyVotes: number;
    lastFeedbackAt: number | null;
    memoryTier: MemoryTier | null;
    stabilityScore: number | null;
    distillConfidence: number | null;
    distillReason: string | null;
  }>> {
    await ensureProjectScaffold(projectRoot);
    const storage = new MindKeeperStorage(projectRoot);
    try {
      return storage.listSources();
    } finally {
      storage.close();
    }
  }

  async listBranchViews(projectRoot: string): Promise<Array<{
    branchName: string | null;
    docCount: number;
    chunkCount: number;
    lastUpdatedAt: number;
    disabledCount: number;
    sourceCounts: Record<MemorySourceKind, number>;
  }>> {
    await ensureProjectScaffold(projectRoot);
    const storage = new MindKeeperStorage(projectRoot);
    try {
      return storage.listBranchViews();
    } finally {
      storage.close();
    }
  }
}

function resolveDocId(storage: MindKeeperStorage, docId?: string | null, filePath?: string): string | null {
  if (docId) {
    return docId;
  }
  if (!filePath) {
    return null;
  }
  return storage.findDocumentByPath(filePath)?.docId ?? null;
}
