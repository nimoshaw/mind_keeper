# Mind Keeper Capability Matrix

This file tracks what is already live in the current project and what still belongs to future expansion work.

## Implemented

- Project-scoped `.mindkeeper` layout
- Manual knowledge, diary, decision, imported, and in-place project indexing
- Incremental indexing with manifests
- Parser-backed symbol extraction for TypeScript, JavaScript, Python, Go, Rust, and Java
- Hybrid recall with vector, lexical, source-priority, branch, feedback, and relation-aware boosts
- `context_for_task` with intent-first planning, task-stage, token-budget, and light-wave gating
- `recallFast` and `recallDeep`
- Write-time session distillation into `discard / diary / decision / knowledge`
- Source hygiene with disable/enable, feedback, stale archiving, conflict detection, and consolidation
- Subject-level conflict clustering for decision drift review
- Conflict-resolution suggestions that feed directly into canonical decision consolidation
- Conflict-resolution plans with executable consolidation templates
- Canonical decision execution from reviewed conflict plans
- Preflight validation and post-execution verification for conflict resolution
- Follow-up governance suggestions after canonical decision execution
- Executable follow-up cleanup actions after canonical decision execution
- Consolidation suggestion scanning for related memories
- Benchmark, smoke, and regression coverage

## Product Shape Today

- V1 core: done
- Refactor foundation for V2: done
- Lightweight wave recall: done
- Lightweight graph rerank: done
- Long-term hygiene baseline: done
- Release and verification surface: done

## Still Open / Future Expansion

- Parser-backed adapters for more languages such as C# or Kotlin
- Stronger relation-aware planning between decisions and related symbols/files
- Heavier cross-encoder rerank strategies when latency budget allows
- Richer IDE UI affordances for wave and relation explain output

## Current Bias

Mind Keeper is intentionally optimized for:

- IDE responsiveness over maximal retrieval depth
- stable knowledge over raw session exhaust
- explicit explainability over opaque magic
- project isolation over cross-project pooling

## Verification Snapshot

The current release path has direct coverage for:

- `context_for_task` light-wave explain output
- `recall_fast` and `recall_deep`
- relation-aware recall explain output
- stale archive
- conflict inspection
- memory consolidation

## Structure Snapshot

The current codebase is no longer centered on one giant service file:

- facade entry: `src/mindkeeper.ts`
- facade implementation: `src/mindkeeper-facade.ts`
- memory writes: `src/app/memory-write-service.ts`
- project indexing: `src/app/project-index-service.ts`
- recall orchestration: `src/app/recall-service.ts`
- session distillation: `src/app/session-service.ts`
- source and hygiene operations: `src/app/source-service.ts`, `src/app/hygiene-service.ts`
