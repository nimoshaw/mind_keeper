# Mind Keeper Extension Points

This file explains where new capabilities should be added without collapsing the structure back into one giant service.

## Add A New Parser-Backed Language

Primary file:

- `src/symbols.ts`

What to add:

- parser-backed extraction for whole-file symbol spans
- lightweight fallback logic when the parser tool is unavailable
- tests in `tests/symbols.test.ts`
- benchmark visibility through the existing symbol benchmark path

Keep in mind:

- whole-file parser usage is preferred during indexing
- chunk-level inference should stay lightweight
- fallback must keep indexing usable even when the language toolchain is missing

## Add A New Embedding Profile

Primary files:

- `src/config.ts`
- `src/embedding.ts`
- project `.mindkeeper/config.toml`

What to add:

- profile schema and defaults
- profile validation
- runtime adapter logic in `EmbeddingService`

Keep in mind:

- one project partition must keep one embedding dimension
- model changes should trigger reindex guidance instead of silent drift

## Prepare Cross-Agent Compatibility

Primary docs:

- `docs/CROSS_AGENT_COMPAT.md`

Likely primary files when implementation starts:

- `src/storage.ts`
- one future canonical repository under `src/app/` or `src/`
- one future profile registry under `src/app/` or `src/`

What to add:

- a clean separation between canonical memory truth and profile-specific index artifacts
- explicit profile identity for index ownership
- documented schema versioning for reusable memory metadata

Keep in mind:

- do not push profile awareness up into wave planning
- do not let `context_for_task` query multiple embedding profiles at runtime
- index artifacts should stay rebuildable cache, not product truth

## Add A New Reranker Profile

Primary files:

- `src/config.ts`
- `src/reranker.ts`
- `src/app/recall-service.ts`

What to add:

- reranker profile config
- adapter logic
- explain support so the score contribution stays visible

Keep in mind:

- rerank should stay top-N only
- real-time task context should not depend on heavy model calls by default

## Extend Recall Planning

Primary files:

- `src/planner.ts`
- `src/app/recall-service.ts`

What to add:

- new wave definitions
- new stop conditions
- new fast/deep routing rules

Keep in mind:

- default IDE flow should still stop early most of the time
- explain output must show what wave or plan was actually used

## Extend Memory Hygiene

Primary files:

- `src/app/hygiene-service.ts`
- `src/storage.ts`

What to add:

- new archive policies
- deeper conflict clustering or semantic contradiction analysis
- richer conflict-to-resolution suggestion ranking
- more opinionated conflict-resolution plan generation
- safer auto-execution policies for canonical decision publishing
- richer verification policies after canonical decision execution
- smarter follow-up governance policies after canonical resolution
- stronger consolidation suggestion ranking

Keep in mind:

- hygiene actions should be reversible or at least inspectable
- disabling is safer than deleting when the user has not explicitly asked to remove data

## Add A New MCP Tool

Primary files:

- `src/index.ts`
- one focused app service under `src/app/`

What to add:

- schema in the MCP server
- a service-level implementation
- docs in `docs/MCP_TOOLS_ADDENDUM.md`
- regression coverage in `tests/`

Keep in mind:

- do not grow `src/mindkeeper-facade.ts` unnecessarily
- prefer adding focused services instead of putting business logic back into the facade

## Current Module Map

- facade entry: `src/mindkeeper.ts`
- facade implementation: `src/mindkeeper-facade.ts`
- memory writes: `src/app/memory-write-service.ts`
- project indexing: `src/app/project-index-service.ts`
- recall: `src/app/recall-service.ts`
- session distillation: `src/app/session-service.ts`
- hygiene: `src/app/hygiene-service.ts`
- sources: `src/app/source-service.ts`
