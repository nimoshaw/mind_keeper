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
    flash/
    canonical/
    indexes/
      <active-embedding-profile>/
    manifests/
    vector/
    cache/
```

Meaning:

- `knowledge/`: user-managed long-lived notes
- `diary/`: session and progress memory
- `decisions/`: durable project decisions
- `imports/`: manually imported references
- `flash/`: active work-state handoff for fast resume on the next session
- `canonical/`: model-agnostic memory descriptors and export-safe cross-agent contract files
- `indexes/<active-embedding-profile>/`: active embedding profile descriptors and reusable profile-scoped index metadata
- `manifests/`: indexing summaries, benchmark snapshots, status snapshots
- `vector/`: SQLite data, chunk metadata, embeddings, retrieval artifacts
- `cache/`: temporary extraction outputs

## Current Product Shape

Implemented today:

- project-scoped `.mindkeeper`
- incremental indexing with manifests
- batch-capable embedding for chunk-heavy indexing paths
- vectorization baseline metrics for indexing, rebuild, remember, and recall
- write-time memory distillation
- flash handoff checkpoints for session-to-session resume
- light-wave task context recall
- intent subtype planning for bug fixes, migrations, API changes, docs, and architecture review
- explainable task-context summaries that tell IDE clients why memory was chosen or suppressed
- IDE-friendly explain panels and per-result explain cards for direct client rendering
- feedback-aware explain output and immediate vote totals after helpful/noisy signals
- intent-first light-wave task context recall
- confidence-aware wave stopping
- per-wave budget profiles for task context recall
- one-hop memory mesh expansion after stable hits
- controlled two-hop memory mesh expansion when stable seeds are strong enough
- conflict-aware wave gating for competing decision memories
- adaptive deep-wave triggers for history-focused tasks
- fast recall and deep recall entry points
- lightweight graph-aware rerank
- stale archive, conflict listing, and consolidation
- project memory health review with stale/noisy/conflict cleanup recommendations
- explicit superseded marking for older decisions after a canonical policy is published
- stale decision review and cleanup planning for long-lived projects with evolving policies
- semi-automatic cleanup execution for safe hygiene actions like stale archive and noisy-source disabling
- canonical-memory and active-profile index scaffolding for future cross-agent compatibility
- active-profile reuse and rebuild guidance when the embedding profile changes
- explicit profile-index validation before rebuild or cross-agent reuse
- safe active-profile rebuild from canonical memory files and the project tree
- profile-registry repair for missing config or canonical/profile descriptors
- stable canonical contract descriptor for model-agnostic memory interoperability
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

## Current Design Docs

Use these first when you need to re-enter the project quickly:

- product and architecture status: [docs/STATUS.md](/D:/projects/mind_keeper/docs/STATUS.md)
- architecture handoff: [docs/ARCHITECTURE.md](/D:/projects/mind_keeper/docs/ARCHITECTURE.md)
- maintainer handoff: [docs/HANDOFF.md](/D:/projects/mind_keeper/docs/HANDOFF.md)
- capability matrix: [docs/CAPABILITIES.md](/D:/projects/mind_keeper/docs/CAPABILITIES.md)
- VCP-inspired vector pipeline plan: [docs/VCP_VECTOR_PIPELINE_PLAN.md](/D:/projects/mind_keeper/docs/VCP_VECTOR_PIPELINE_PLAN.md)
- extension map: [docs/EXTENSION_POINTS.md](/D:/projects/mind_keeper/docs/EXTENSION_POINTS.md)
- cross-agent compatibility plan: [docs/CROSS_AGENT_COMPAT.md](/D:/projects/mind_keeper/docs/CROSS_AGENT_COMPAT.md)
- client release plan: [docs/CLIENT_RELEASE_PLAN.md](/D:/projects/mind_keeper/docs/CLIENT_RELEASE_PLAN.md)

## Quick Start

First release target:

- Windows 11

Windows-first deployment and release notes live in [docs/WIN11_RELEASE.md](/D:/projects/mind_keeper/docs/WIN11_RELEASE.md).

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

Win11 one-command setup:

```powershell
npm run setup:win11
```

Win11 portable `exe` build for non-Node users:

```powershell
npm run package:win11
```

That command creates:

- `artifacts/win11/MindKeeper-win11-x64/mind-keeper.exe`
- `artifacts/win11/MindKeeper-win11-x64/app/`

The current Windows release format is a stable `exe` launcher plus a sibling `app` runtime folder.
This is intentional for V1 because `better-sqlite3` is a native dependency, and this layout is more reliable than forcing everything into one opaque single-file package.

Win11 `Setup.exe` installer build for normal end-user installation:

```powershell
npm run package:win11:installer
```

That command expects `Inno Setup 6` on the maintainer machine.
If it is missing, the script stops with a clear preflight message instead of failing halfway through.

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

Win11 local MCP launch:

```powershell
npm run start:win11
```

Portable release launch:

```powershell
artifacts\win11\MindKeeper-win11-x64\mind-keeper.exe
```

Quick portable package health check:

```powershell
artifacts\win11\MindKeeper-win11-x64\mind-keeper.exe --self-check
```

Portable package MCP config example:

```text
artifacts/win11/MindKeeper-win11-x64/mcp-client-config.example.json
```

Optional embedding batch tuning:

- `MIND_KEEPER_EMBED_BATCH_MAX_ITEMS`
- `MIND_KEEPER_EMBED_BATCH_MAX_ESTIMATED_TOKENS`
- `MIND_KEEPER_EMBED_BATCH_CONCURRENCY`

These only affect the newer batch-capable embedding path.
They are most useful when the active embedding profile is remote and OpenAI-compatible.

## MCP Usage Flow

The recommended first-run workflow is:

1. `bootstrap_project`
2. `index_project`
3. `remember` or `remember_decision`
4. `context_for_task`
5. `recall`

The recommended handoff workflow between two work sessions is:

1. `flash_checkpoint`
2. stop work or switch away from the project
3. next time, call `flash_resume`
4. then call `context_for_task`

That gives Mind Keeper one lightweight "what was I doing and what should I do next" layer before deeper recall.
In normal IDE usage, you do not have to remember to do this every time.
`context_for_task` now also performs low-cost automatic flash updates on meaningful task-context calls, so the active handoff state can keep up without constant manual input.

When switching embedding models or handing a project to another agent, use:

1. `validate_profile_index`
2. `recover_profile_index` (recommended one-call recovery)
3. `inspect_memory_access_surface` (optional final cross-agent check)

If you want to preview the recovery path before touching files, call `recover_profile_index` with `dry_run: true`.
The response will keep the current validation state unchanged and return planned steps plus `manualActions`.

Recovery strategies:

- `safe`: repair metadata only, then stop and return the next manual step
- `standard`: repair, rebuild, and index as needed
- `aggressive`: same as `standard`, but forces project indexing when indexing runs

When recovery fails, the report now includes a stable `failure.code` plus `manualActions`.
This is intended for IDE clients to show concrete next steps like reviewing `.mindkeeper/config.toml` or setting a missing API key environment variable.

When you finish a work block, store one flash checkpoint if you want an explicit handoff.
Good flash checkpoints are short and operational:

- `session_goal`: what this session was trying to accomplish
- `current_status`: where the work stopped
- `working_memory`: temporary reasoning worth carrying into the next session
- `next_steps`: the first actions to take next time
- `blockers`: what could stall the restart
- `touched_files`: files most likely to matter when resuming

Typical flash checkpoint payload:

```json
{
  "project_root": "D:/projects/mind_keeper",
  "title": "Manifest cleanup handoff",
  "session_goal": "Finish the manifest cleanup pass and preserve useful diary notes.",
  "current_status": "Index rebuild is done; cleanup policy still needs one final review.",
  "working_memory": "The risk is auto-archiving notes that should only be disabled.",
  "next_steps": [
    "Review cleanup recommendations",
    "Run apply_memory_cleanup_plan with safe actions only"
  ],
  "blockers": [
    "Need to confirm the stale threshold"
  ],
  "touched_files": [
    "D:/projects/mind_keeper/src/app/hygiene-service.ts",
    "D:/projects/mind_keeper/README.md"
  ]
}
```

Next time you return, `flash_resume` returns the active checkpoint plus a ready-to-inject `resumePrompt`.
`context_for_task` also reads a fresh flash checkpoint automatically, treats flash-touched files as related hints, and now refreshes auto flash state with low-cost JSON writes instead of heavy indexing or embedding work.

Typical MCP server command:

```json
{
  "command": "node",
  "args": ["D:/projects/mind_keeper/dist/index.js"]
}
```

If you are shipping the Win11 portable package instead of the npm build, point the client to:

```json
{
  "command": "D:/projects/mind_keeper/artifacts/win11/MindKeeper-win11-x64/mind-keeper.exe"
}
```

If you installed through `Setup.exe`, the default path in the packaged MCP config example is:

```json
{
  "command": "C:/Program Files/Mind Keeper/mind-keeper.exe",
  "args": []
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
- `inspect_memory_access_surface`
- `inspect_canonical_memory`
- `inspect_canonical_governance`
- `export_canonical_memory`
- `validate_profile_index`
- `recover_profile_index`
- `rebuild_active_profile_index`
- `repair_profile_registry`
- `index_project`
- `remember`
- `remember_decision`
- `flash_checkpoint`
- `flash_resume`
- `flash_clear`
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
- `list_stale_decisions`
- `suggest_memory_cleanup`
- `apply_memory_cleanup_plan`
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
- flash resume and handoff: [src/app/flash-service.ts](/D:/projects/mind_keeper/src/app/flash-service.ts)
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

- [docs/ARCHITECTURE.md](/D:/projects/mind_keeper/docs/ARCHITECTURE.md)
- [docs/HANDOFF.md](/D:/projects/mind_keeper/docs/HANDOFF.md)
- [docs/STATUS.md](/D:/projects/mind_keeper/docs/STATUS.md)
- [docs/CAPABILITIES.md](/D:/projects/mind_keeper/docs/CAPABILITIES.md)
- [docs/VCP_VECTOR_PIPELINE_PLAN.md](/D:/projects/mind_keeper/docs/VCP_VECTOR_PIPELINE_PLAN.md)
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
