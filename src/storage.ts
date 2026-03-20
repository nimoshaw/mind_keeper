import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { MemoryEdgeType } from "./types.js";
import { mindkeeperRoot } from "./config.js";
import type { ChunkRecord, MemorySourceKind, MemoryTier } from "./types.js";

interface UpsertChunkInput {
  docId: string;
  sourceKind: MemorySourceKind;
  path: string;
  title?: string;
  chunkIndex: number;
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
  embedding: number[];
  checksum: string;
}

interface SearchCandidate extends ChunkRecord {
  embedding: number[];
  checksum: string;
  helpfulVotes?: number;
  noisyVotes?: number;
  lastFeedbackAt?: number | null;
}

interface FileManifestInput {
  docId: string;
  path: string;
  relativePath: string;
  sourceKind: MemorySourceKind;
  checksum: string;
  mtimeMs: number;
  sizeBytes: number;
  embeddingProfile: string;
  memoryTier?: MemoryTier | null;
  stabilityScore?: number | null;
  distillConfidence?: number | null;
  distillReason?: string | null;
}

export interface FileManifestRecord extends FileManifestInput {
  updatedAt: number;
}

export interface MemorySourceRecord {
  docId: string;
  path: string;
  relativePath: string | null;
  sourceKind: MemorySourceKind;
  title: string | null;
  tags: string[];
  moduleName: string | null;
  symbol: string | null;
  branchName: string | null;
  checksum: string | null;
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
}

export interface BranchViewRecord {
  branchName: string | null;
  docCount: number;
  chunkCount: number;
  lastUpdatedAt: number;
  disabledCount: number;
  sourceCounts: Record<MemorySourceKind, number>;
}

interface ChunkRow {
  id: number;
  doc_id: string;
  source_kind: string;
  path: string;
  title: string | null;
  chunk_index: number;
  content: string;
  tags_json: string;
  module_name: string | null;
  language: string | null;
  symbol: string | null;
  branch_name: string | null;
  embedding_json: string;
  checksum: string;
  updated_at: number;
  memory_tier?: string | null;
  stability_score?: number | null;
  distill_confidence?: number | null;
  distill_reason?: string | null;
  helpful_votes?: number;
  noisy_votes?: number;
  last_feedback_at?: number | null;
}

interface FileManifestRow {
  doc_id: string;
  path: string;
  relative_path: string;
  source_kind: string;
  checksum: string;
  mtime_ms: number;
  size_bytes: number;
  embedding_profile: string;
  updated_at: number;
  memory_tier?: string | null;
  stability_score?: number | null;
  distill_confidence?: number | null;
  distill_reason?: string | null;
}

interface MemoryEdgeRow {
  doc_id: string;
  edge_type: string;
  target_key: string;
  weight: number;
}

interface RelatedDocRow {
  related_doc_id: string;
  edge_type: string;
  target_key: string;
  score: number;
}

interface EmbeddingCacheRow {
  profile_key: string;
  content_hash: string;
  embedding_json: string;
  dimensions: number;
}

export class MindKeeperStorage {
  private readonly db: Database.Database;

