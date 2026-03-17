import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ensureProjectScaffold } from "./project.js";
import { MindKeeperService } from "./mindkeeper.js";
import type { MemorySourceKind } from "./types.js";

const server = new McpServer({
  name: "mind-keeper",
  version: "0.1.0"
});

const service = new MindKeeperService();

server.tool(
  "bootstrap_project",
  "Create the .mindkeeper scaffold for a project root and return the active config summary.",
  {
    project_root: z.string().describe("Absolute path to the project root.")
  },
  async ({ project_root }) => {
    const config = await ensureProjectScaffold(project_root);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              projectName: config.projectName,
              activeEmbeddingProfile: config.activeEmbeddingProfile,
              activeRerankerProfile: config.activeRerankerProfile,
              directories: [".mindkeeper/knowledge", ".mindkeeper/diary", ".mindkeeper/decisions", ".mindkeeper/vector"]
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  "remember",
  "Store a durable manual memory, decision, diary entry, or imported note inside .mindkeeper and index it immediately.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    content: z.string().min(1).describe("The memory content to persist."),
    source_kind: z.enum(["manual", "decision", "diary", "imported"]).describe("The memory partition to write into."),
    title: z.string().optional().describe("Optional human-readable title."),
    module_name: z.string().optional().describe("Optional module or subsystem name."),
    tags: z.array(z.string()).optional().describe("Optional tags for retrieval filtering.")
  },
  async ({ project_root, content, source_kind, title, module_name, tags }) => {
    const result = await service.remember({
      projectRoot: project_root,
      content,
      sourceKind: source_kind as Exclude<MemorySourceKind, "project">,
      title,
      moduleName: module_name,
      tags
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "remember_decision",
  "Store a structured architecture or workflow decision inside .mindkeeper/decisions and index it immediately.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    title: z.string().min(1).describe("Decision title."),
    decision: z.string().min(1).describe("The decision itself."),
    rationale: z.string().optional().describe("Why this decision was made."),
    impact: z.string().optional().describe("Expected impact, tradeoffs, or follow-up constraints."),
    module_name: z.string().optional().describe("Optional module or subsystem name."),
    tags: z.array(z.string()).optional().describe("Optional decision tags.")
  },
  async ({ project_root, title, decision, rationale, impact, module_name, tags }) => {
    const result = await service.rememberDecision({
      projectRoot: project_root,
      title,
      decision,
      rationale,
      impact,
      moduleName: module_name,
      tags
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "recall",
  "Recall relevant memory chunks using hybrid vector and lexical retrieval with source-priority boosts.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    query: z.string().min(1).describe("The recall query."),
    top_k: z.number().int().positive().max(20).optional().describe("Maximum number of results."),
    source_kinds: z.array(z.enum(["manual", "decision", "diary", "project", "imported"])).optional(),
    path_contains: z.string().optional().describe("Filter results by file path substring."),
    module_name: z.string().optional().describe("Filter results by module name."),
    language: z.string().optional().describe("Filter results by detected language, such as typescript or python."),
    symbol: z.string().optional().describe("Filter results by inferred symbol name."),
    branch_name: z.string().optional().describe("Filter results by git branch name when available."),
    related_files: z.array(z.string()).optional().describe("Optional related files whose names should be boosted during ranking."),
    min_score: z.number().min(0).max(1.5).optional().describe("Override the score threshold."),
    explain: z.boolean().optional().describe("Include score component breakdowns in the result."),
    date_from: z.string().optional().describe("Only return memories updated on or after this ISO date/time."),
    date_to: z.string().optional().describe("Only return memories updated on or before this ISO date/time."),
    last_days: z.number().int().positive().max(3650).optional().describe("Only return memories from the last N days.")
  },
  async ({ project_root, query, top_k, source_kinds, path_contains, module_name, language, symbol, branch_name, related_files, min_score, explain, date_from, date_to, last_days }) => {
    const results = await service.recall({
      projectRoot: project_root,
      query,
      topK: top_k,
      sourceKinds: source_kinds,
      pathContains: path_contains,
      moduleName: module_name,
      language,
      symbol,
      branchName: branch_name,
      relatedPaths: related_files,
      minScore: min_score,
      explain,
      dateFrom: date_from,
      dateTo: date_to,
      lastDays: last_days
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "context_for_task",
  "Return a gated memory context pack for the current IDE task, prioritizing durable decisions and relevant project files.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    task: z.string().min(1).describe("Current task description."),
    current_file: z.string().optional().describe("Absolute path to the active file."),
    current_symbol: z.string().optional().describe("Current function, class, or symbol in focus."),
    selected_text: z.string().optional().describe("Selected code or text from the editor."),
    diagnostics: z.string().optional().describe("Recent error output, test failures, or diagnostics."),
    branch_name: z.string().optional().describe("Current git branch reported by the IDE, if already known."),
    related_files: z.array(z.string()).optional().describe("Additional files involved in the current task."),
    top_k: z.number().int().positive().max(12).optional().describe("Maximum number of chunks to return.")
  },
  async ({ project_root, task, current_file, current_symbol, selected_text, diagnostics, branch_name, related_files, top_k }) => {
    const result = await service.contextForTask({
      projectRoot: project_root,
      task,
      currentFile: current_file,
      currentSymbol: current_symbol,
      selectedText: selected_text,
      diagnostics,
      branchName: branch_name,
      relatedFiles: related_files,
      topK: top_k
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "recall_fast",
  "Run the fast recall path, biasing toward stable memories and project-local context while keeping latency low.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    query: z.string().min(1).describe("The recall query."),
    top_k: z.number().int().positive().max(20).optional().describe("Maximum number of results."),
    source_kinds: z.array(z.enum(["manual", "decision", "diary", "project", "imported"])).optional(),
    path_contains: z.string().optional().describe("Filter results by file path substring."),
    module_name: z.string().optional().describe("Filter results by module name."),
    language: z.string().optional().describe("Filter results by detected language, such as typescript or python."),
    symbol: z.string().optional().describe("Filter results by inferred symbol name."),
    branch_name: z.string().optional().describe("Filter results by git branch name when available."),
    related_files: z.array(z.string()).optional().describe("Optional related files whose names should be boosted during ranking."),
    min_score: z.number().min(0).max(1.5).optional().describe("Override the score threshold."),
    explain: z.boolean().optional().describe("Include score component breakdowns in the result."),
    date_from: z.string().optional().describe("Only return memories updated on or after this ISO date/time."),
    date_to: z.string().optional().describe("Only return memories updated on or before this ISO date/time."),
    last_days: z.number().int().positive().max(3650).optional().describe("Only return memories from the last N days.")
  },
  async ({ project_root, query, top_k, source_kinds, path_contains, module_name, language, symbol, branch_name, related_files, min_score, explain, date_from, date_to, last_days }) => {
    const results = await service.recallFast({
      projectRoot: project_root,
      query,
      topK: top_k,
      sourceKinds: source_kinds,
      pathContains: path_contains,
      moduleName: module_name,
      language,
      symbol,
      branchName: branch_name,
      relatedPaths: related_files,
      minScore: min_score,
      explain,
      dateFrom: date_from,
      dateTo: date_to,
      lastDays: last_days
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "recall_deep",
  "Run the deep recall path, expanding into diary and imported history when broader project memory is needed.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    query: z.string().min(1).describe("The recall query."),
    top_k: z.number().int().positive().max(20).optional().describe("Maximum number of results."),
    source_kinds: z.array(z.enum(["manual", "decision", "diary", "project", "imported"])).optional(),
    path_contains: z.string().optional().describe("Filter results by file path substring."),
    module_name: z.string().optional().describe("Filter results by module name."),
    language: z.string().optional().describe("Filter results by detected language, such as typescript or python."),
    symbol: z.string().optional().describe("Filter results by inferred symbol name."),
    branch_name: z.string().optional().describe("Filter results by git branch name when available."),
    related_files: z.array(z.string()).optional().describe("Optional related files whose names should be boosted during ranking."),
    min_score: z.number().min(0).max(1.5).optional().describe("Override the score threshold."),
    explain: z.boolean().optional().describe("Include score component breakdowns in the result."),
    date_from: z.string().optional().describe("Only return memories updated on or after this ISO date/time."),
    date_to: z.string().optional().describe("Only return memories updated on or before this ISO date/time."),
    last_days: z.number().int().positive().max(3650).optional().describe("Only return memories from the last N days.")
  },
  async ({ project_root, query, top_k, source_kinds, path_contains, module_name, language, symbol, branch_name, related_files, min_score, explain, date_from, date_to, last_days }) => {
    const results = await service.recallDeep({
      projectRoot: project_root,
      query,
      topK: top_k,
      sourceKinds: source_kinds,
      pathContains: path_contains,
      moduleName: module_name,
      language,
      symbol,
      branchName: branch_name,
      relatedPaths: related_files,
      minScore: min_score,
      explain,
      dateFrom: date_from,
      dateTo: date_to,
      lastDays: last_days
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "suggest_session_memory",
  "Analyze a raw worklog or session transcript and suggest whether it should be discarded, stored as diary, promoted to decision, or distilled into reusable knowledge.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    session_text: z.string().min(1).describe("Session notes, transcript, or raw worklog to analyze."),
    title: z.string().optional().describe("Optional draft title to reuse if the suggestion becomes a stored memory."),
    module_name: z.string().optional().describe("Optional module or subsystem name.")
  },
  async ({ project_root, session_text, title, module_name }) => {
    const result = await service.suggestSessionMemory({
      projectRoot: project_root,
      sessionText: session_text,
      title,
      moduleName: module_name
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "summarize_session",
  "Turn a development session into a durable diary, decision, or knowledge memory and index it immediately unless the notes should be discarded.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    title: z.string().min(1).describe("Title for the summarized session memory."),
    session_text: z.string().min(1).describe("Session notes, chat excerpts, or a raw worklog."),
    kind: z.enum(["diary", "decision", "knowledge"]).optional().describe("Optional forced target memory type."),
    module_name: z.string().optional().describe("Optional module or subsystem name."),
    tags: z.array(z.string()).optional().describe("Optional tags.")
  },
  async ({ project_root, title, session_text, kind, module_name, tags }) => {
    const result = await service.summarizeSession({
      projectRoot: project_root,
      title,
      sessionText: session_text,
      kind,
      moduleName: module_name,
      tags
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "forget",
  "Remove a stored memory document and its indexed chunks by doc id or source path.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    doc_id: z.string().optional().describe("The memory document id to delete."),
    path: z.string().optional().describe("Absolute source path for the memory document.")
  },
  async ({ project_root, doc_id, path }) => {
    const result = await service.forget({
      projectRoot: project_root,
      docId: doc_id,
      path
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "disable_source",
  "Disable a memory source by doc id or path so it stops participating in recall without deleting the underlying file.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    doc_id: z.string().optional().describe("The memory document id to disable."),
    path: z.string().optional().describe("Absolute source path for the memory document."),
    reason: z.string().optional().describe("Optional note about why this source is being disabled.")
  },
  async ({ project_root, doc_id, path, reason }) => {
    const result = await service.disableSource({
      projectRoot: project_root,
      docId: doc_id,
      path,
      reason
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "enable_source",
  "Re-enable a previously disabled memory source by doc id or path so it can participate in recall again.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    doc_id: z.string().optional().describe("The memory document id to enable."),
    path: z.string().optional().describe("Absolute source path for the memory document.")
  },
  async ({ project_root, doc_id, path }) => {
    const result = await service.enableSource({
      projectRoot: project_root,
      docId: doc_id,
      path
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "rate_source",
  "Record whether a memory source was helpful or noisy so future recall can up-rank or down-rank it.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    signal: z.enum(["helpful", "noisy"]).describe("Whether this source helped or added noise."),
    doc_id: z.string().optional().describe("The memory document id to rate."),
    path: z.string().optional().describe("Absolute source path for the memory document."),
    reason: z.string().optional().describe("Optional note explaining the feedback.")
  },
  async ({ project_root, signal, doc_id, path, reason }) => {
    const result = await service.rateSource({
      projectRoot: project_root,
      signal,
      docId: doc_id,
      path,
      reason
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "list_sources",
  "List known memory sources for the current project, including manual notes, decisions, diary entries, imports, and indexed project files.",
  {
    project_root: z.string().describe("Absolute path to the project root.")
  },
  async ({ project_root }) => {
    const result = await service.listSources(project_root);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "list_branch_views",
  "Summarize stored memory and indexed project content by git branch so IDE clients can inspect branch-scoped memory views.",
  {
    project_root: z.string().describe("Absolute path to the project root.")
  },
  async ({ project_root }) => {
    const result = await service.listBranchViews(project_root);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "archive_stale_memories",
  "Move stale diary or imported memories into the cold tier so long-lived projects stay cleaner over time.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    older_than_days: z.number().int().positive().max(3650).optional().describe("Archive memories older than this many days. Defaults to 45."),
    source_kinds: z.array(z.enum(["diary", "imported"])).optional().describe("Optional source kinds to archive."),
    noisy_only: z.boolean().optional().describe("Only archive sources that have accumulated more noisy than helpful feedback.")
  },
  async ({ project_root, older_than_days, source_kinds, noisy_only }) => {
    const result = await service.archiveStaleMemories({
      projectRoot: project_root,
      olderThanDays: older_than_days,
      sourceKinds: source_kinds,
      noisyOnly: noisy_only
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "list_conflicts",
  "Detect likely conflicts between stored decision memories so teams can reconcile outdated or opposing guidance.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    top_k: z.number().int().positive().max(50).optional().describe("Maximum number of conflict pairs to return.")
  },
  async ({ project_root, top_k }) => {
    const result = await service.listConflicts({
      projectRoot: project_root,
      topK: top_k
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "list_conflict_clusters",
  "Group related decision conflicts by shared subject so teams can review drift as one cluster instead of isolated pairs.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    top_k: z.number().int().positive().max(50).optional().describe("Maximum number of conflict clusters to return.")
  },
  async ({ project_root, top_k }) => {
    const result = await service.listConflictClusters({
      projectRoot: project_root,
      topK: top_k
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "suggest_consolidations",
  "Suggest groups of related memories that look similar enough to consolidate into one stable note.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    top_k: z.number().int().positive().max(50).optional().describe("Maximum number of suggestions to return."),
    min_score: z.number().min(0).max(1).optional().describe("Only return suggestions at or above this score."),
    source_kinds: z.array(z.enum(["manual", "decision", "diary", "imported"])).optional().describe("Optional memory source kinds to consider."),
    include_disabled: z.boolean().optional().describe("Include currently disabled memories in the suggestion scan.")
  },
  async ({ project_root, top_k, min_score, source_kinds, include_disabled }) => {
    const result = await service.suggestConsolidations({
      projectRoot: project_root,
      topK: top_k,
      minScore: min_score,
      sourceKinds: source_kinds,
      includeDisabled: include_disabled
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "consolidate_memories",
  "Merge several related memories into one stable decision or knowledge note, optionally disabling the inputs afterwards.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    doc_ids: z.array(z.string()).min(1).describe("Memory document ids to consolidate."),
    title: z.string().min(1).describe("Title for the consolidated memory."),
    kind: z.enum(["knowledge", "decision"]).optional().describe("Optional target kind. Defaults based on the selected sources."),
    module_name: z.string().optional().describe("Optional module or subsystem name."),
    tags: z.array(z.string()).optional().describe("Optional tags for the consolidated memory."),
    disable_inputs: z.boolean().optional().describe("Disable the input memories after consolidation.")
  },
  async ({ project_root, doc_ids, title, kind, module_name, tags, disable_inputs }) => {
    const result = await service.consolidateMemories({
      projectRoot: project_root,
      docIds: doc_ids,
      title,
      kind,
      moduleName: module_name,
      tags,
      disableInputs: disable_inputs
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "index_project",
  "Index eligible project files in place and store only chunk metadata and vector artifacts under .mindkeeper/vector.",
  {
    project_root: z.string().describe("Absolute path to the project root."),
    force: z.boolean().optional().describe("Reindex all eligible files even if manifests say they are unchanged.")
  },
  async ({ project_root, force }) => {
    const result = await service.indexProject(project_root, { force });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
