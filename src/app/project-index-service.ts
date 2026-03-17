import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import ignore from "ignore";
import { loadConfig, mindkeeperRoot } from "../config.js";
import { normalize, EmbeddingService } from "../embedding.js";
import { buildDocumentEdges } from "../graph.js";
import { detectGitBranch } from "../git.js";
import {
  clamp01,
  defaultMemoryTierForSource,
  defaultStabilityForSource,
  relativeToProject,
  sha1,
  topLevelModule
} from "../memory-defaults.js";
import { ensureProjectScaffold } from "../project.js";
import {
  detectLanguage as detectIndexedLanguage,
  extractSymbolSpans as extractIndexedSymbolSpans,
  inferSymbolName as inferIndexedSymbolName,
  symbolForChunk as symbolForIndexedChunk
} from "../symbols.js";
import { MindKeeperStorage } from "../storage.js";
import { chunkTextWithOffsets } from "../text.js";
import type { IndexProjectResult, MemoryTier, RememberInput } from "../types.js";

type PersistDocumentInput = {
  storage: MindKeeperStorage;
  projectRoot: string;
  docId: string;
  sourceKind: RememberInput["sourceKind"] | "project";
  absolutePath: string;
  relativePath: string;
  title?: string;
  content: string;
  tags: string[];
  moduleName?: string;
  language?: string;
  symbol?: string;
  branchName?: string;
  memoryTier?: MemoryTier;
  stabilityScore?: number;
  distillConfidence?: number;
  distillReason?: string;
  checksum: string;
  mtimeMs: number;
  sizeBytes: number;
  embeddingProfileName: string;
  chunkSize: number;
  chunkOverlap: number;
};

export class ProjectIndexService {
  constructor(private readonly embeddingService: EmbeddingService) {}

  async persistRememberedDocument(input: {
    projectRoot: string;
    docId: string;
    sourceKind: RememberInput["sourceKind"];
    absolutePath: string;
    title?: string;
    content: string;
    tags: string[];
    moduleName?: string;
    memoryTier?: MemoryTier;
    stabilityScore?: number;
    distillConfidence?: number;
    distillReason?: string;
  }): Promise<{ chunkCount: number; branchName: string | null }> {
    const config = await ensureProjectScaffold(input.projectRoot);
    const profile = this.getActiveProfile(config);
    const stat = await fs.stat(input.absolutePath);
    const gitBranch = await detectGitBranch(input.projectRoot);
    const language = detectIndexedLanguage(input.absolutePath);
    const symbol = inferIndexedSymbolName(input.title ?? path.basename(input.absolutePath), input.content, true, input.absolutePath, true);

    const storage = new MindKeeperStorage(input.projectRoot);
    try {
      const chunkCount = await this.persistDocument({
        storage,
        projectRoot: input.projectRoot,
        docId: input.docId,
        sourceKind: input.sourceKind,
        absolutePath: input.absolutePath,
        relativePath: relativeToProject(input.projectRoot, input.absolutePath),
        title: input.title,
        content: input.content,
        tags: input.tags,
        moduleName: input.moduleName,
        language: language ?? undefined,
        symbol: symbol ?? undefined,
        branchName: gitBranch ?? undefined,
        memoryTier: input.memoryTier ?? defaultMemoryTierForSource(input.sourceKind),
        stabilityScore: clamp01(input.stabilityScore ?? defaultStabilityForSource(input.sourceKind)),
        distillConfidence: input.distillConfidence,
        distillReason: input.distillReason,
        checksum: sha1(input.content),
        mtimeMs: Math.floor(stat.mtimeMs),
        sizeBytes: stat.size,
        embeddingProfileName: profile.name,
        chunkSize: config.indexing.chunkSize,
        chunkOverlap: config.indexing.chunkOverlap
      });

      return {
        chunkCount,
        branchName: gitBranch
      };
    } finally {
      storage.close();
    }
  }

