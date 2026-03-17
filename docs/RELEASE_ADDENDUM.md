# Release Addendum

This addendum reflects the release surface after the recent refactor and optimization phases.

## Additional Release Checks

Before calling the current build ready, also confirm:

- `recall_fast` and `recall_deep` both respond correctly
- `context_for_task` returns light-wave explain fields
- relation-aware rerank still returns `relationBoost` only as a small additive signal
- governance tools behave safely:
  - `archive_stale_memories`
  - `list_conflicts`
  - `list_conflict_clusters`
  - `suggest_conflict_resolutions`
  - `plan_conflict_resolutions`
  - `execute_conflict_resolution_plan`
  - `suggest_consolidations`
  - `consolidate_memories`
- `npm run verify` exercises those paths end to end without manual setup

## Current Release Shape

The current build now includes:

- Phase 0 refactor foundation
- Phase 1 write-time distillation
- Phase 2 light-wave task recall
- Phase 3 fast/deep recall entry points
- Phase 4 lightweight graph edges with relation-aware rerank
- Phase 5 hygiene tooling for archive, conflict inspection, and consolidation
- V2 drift review with subject-level conflict clustering
- V2 conflict-resolution suggestions for canonical decision drafts
- V2 conflict-resolution plans for executable consolidation handoff
- V2 canonical decision execution from reviewed plans

## Recommended Commands

Run these before shipping or handing the project to someone else:

```bash
npm run release:check
```

If you want to run the same checks one layer at a time, use:

```bash
npm run verify
npm run bench:check
npm run bench:suite:check
npm run status:save
```

If benchmark history should be refreshed after a meaningful retrieval change, then run:

```bash
npm run bench:record
npm run bench:suite:record
```

## Remaining Non-Blockers

- more parser-backed languages can still be added later
- conflict detection is still heuristic, not full semantic contradiction analysis
- consolidation execution is still explicit/manual after suggestions are reviewed
