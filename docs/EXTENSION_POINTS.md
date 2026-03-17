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
- better conflict clustering
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