  async indexProject(projectRoot: string, options?: { force?: boolean }): Promise<IndexProjectResult> {
    const config = await ensureProjectScaffold(projectRoot);
    const profile = this.getActiveProfile(config);
    const ig = ignore().add(config.indexing.excludeGlobs.map((pattern) => pattern.replace("**/", "")));
    const gitBranch = await detectGitBranch(projectRoot);
    const relativePaths = await fg(config.indexing.includeGlobs, {
      cwd: projectRoot,
      onlyFiles: true,
      dot: false,
      unique: true,
      ignore: config.indexing.excludeGlobs
    });

    const storage = new MindKeeperStorage(projectRoot);
    let indexedFiles = 0;
    let skippedFiles = 0;
    let unchangedFiles = 0;
    let removedFiles = 0;
    const seenPaths = new Set<string>();

    try {
      for (const relativePath of relativePaths) {
        if (ig.ignores(relativePath)) {
          skippedFiles += 1;
          continue;
        }

        const absolutePath = path.join(projectRoot, relativePath);
        seenPaths.add(absolutePath);
        const stat = await fs.stat(absolutePath);
        if (stat.size > config.indexing.maxFileBytes) {
          skippedFiles += 1;
          continue;
        }

        const manifest = storage.getManifestByPath("project", absolutePath);
        const mtimeMs = Math.floor(stat.mtimeMs);

        if (
          !options?.force &&
          manifest &&
          manifest.mtimeMs === mtimeMs &&
          manifest.sizeBytes === stat.size &&
          manifest.embeddingProfile === profile.name
        ) {
          unchangedFiles += 1;
          continue;
        }

        const content = await fs.readFile(absolutePath, "utf8");
        const checksum = sha1(content);

        if (
          !options?.force &&
          manifest &&
          manifest.checksum === checksum &&
          manifest.embeddingProfile === profile.name
        ) {
          storage.upsertManifest({
            docId: manifest.docId,
            path: absolutePath,
            relativePath,
            sourceKind: "project",
            checksum,
            mtimeMs,
            sizeBytes: stat.size,
            embeddingProfile: profile.name
          });
          unchangedFiles += 1;
          continue;
        }

        const docId = manifest?.docId ?? `project:${sha1(absolutePath)}`;
        const chunkCount = await this.persistDocument({
          storage,
          projectRoot,
          docId,
          sourceKind: "project",
          absolutePath,
          relativePath,
          title: path.basename(absolutePath),
          content,
          tags: [],
          moduleName: topLevelModule(relativePath) ?? undefined,
          language: detectIndexedLanguage(absolutePath) ?? undefined,
          symbol: extractIndexedSymbolSpans(absolutePath, content)[0]?.name ?? inferIndexedSymbolName(path.basename(absolutePath), content, false, absolutePath, true) ?? undefined,
          branchName: gitBranch ?? undefined,
          memoryTier: "project",
          stabilityScore: 0.52,
          distillConfidence: 1,
          distillReason: "Indexed from the project tree in place.",
          checksum,
          mtimeMs,
          sizeBytes: stat.size,
          embeddingProfileName: profile.name,
          chunkSize: config.indexing.chunkSize,
          chunkOverlap: config.indexing.chunkOverlap
        });

        if (chunkCount === 0) {
          skippedFiles += 1;
          continue;
        }

        indexedFiles += 1;
      }

      for (const manifest of storage.listManifestsBySourceKind("project")) {
        if (!seenPaths.has(manifest.path)) {
          storage.deleteDocument(manifest.docId);
          removedFiles += 1;
        }
      }
    } finally {
      storage.close();
    }

    await this.writeProjectIndexSummary(projectRoot, {
      indexedFiles,
      skippedFiles,
      unchangedFiles,
      removedFiles
    });

    return { indexedFiles, skippedFiles, unchangedFiles, removedFiles };
  }

  private getActiveProfile(config: Awaited<ReturnType<typeof loadConfig>>) {
    const profile = config.embeddingProfiles.find((item) => item.name === config.activeEmbeddingProfile);
    if (!profile) {
      throw new Error(`Unknown embedding profile "${config.activeEmbeddingProfile}".`);
    }
    return profile;
  }

  private async persistDocument(input: PersistDocumentInput): Promise<number> {
    const config = await ensureProjectScaffold(input.projectRoot);
    const profile = this.getActiveProfile(config);
    const chunks = chunkTextWithOffsets(input.content, input.chunkSize, input.chunkOverlap);
    if (chunks.length === 0) {
      return 0;
    }

    const symbolSpans = extractIndexedSymbolSpans(input.absolutePath, input.content);
    const embeddings = await Promise.all(
      chunks.map(async (chunk) => normalize(await this.embeddingService.embed(profile, chunk.content)))
    );
    const chunkSymbols = chunks.map((chunk) =>
      symbolForIndexedChunk(symbolSpans, chunk.start, chunk.end) ??
      inferIndexedSymbolName(path.basename(input.absolutePath), chunk.content, false, input.absolutePath, false) ??
      input.symbol
    );

    input.storage.replaceDocument(
      input.docId,
      chunks.map((chunk, index) => ({
        docId: input.docId,
        sourceKind: input.sourceKind,
        path: input.absolutePath,
        title: input.title,
        chunkIndex: index,
        content: chunk.content,
        tags: input.tags,
        moduleName: input.moduleName,
        language: input.language,
        symbol: chunkSymbols[index],
        branchName: input.branchName,
        memoryTier: input.memoryTier ?? defaultMemoryTierForSource(input.sourceKind),
        stabilityScore: input.stabilityScore ?? defaultStabilityForSource(input.sourceKind),
        distillConfidence: input.distillConfidence,
        distillReason: input.distillReason,
        embedding: embeddings[index],
        checksum: input.checksum
      }))
    );

    input.storage.replaceDocumentEdges(
      input.docId,
      buildDocumentEdges({
        relativePath: input.relativePath,
        moduleName: input.moduleName,
        language: input.language,
        branchName: input.branchName,
        tags: input.tags,
        symbols: chunkSymbols
      })
    );

    input.storage.upsertManifest({
      docId: input.docId,
      path: input.absolutePath,
      relativePath: input.relativePath,
      sourceKind: input.sourceKind,
      checksum: input.checksum,
      mtimeMs: input.mtimeMs,
      sizeBytes: input.sizeBytes,
      embeddingProfile: input.embeddingProfileName,
      memoryTier: input.memoryTier ?? defaultMemoryTierForSource(input.sourceKind),
      stabilityScore: input.stabilityScore ?? defaultStabilityForSource(input.sourceKind),
      distillConfidence: input.distillConfidence,
      distillReason: input.distillReason
    });

    return chunks.length;
  }

  private async writeProjectIndexSummary(projectRoot: string, result: IndexProjectResult): Promise<void> {
    const summaryPath = path.join(mindkeeperRoot(projectRoot), "manifests", "project-index.json");
    await fs.writeFile(
      summaryPath,
      JSON.stringify(
        {
          projectRoot,
          indexedAt: new Date().toISOString(),
          result
        },
        null,
        2
      ),
      "utf8"
    );
  }
}
