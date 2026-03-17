# Mind Keeper Status

This file is the clean status snapshot for the current build.

## Overall State

- Core V1 product shape: done
- Refactor foundation: done
- Write-time memory distillation: done
- Light-wave task context planning: done
- Intent-first task planning layer: done
- Confidence-aware wave stopping: done
- Per-wave budgeting: done
- One-hop memory mesh expansion: done
- Conflict-aware wave gating: done
- Fast/deep recall split: done
- Lightweight graph boosts: done
- Long-term hygiene baseline: done
- Productization docs and release checks: done
- Suggestion-driven consolidation scanning: done
- Subject-level conflict clustering: done
- Conflict-resolution suggestions: done
- Conflict-resolution plans: done
- Conflict-resolution execution: done
- Conflict-resolution safety checks: done
- Conflict-resolution follow-up suggestions: done
- Conflict-resolution follow-up execution: done

## Quick Status Command

Use this when you want one compact JSON snapshot of the current build shape:

```bash
npm run status
```

To save the same snapshot for release handoff or audit notes:

```bash
npm run status:save
```

For future maintainers, the main extension map lives in:

- [docs/EXTENSION_POINTS.md](/D:/projects/mind_keeper/docs/EXTENSION_POINTS.md)

## What Is Stable Today

- Project-scoped `.mindkeeper` layout with isolated memory per repository
- Thin facade entry at `src/mindkeeper.ts` with the real service implementation in `src/mindkeeper-facade.ts`
- Durable memory writes extracted into `src/app/memory-write-service.ts`
- Project indexing and document persistence extracted into `src/app/project-index-service.ts`
- Shared helper defaults extracted into `src/memory-defaults.ts` and `src/git.ts`
- Incremental indexing and manifest tracking
- Parser-backed symbol extraction for TypeScript, JavaScript, Python, Go, Rust, and Java
- Distilled memory tiers with `discard / diary / decision / knowledge`
- `context_for_task` with wave planning, task-stage gating, and token budget gating
- `context_for_task` now suppresses competing conflicting decisions in favor of one canonical decision when stable-wave policy drift is detected
- `recall_fast` and `recall_deep`
- Relation-aware rerank using lightweight graph edges
- Governance tools for stale archive, conflict listing, conflict clustering, and memory consolidation
- Governance tools now bridge conflict clusters into resolution suggestions before consolidation
- Governance tools now expose executable resolution plans before consolidation
- Governance tools can now publish one canonical decision from a reviewed resolution plan
- Governance tools now validate plans before execution and verify results afterward
- Governance tools now suggest the next follow-up action after canonical decision execution
- Governance tools can now execute the recommended follow-up cleanup for superseded conflicts
- `verify`, benchmark checks, and smoke coverage

## What `verify` Covers Directly

The current `npm run verify` path now exercises:

- project bootstrap
- project indexing
- structured decision persistence
- imported memory persistence
- session distillation
- light-wave task context assembly
- explainable recall with relation signals
- fast recall and deep recall
- stale archive
- conflict detection
- conflict clustering
- conflict-resolution suggestions
- conflict-resolution plans
- conflict-resolution execution
- conflict-resolution safety checks
- conflict-resolution follow-up suggestions
- conflict-resolution follow-up execution
- memory consolidation
- compile/build integrity

For release handoff, the current one-command gate is:

- `npm run release:check`

## Remaining Non-Blockers

- More parser-backed adapters such as C# or Kotlin
- Auto-apply consolidation after suggestion review
- Richer IDE-side presentation for wave and relation explain output
- Optional heavier rerank modes when latency budget allows

## Positioning

Mind Keeper is already a strong IDE memory system with clear VCP influence.

What is finished:

- project isolation
- memory distillation
- gated retrieval
- lightweight wave planning
- lightweight relation graph
- long-term hygiene baseline

What is still intentionally lighter than a full VCP-style memory operating system:

- automatic long-horizon memory governance
- heavier multi-wave deep retrieval orchestration
- richer memory-network reasoning
