# Mind Keeper

Mind Keeper is a project-scoped memory MCP for IDE workflows.

It is designed around four principles inspired by VCP-style memory systems:

- active recall first
- passive injection stays gated
- gating matters more than raw retrieval volume
- every project keeps its own isolated memory space

## What It Does

Mind Keeper gives one project its own `.mindkeeper` directory and keeps memory in layers:

- user-managed knowledge
- structured decisions
- project diary and session summaries
- imported external references
- in-place project indexing for code, docs, and config

It is not a "copy the whole repo into a vector folder" tool.

The original project files stay where they are. Mind Keeper stores index artifacts, metadata, chunks, and vectors under `.mindkeeper`.

## Directory Layout

```text
<project-root>/
  .mindkeeper/
    config.toml
    knowledge/
    diary/
    decisions/
    imports/
    manifests/
    vector/
    cache/
```

Meaning:

- `knowledge/`: user-managed long-lived notes
- `diary/`: session and progress memory
- `decisions/`: durable project decisions
- `imports/`: manually imported references
- `manifests/`: indexing summaries, benchmark snapshots, status snapshots
- `vector/`: SQLite data, chunk metadata, embeddings, retrieval artifacts
- `cache/`: temporary extraction outputs

## Current Product Shape

Implemented today:

- project-scoped `.mindkeeper`
- incremental indexing with manifests
- write-time memory distillation
- light-wave task context recall
- intent subtype planning for bug fixes, migrations, API changes, docs, and architecture review
- explainable task-context summaries that tell IDE clients why memory was chosen or suppressed
- feedback-aware explain output and immediate vote totals after helpful/noisy signals
- intent-first light-wave task context recall
- confidence-aware wave stopping
- per-wave budget profiles for task context recall
- one-hop memory mesh expansion after stable hits
- conflict-aware wave gating for competing decision memories
- adaptive deep-wave triggers for history-focused tasks
- fast recall and deep recall entry points
- lightweight graph-aware rerank
- stale archive, conflict listing, and consolidation
- conflict clustering for decision drift review
- conflict-resolution suggestions that bridge drift review into consolidation
- conflict-resolution plans with ready-to-run consolidation templates
- canonical decision execution from reviewed conflict plans
- preflight validation and post-execution verification for conflict resolution
- follow-up governance suggestions after canonical decision execution
- executable follow-up actions for canonical conflict resolution cleanup
- consolidation suggestions before manual merge
- benchmark, smoke, and release-check flows

Parser-backed symbol extraction currently covers:

- TypeScript
- JavaScript
- Python
- Go
- Rust
- Java

## Quick Start

Requirements:

- Node.js 22+
- npm

Optional toolchains that improve parser-backed symbol extraction:

- Python
- Go
- Rust / Cargo
- Java / javac

Install and build:

```bash
npm install
npm run build
```

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

## MCP Usage Flow

The recommended first-run workflow is:

1. `bootstrap_project`
2. `index_project`
3. `remember` or `remember_decision`
4. `context_for_task`
5. `recall`

Typical MCP server command:

```json
{
  "command": "node",
  "args": ["D:/projects/mind_keeper/dist/index.js"]
}
```

Development-time MCP command:

```json
{
  "command": "npx",
  "args": ["tsx", "D:/projects/mind_keeper/src/index.ts"]
}
```

## Most Important Tools

- `bootstrap_project`
- `index_project`
- `remember`
- `remember_decision`
- `recall`
- `recall_fast`
- `recall_deep`
- `context_for_task`
- `suggest_session_memory`
- `summarize_session`
- `list_sources`
- `disable_source`
- `enable_source`
- `rate_source`
- `archive_stale_memories`
- `list_conflicts`
- `list_conflict_clusters`
- `suggest_conflict_resolutions`
- `plan_conflict_resolutions`
- `validate_conflict_resolution_plan`
- `execute_conflict_resolution_plan`
- `verify_conflict_resolution_execution`
- `suggest_conflict_resolution_followup`
- `execute_conflict_resolution_followup`
- `suggest_consolidations`
- `consolidate_memories`

Detailed usage examples live in [docs/MCP_TOOLS_ADDENDUM.md](/D:/projects/mind_keeper/docs/MCP_TOOLS_ADDENDUM.md).

## Architecture Snapshot

The codebase is now split into focused layers instead of one giant service:

- facade entry: [src/mindkeeper.ts](/D:/projects/mind_keeper/src/mindkeeper.ts)
- facade implementation: [src/mindkeeper-facade.ts](/D:/projects/mind_keeper/src/mindkeeper-facade.ts)
- memory writes: [src/app/memory-write-service.ts](/D:/projects/mind_keeper/src/app/memory-write-service.ts)
- project indexing: [src/app/project-index-service.ts](/D:/projects/mind_keeper/src/app/project-index-service.ts)
- recall orchestration: [src/app/recall-service.ts](/D:/projects/mind_keeper/src/app/recall-service.ts)
- session distillation: [src/app/session-service.ts](/D:/projects/mind_keeper/src/app/session-service.ts)
- hygiene and governance: [src/app/hygiene-service.ts](/D:/projects/mind_keeper/src/app/hygiene-service.ts)
- source controls: [src/app/source-service.ts](/D:/projects/mind_keeper/src/app/source-service.ts)

## Status And Release

Quick machine-readable status:

```bash
npm run status
```

Save the current status snapshot into manifests:

```bash
npm run status:save
```

Full verification:

```bash
npm run verify
```

Release gate:

```bash
npm run release:check
```

## Documentation

- [docs/STATUS.md](/D:/projects/mind_keeper/docs/STATUS.md)
- [docs/CAPABILITIES.md](/D:/projects/mind_keeper/docs/CAPABILITIES.md)
- [docs/EXTENSION_POINTS.md](/D:/projects/mind_keeper/docs/EXTENSION_POINTS.md)
- [docs/MCP_TOOLS_ADDENDUM.md](/D:/projects/mind_keeper/docs/MCP_TOOLS_ADDENDUM.md)
- [docs/RELEASE_ADDENDUM.md](/D:/projects/mind_keeper/docs/RELEASE_ADDENDUM.md)
- [docs/QUALITY_ADDENDUM.md](/D:/projects/mind_keeper/docs/QUALITY_ADDENDUM.md)

## Current Bias

Mind Keeper is intentionally optimized for:

- IDE responsiveness over maximum retrieval depth
- stable knowledge over raw session exhaust
- explicit explainability over opaque magic
- project isolation over cross-project pooling