  constructor(projectRoot: string) {
    const vectorDir = path.join(mindkeeperRoot(projectRoot), "vector");
    fs.mkdirSync(vectorDir, { recursive: true });
    const dbPath = path.join(vectorDir, "mindkeeper.sqlite");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        module_name TEXT,
        language TEXT,
        symbol TEXT,
        branch_name TEXT,
        memory_tier TEXT,
        stability_score REAL,
        distill_confidence REAL,
        distill_reason TEXT,
        embedding_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(doc_id, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_source_kind ON chunks(source_kind);
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);

      CREATE TABLE IF NOT EXISTS file_manifests (
        doc_id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        relative_path TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        checksum TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        embedding_profile TEXT NOT NULL,
        memory_tier TEXT,
        stability_score REAL,
        distill_confidence REAL,
        distill_reason TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_file_manifests_source_kind ON file_manifests(source_kind);
      CREATE INDEX IF NOT EXISTS idx_file_manifests_path ON file_manifests(path);

      CREATE TABLE IF NOT EXISTS disabled_sources (
        doc_id TEXT PRIMARY KEY,
        reason TEXT,
        disabled_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_feedback (
        doc_id TEXT PRIMARY KEY,
        helpful_votes INTEGER NOT NULL DEFAULT 0,
        noisy_votes INTEGER NOT NULL DEFAULT 0,
        last_feedback_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS memory_edges (
        doc_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        target_key TEXT NOT NULL,
        weight REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (doc_id, edge_type, target_key)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_edges_doc_id ON memory_edges(doc_id);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_lookup ON memory_edges(edge_type, target_key);

      CREATE TABLE IF NOT EXISTS embedding_cache (
        profile_key TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        embedding_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (profile_key, content_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_embedding_cache_profile_name ON embedding_cache(profile_name);
    `);
    this.ensureChunkColumn("language", "TEXT");
    this.ensureChunkColumn("symbol", "TEXT");
    this.ensureChunkColumn("branch_name", "TEXT");
    this.ensureChunkColumn("memory_tier", "TEXT");
    this.ensureChunkColumn("stability_score", "REAL");
    this.ensureChunkColumn("distill_confidence", "REAL");
    this.ensureChunkColumn("distill_reason", "TEXT");
    this.ensureManifestColumn("memory_tier", "TEXT");
    this.ensureManifestColumn("stability_score", "REAL");
    this.ensureManifestColumn("distill_confidence", "REAL");
    this.ensureManifestColumn("distill_reason", "TEXT");
    this.ensureChunkMetadataIndexes();
  }

  close(): void {
    this.db.close();
  }

  private ensureChunkColumn(columnName: string, columnType: string): void {
    try {
      this.db.exec(`ALTER TABLE chunks ADD COLUMN ${columnName} ${columnType}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) {
        throw error;
      }
    }
  }

  private ensureManifestColumn(columnName: string, columnType: string): void {
    try {
      this.db.exec(`ALTER TABLE file_manifests ADD COLUMN ${columnName} ${columnType}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) {
        throw error;
      }
    }
  }

  private ensureChunkMetadataIndexes(): void {
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunks_language ON chunks(language);
        CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON chunks(symbol);
        CREATE INDEX IF NOT EXISTS idx_chunks_branch_name ON chunks(branch_name);
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such column/i.test(message)) {
        throw error;
      }

      this.ensureChunkColumn("language", "TEXT");
      this.ensureChunkColumn("symbol", "TEXT");
      this.ensureChunkColumn("branch_name", "TEXT");
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunks_language ON chunks(language);
        CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON chunks(symbol);
        CREATE INDEX IF NOT EXISTS idx_chunks_branch_name ON chunks(branch_name);
      `);
    }
  }

  replaceDocument(docId: string, chunks: UpsertChunkInput[]): void {
    const deleteStmt = this.db.prepare("DELETE FROM chunks WHERE doc_id = ?");
    const insertStmt = this.db.prepare(`
      INSERT INTO chunks (
        doc_id, source_kind, path, title, chunk_index, content, tags_json,
        module_name, language, symbol, branch_name, memory_tier, stability_score, distill_confidence, distill_reason,
        embedding_json, checksum, updated_at
      ) VALUES (
        @docId, @sourceKind, @path, @title, @chunkIndex, @content, @tagsJson,
        @moduleName, @language, @symbol, @branchName, @memoryTier, @stabilityScore, @distillConfidence, @distillReason,
        @embeddingJson, @checksum, @updatedAt
      )
    `);

    const tx = this.db.transaction((payload: UpsertChunkInput[]) => {
      deleteStmt.run(docId);
      for (const chunk of payload) {
        insertStmt.run({
          docId: chunk.docId,
          sourceKind: chunk.sourceKind,
          path: chunk.path,
          title: chunk.title ?? null,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tagsJson: JSON.stringify(chunk.tags),
          moduleName: chunk.moduleName ?? null,
          language: chunk.language ?? null,
          symbol: chunk.symbol ?? null,
          branchName: chunk.branchName ?? null,
          memoryTier: chunk.memoryTier ?? null,
          stabilityScore: chunk.stabilityScore ?? null,
          distillConfidence: chunk.distillConfidence ?? null,
          distillReason: chunk.distillReason ?? null,
          embeddingJson: JSON.stringify(chunk.embedding),
          checksum: chunk.checksum,
          updatedAt: Date.now()
        });
      }
    });

    tx(chunks);
  }

  deleteDocument(docId: string): void {
    const tx = this.db.transaction((key: string) => {
      this.db.prepare("DELETE FROM chunks WHERE doc_id = ?").run(key);
      this.db.prepare("DELETE FROM file_manifests WHERE doc_id = ?").run(key);
      this.db.prepare("DELETE FROM disabled_sources WHERE doc_id = ?").run(key);
      this.db.prepare("DELETE FROM source_feedback WHERE doc_id = ?").run(key);
      this.db.prepare("DELETE FROM memory_edges WHERE doc_id = ?").run(key);
    });

    tx(docId);
  }

  disableSource(docId: string, reason?: string): void {
    this.db.prepare(`
      INSERT INTO disabled_sources (doc_id, reason, disabled_at)
      VALUES (?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET
        reason = excluded.reason,
        disabled_at = excluded.disabled_at
    `).run(docId, reason ?? null, Date.now());
  }

  recordSourceFeedback(docId: string, signal: "helpful" | "noisy"): void {
    const now = Date.now();
    const helpfulVotes = signal === "helpful" ? 1 : 0;
    const noisyVotes = signal === "noisy" ? 1 : 0;
    this.db.prepare(`
      INSERT INTO source_feedback (doc_id, helpful_votes, noisy_votes, last_feedback_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET
        helpful_votes = helpful_votes + excluded.helpful_votes,
        noisy_votes = noisy_votes + excluded.noisy_votes,
        last_feedback_at = excluded.last_feedback_at
    `).run(docId, helpfulVotes, noisyVotes, now);
  }

  enableSource(docId: string): boolean {
    const result = this.db.prepare("DELETE FROM disabled_sources WHERE doc_id = ?").run(docId);
    return result.changes > 0;
  }

  updateDocumentMetadata(input: {
    docId: string;
    memoryTier?: MemoryTier | null;
    stabilityScore?: number | null;
    distillConfidence?: number | null;
    distillReason?: string | null;
  }): void {
    const payload = {
      docId: input.docId,
      memoryTier: input.memoryTier ?? null,
      stabilityScore: input.stabilityScore ?? null,
      distillConfidence: input.distillConfidence ?? null,
      distillReason: input.distillReason ?? null
    };

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE chunks
        SET
          memory_tier = COALESCE(@memoryTier, memory_tier),
          stability_score = COALESCE(@stabilityScore, stability_score),
          distill_confidence = COALESCE(@distillConfidence, distill_confidence),
          distill_reason = COALESCE(@distillReason, distill_reason)
        WHERE doc_id = @docId
      `).run(payload);

      this.db.prepare(`
        UPDATE file_manifests
        SET
          memory_tier = COALESCE(@memoryTier, memory_tier),
          stability_score = COALESCE(@stabilityScore, stability_score),
          distill_confidence = COALESCE(@distillConfidence, distill_confidence),
          distill_reason = COALESCE(@distillReason, distill_reason)
        WHERE doc_id = @docId
      `).run(payload);
    });

    tx();
  }

  setDocumentUpdatedAt(docId: string, updatedAt: number): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE chunks SET updated_at = ? WHERE doc_id = ?").run(updatedAt, docId);
      this.db.prepare("UPDATE file_manifests SET updated_at = ? WHERE doc_id = ?").run(updatedAt, docId);
    });

    tx();
  }

  findDocumentByPath(filePath: string): { docId: string; sourceKind: MemorySourceKind } | null {
    const manifestStmt = this.db.prepare(`
      SELECT doc_id, source_kind
      FROM file_manifests
      WHERE path = ?
      LIMIT 1
    `);
    const manifestRow = manifestStmt.get(filePath) as { doc_id: string; source_kind: string } | undefined;
    if (manifestRow) {
      return {
        docId: manifestRow.doc_id,
        sourceKind: manifestRow.source_kind as MemorySourceKind
      };
    }

    const chunkStmt = this.db.prepare(`
      SELECT doc_id, source_kind
      FROM chunks
      WHERE path = ?
      LIMIT 1
    `);
    const chunkRow = chunkStmt.get(filePath) as { doc_id: string; source_kind: string } | undefined;
    if (!chunkRow) {
      return null;
    }

    return {
      docId: chunkRow.doc_id,
      sourceKind: chunkRow.source_kind as MemorySourceKind
    };
  }

  getManifestByPath(sourceKind: MemorySourceKind, filePath: string): FileManifestRecord | null {
    const stmt = this.db.prepare(`
      SELECT doc_id, path, relative_path, source_kind, checksum, mtime_ms, size_bytes, embedding_profile, updated_at
      , memory_tier, stability_score, distill_confidence, distill_reason
      FROM file_manifests
      WHERE source_kind = ? AND path = ?
      LIMIT 1
    `);

    const row = stmt.get(sourceKind, filePath) as FileManifestRow | undefined;
    if (!row) {
      return null;
    }

    return {
      docId: row.doc_id,
      path: row.path,
      relativePath: row.relative_path,
      sourceKind: row.source_kind as MemorySourceKind,
      checksum: row.checksum,
      mtimeMs: row.mtime_ms,
      sizeBytes: row.size_bytes,
      embeddingProfile: row.embedding_profile,
      updatedAt: row.updated_at,
      memoryTier: (row.memory_tier as MemoryTier | null) ?? null,
      stabilityScore: row.stability_score ?? null,
      distillConfidence: row.distill_confidence ?? null,
      distillReason: row.distill_reason ?? null
    };
  }

  upsertManifest(input: FileManifestInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO file_manifests (
        doc_id, path, relative_path, source_kind, checksum, mtime_ms, size_bytes, embedding_profile,
        memory_tier, stability_score, distill_confidence, distill_reason, updated_at
      ) VALUES (
        @docId, @path, @relativePath, @sourceKind, @checksum, @mtimeMs, @sizeBytes, @embeddingProfile,
        @memoryTier, @stabilityScore, @distillConfidence, @distillReason, @updatedAt
      )
      ON CONFLICT(doc_id) DO UPDATE SET
        path = excluded.path,
        relative_path = excluded.relative_path,
        source_kind = excluded.source_kind,
        checksum = excluded.checksum,
        mtime_ms = excluded.mtime_ms,
        size_bytes = excluded.size_bytes,
        embedding_profile = excluded.embedding_profile,
        memory_tier = excluded.memory_tier,
        stability_score = excluded.stability_score,
        distill_confidence = excluded.distill_confidence,
        distill_reason = excluded.distill_reason,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      ...input,
      updatedAt: Date.now()
    });
  }

  replaceDocumentEdges(
    docId: string,
    edges: Array<{
      edgeType: MemoryEdgeType;
      targetKey: string;
      weight: number;
    }>
  ): void {
    const deleteStmt = this.db.prepare("DELETE FROM memory_edges WHERE doc_id = ?");
    const insertStmt = this.db.prepare(`
      INSERT INTO memory_edges (doc_id, edge_type, target_key, weight, updated_at)
      VALUES (@docId, @edgeType, @targetKey, @weight, @updatedAt)
    `);

    const tx = this.db.transaction(() => {
      deleteStmt.run(docId);
      for (const edge of edges) {
        insertStmt.run({
          docId,
          edgeType: edge.edgeType,
          targetKey: edge.targetKey,
          weight: edge.weight,
          updatedAt: Date.now()
        });
      }
    });

    tx();
  }

  getEmbeddingCacheEntries(profileKey: string, contentHashes: string[]): Map<string, number[]> {
    if (contentHashes.length === 0) {
      return new Map();
    }

    const uniqueHashes = Array.from(new Set(contentHashes));
    const placeholders = uniqueHashes.map(() => "?").join(", ");
    const stmt = this.db.prepare(`
      SELECT profile_key, content_hash, embedding_json, dimensions
      FROM embedding_cache
      WHERE profile_key = ?
        AND content_hash IN (${placeholders})
    `);

    const rows = stmt.all(profileKey, ...uniqueHashes) as EmbeddingCacheRow[];
    return new Map(rows.map((row) => [row.content_hash, JSON.parse(row.embedding_json) as number[]]));
  }

  upsertEmbeddingCacheEntries(
    entries: Array<{
      profileKey: string;
      profileName: string;
      contentHash: string;
      dimensions: number;
      embedding: number[];
    }>
  ): void {
    if (entries.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO embedding_cache (
        profile_key, profile_name, content_hash, dimensions, embedding_json, updated_at
      ) VALUES (
        @profileKey, @profileName, @contentHash, @dimensions, @embeddingJson, @updatedAt
      )
      ON CONFLICT(profile_key, content_hash) DO UPDATE SET
        profile_name = excluded.profile_name,
        dimensions = excluded.dimensions,
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at
    `);

    const tx = this.db.transaction(() => {
      const updatedAt = Date.now();
      for (const entry of entries) {
        stmt.run({
          profileKey: entry.profileKey,
          profileName: entry.profileName,
          contentHash: entry.contentHash,
          dimensions: entry.dimensions,
          embeddingJson: JSON.stringify(entry.embedding),
          updatedAt
        });
      }
    });

    tx();
  }

  getRelationMatches(
    docIds: string[],
    hints: Array<{
      edgeType: MemoryEdgeType;
      targetKey: string;
    }>
  ): Map<string, { score: number; hits: string[] }> {
    if (docIds.length === 0 || hints.length === 0) {
      return new Map();
    }

    const uniqueDocIds = Array.from(new Set(docIds));
    const uniqueHints = Array.from(
      new Map(hints.map((hint) => [`${hint.edgeType}:${hint.targetKey}`, hint])).values()
    );
    const docPlaceholders = uniqueDocIds.map(() => "?").join(", ");
    const hintClauses = uniqueHints.map(() => "(edge_type = ? AND target_key = ?)").join(" OR ");
    const stmt = this.db.prepare(`
      SELECT doc_id, edge_type, target_key, weight
      FROM memory_edges
      WHERE doc_id IN (${docPlaceholders})
        AND (${hintClauses})
    `);

    const values: unknown[] = [...uniqueDocIds];
    for (const hint of uniqueHints) {
      values.push(hint.edgeType, hint.targetKey);
    }

    const output = new Map<string, { score: number; hits: string[] }>();
    for (const row of stmt.all(...values) as MemoryEdgeRow[]) {
      const current = output.get(row.doc_id) ?? { score: 0, hits: [] };
      current.score += row.weight;
      current.hits.push(`${row.edge_type}:${row.target_key}`);
      output.set(row.doc_id, current);
    }

    return output;
  }

  getRelatedDocumentMatches(input: {
    seedDocIds: string[];
    limit?: number;
    allowedEdgeTypes?: MemoryEdgeType[];
  }): Map<string, { score: number; hits: string[] }> {
    if (input.seedDocIds.length === 0) {
      return new Map();
    }

    const uniqueSeedDocIds = Array.from(new Set(input.seedDocIds));
    const docPlaceholders = uniqueSeedDocIds.map(() => "?").join(", ");
    const values: unknown[] = [...uniqueSeedDocIds, ...uniqueSeedDocIds];
    const clauses = [
      `e1.doc_id IN (${docPlaceholders})`,
      `e2.doc_id NOT IN (${docPlaceholders})`
    ];

    if (input.allowedEdgeTypes?.length) {
      clauses.push(`e1.edge_type IN (${input.allowedEdgeTypes.map(() => "?").join(", ")})`);
      values.push(...input.allowedEdgeTypes);
    }

    const stmt = this.db.prepare(`
      SELECT
        e2.doc_id AS related_doc_id,
        e1.edge_type AS edge_type,
        e1.target_key AS target_key,
        (e1.weight * e2.weight) AS score
      FROM memory_edges e1
      JOIN memory_edges e2
        ON e1.edge_type = e2.edge_type
       AND e1.target_key = e2.target_key
      WHERE ${clauses.join(" AND ")}
      ORDER BY score DESC
    `);

    const output = new Map<string, { score: number; hits: string[] }>();
    for (const row of stmt.all(...values) as RelatedDocRow[]) {
      const current = output.get(row.related_doc_id) ?? { score: 0, hits: [] };
      current.score += row.score;
      current.hits.push(`${row.edge_type}:${row.target_key}`);
      output.set(row.related_doc_id, current);
    }

    return new Map(
      Array.from(output.entries())
        .sort((left, right) => right[1].score - left[1].score)
        .slice(0, input.limit ?? 12)
    );
  }

  listManifestsBySourceKind(sourceKind: MemorySourceKind): FileManifestRecord[] {
    const stmt = this.db.prepare(`
      SELECT doc_id, path, relative_path, source_kind, checksum, mtime_ms, size_bytes, embedding_profile, updated_at
      , memory_tier, stability_score, distill_confidence, distill_reason
      FROM file_manifests
      WHERE source_kind = ?
    `);

    return (stmt.all(sourceKind) as FileManifestRow[]).map((row) => ({
      docId: row.doc_id,
      path: row.path,
      relativePath: row.relative_path,
      sourceKind: row.source_kind as MemorySourceKind,
      checksum: row.checksum,
      mtimeMs: row.mtime_ms,
      sizeBytes: row.size_bytes,
      embeddingProfile: row.embedding_profile,
      updatedAt: row.updated_at,
      memoryTier: (row.memory_tier as MemoryTier | null) ?? null,
      stabilityScore: row.stability_score ?? null,
      distillConfidence: row.distill_confidence ?? null,
      distillReason: row.distill_reason ?? null
    }));
  }

  countManifests(): number {
    const stmt = this.db.prepare("SELECT COUNT(*) AS count FROM file_manifests");
    const row = stmt.get() as { count: number };
    return row.count;
  }

  countManifestsForEmbeddingProfile(profileName: string): number {
    const stmt = this.db.prepare("SELECT COUNT(*) AS count FROM file_manifests WHERE embedding_profile = ?");
    const row = stmt.get(profileName) as { count: number };
    return row.count;
  }

  listSources(): MemorySourceRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        c.doc_id,
        c.path,
        fm.relative_path,
        c.source_kind,
        MAX(c.title) AS title,
        MAX(c.tags_json) AS tags_json,
        MAX(c.module_name) AS module_name,
        MAX(c.symbol) AS symbol,
        MAX(c.branch_name) AS branch_name,
        MAX(c.checksum) AS checksum,
        COUNT(*) AS chunk_count,
        MAX(c.updated_at) AS updated_at,
        ds.disabled_at AS disabled_at,
        ds.reason AS disabled_reason,
        COALESCE(sf.helpful_votes, 0) AS helpful_votes,
        COALESCE(sf.noisy_votes, 0) AS noisy_votes,
        sf.last_feedback_at AS last_feedback_at,
        MAX(fm.memory_tier) AS memory_tier,
        MAX(fm.stability_score) AS stability_score,
        MAX(fm.distill_confidence) AS distill_confidence,
        MAX(fm.distill_reason) AS distill_reason
      FROM chunks c
      LEFT JOIN file_manifests fm ON fm.doc_id = c.doc_id
      LEFT JOIN disabled_sources ds ON ds.doc_id = c.doc_id
      LEFT JOIN source_feedback sf ON sf.doc_id = c.doc_id
      GROUP BY c.doc_id, c.path, fm.relative_path, c.source_kind
      ORDER BY updated_at DESC
    `);

    return (stmt.all() as Array<{
      doc_id: string;
      path: string;
      relative_path: string | null;
      source_kind: string;
      title: string | null;
      tags_json: string | null;
      module_name: string | null;
      symbol: string | null;
      branch_name: string | null;
      checksum: string | null;
      chunk_count: number;
      updated_at: number;
      disabled_at: number | null;
      disabled_reason: string | null;
      helpful_votes: number;
      noisy_votes: number;
      last_feedback_at: number | null;
      memory_tier: string | null;
      stability_score: number | null;
      distill_confidence: number | null;
      distill_reason: string | null;
    }>).map((row) => ({
      docId: row.doc_id,
      path: row.path,
      relativePath: row.relative_path,
      sourceKind: row.source_kind as MemorySourceKind,
      title: row.title,
      tags: row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [],
      moduleName: row.module_name,
      symbol: row.symbol,
      branchName: row.branch_name,
      checksum: row.checksum,
      chunkCount: row.chunk_count,
      updatedAt: row.updated_at,
      isDisabled: row.disabled_at !== null,
      disabledAt: row.disabled_at,
      disabledReason: row.disabled_reason,
      helpfulVotes: row.helpful_votes,
      noisyVotes: row.noisy_votes,
      lastFeedbackAt: row.last_feedback_at,
      memoryTier: (row.memory_tier as MemoryTier | null) ?? null,
      stabilityScore: row.stability_score,
      distillConfidence: row.distill_confidence,
      distillReason: row.distill_reason
    }));
  }

  listBranchViews(): BranchViewRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        c.branch_name AS branch_name,
        COUNT(DISTINCT c.doc_id) AS doc_count,
        COUNT(*) AS chunk_count,
        MAX(c.updated_at) AS last_updated_at,
        COUNT(DISTINCT ds.doc_id) AS disabled_count,
        SUM(CASE WHEN c.source_kind = 'manual' THEN 1 ELSE 0 END) AS manual_count,
        SUM(CASE WHEN c.source_kind = 'decision' THEN 1 ELSE 0 END) AS decision_count,
        SUM(CASE WHEN c.source_kind = 'diary' THEN 1 ELSE 0 END) AS diary_count,
        SUM(CASE WHEN c.source_kind = 'project' THEN 1 ELSE 0 END) AS project_count,
        SUM(CASE WHEN c.source_kind = 'imported' THEN 1 ELSE 0 END) AS imported_count,
        SUM(CASE WHEN c.source_kind = 'log' THEN 1 ELSE 0 END) AS log_count
      FROM chunks c
      LEFT JOIN disabled_sources ds ON ds.doc_id = c.doc_id
      GROUP BY c.branch_name
      ORDER BY last_updated_at DESC
    `);

    return (stmt.all() as Array<{
      branch_name: string | null;
      doc_count: number;
      chunk_count: number;
      last_updated_at: number;
      disabled_count: number;
      manual_count: number;
      decision_count: number;
      diary_count: number;
      project_count: number;
      imported_count: number;
      log_count: number;
    }>).map((row) => ({
      branchName: row.branch_name,
      docCount: row.doc_count,
      chunkCount: row.chunk_count,
      lastUpdatedAt: row.last_updated_at,
      disabledCount: row.disabled_count,
      sourceCounts: {
        manual: row.manual_count,
        decision: row.decision_count,
        diary: row.diary_count,
        project: row.project_count,
        imported: row.imported_count,
        log: row.log_count
      }
    }));
  }


  fetchCandidates(filters: {
    sourceKinds?: MemorySourceKind[];
    pathContains?: string;
    moduleName?: string;
    language?: string;
    symbol?: string;
    branchName?: string;
  }): SearchCandidate[] {
    const clauses = ["1 = 1", "chunks.doc_id NOT IN (SELECT doc_id FROM disabled_sources)"];
    const values: unknown[] = [];

    if (filters.sourceKinds?.length) {
      clauses.push(`source_kind IN (${filters.sourceKinds.map(() => "?").join(", ")})`);
      values.push(...filters.sourceKinds);
    }

    if (filters.pathContains) {
      clauses.push("path LIKE ?");
      values.push(`%${filters.pathContains}%`);
    }

    if (filters.moduleName) {
      clauses.push("module_name = ?");
      values.push(filters.moduleName);
    }

    if (filters.language) {
      clauses.push("language = ?");
      values.push(filters.language);
    }

    if (filters.symbol) {
      clauses.push("symbol LIKE ?");
      values.push(`%${filters.symbol}%`);
    }

    if (filters.branchName) {
      clauses.push("branch_name = ?");
      values.push(filters.branchName);
    }

    const stmt = this.db.prepare(`
      SELECT chunks.id, chunks.doc_id, chunks.source_kind, chunks.path, chunks.title, chunks.chunk_index, chunks.content, chunks.tags_json, chunks.module_name, chunks.language, chunks.symbol, chunks.branch_name,
        chunks.memory_tier, chunks.stability_score, chunks.distill_confidence, chunks.distill_reason,
        chunks.embedding_json, chunks.checksum, chunks.updated_at,
        COALESCE(sf.helpful_votes, 0) AS helpful_votes,
        COALESCE(sf.noisy_votes, 0) AS noisy_votes,
        sf.last_feedback_at AS last_feedback_at
      FROM chunks
      LEFT JOIN source_feedback sf ON sf.doc_id = chunks.doc_id
      WHERE ${clauses.join(" AND ")}
    `);

    return (stmt.all(...values) as ChunkRow[]).map((row) => ({
      id: row.id as number,
      docId: row.doc_id as string,
      sourceKind: row.source_kind as MemorySourceKind,
      path: row.path as string,
      title: row.title as string | null,
      chunkIndex: row.chunk_index as number,
      content: row.content as string,
      tags: JSON.parse(row.tags_json as string) as string[],
      moduleName: row.module_name as string | null,
      language: row.language as string | null,
      symbol: row.symbol as string | null,
      branchName: row.branch_name as string | null,
      memoryTier: (row.memory_tier as MemoryTier | null) ?? null,
      stabilityScore: row.stability_score ?? null,
      distillConfidence: row.distill_confidence ?? null,
      distillReason: row.distill_reason ?? null,
      updatedAt: row.updated_at as number,
      embedding: JSON.parse(row.embedding_json as string) as number[],
      checksum: row.checksum as string,
      helpfulVotes: row.helpful_votes ?? 0,
      noisyVotes: row.noisy_votes ?? 0,
      lastFeedbackAt: row.last_feedback_at ?? null
    }));
  }
}
