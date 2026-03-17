# Quality Addendum

This addendum covers the newer regression surface that arrived after the earlier quality guide.

## Newly Covered Areas

- light-wave task context planning
- fast vs deep recall mode separation
- lightweight graph relation boosts and explain hits
- stale memory archiving into the `cold` tier
- conflict detection across decision memories
- subject-level conflict clustering for grouped decision drift review
- conflict-resolution suggestions for canonical decision drafting
- conflict-resolution plans with executable templates
- canonical decision execution from reviewed resolution plans
- conflict-resolution preflight validation and post-execution verification
- memory consolidation into stable knowledge/decision notes

## New Test Entry Points

- [tests/graph_ranking.test.ts](/D:/projects/mind_keeper/tests/graph_ranking.test.ts)
- [tests/recall_modes.test.ts](/D:/projects/mind_keeper/tests/recall_modes.test.ts)
- [tests/hygiene_governance.test.ts](/D:/projects/mind_keeper/tests/hygiene_governance.test.ts)

## What `verify` Now Covers in Practice

The current `verify` path now exercises:

- scaffold
- indexing
- structured decision persistence
- imported memory persistence
- session distillation
- light-wave task context assembly
- explainable relation-aware recall
- fast recall and deep recall
- stale archive
- conflict detection
- conflict clustering
- conflict-resolution suggestions
- conflict-resolution plans
- conflict-resolution execution
- conflict-resolution safety checks
- memory consolidation
- compile/build integrity

That means the project now has one fast command that covers both the original V1 path and the newer wave/graph/governance layers directly through smoke, with broader edge cases still guarded by the test suite.
