# Mind Keeper Quality

## Current Quality Guardrails

Mind Keeper now has two lightweight quality layers:

- regression tests with `npm test`
- an end-to-end smoke check with `npm run smoke`
- a repeatable benchmark with `npm run bench`
- a history-aware regression check with `npm run bench:check`

These are intentionally simple so they stay fast enough to run during active development.

## Test Coverage

Current automated coverage includes:

- parser-backed symbol extraction for `typescript`
- parser-backed symbol extraction for `python`
- parser-backed symbol extraction for `go`
- parser-backed symbol extraction for `rust`
- parser-backed symbol extraction for `java`
- symbol-targeted recall after indexing a project
- task-context recall gates for current file, current symbol, diagnostics, and related files
- task-context source balancing so decision memory is not crowded out by current-file project chunks
- task-stage inference and budget explanations for `context_for_task`
- token-budget trimming and omitted-result reporting for `context_for_task`
- source-feedback ranking so `helpful` and `noisy` signals can change recall order
- time-aware feedback decay so stale noisy memories sink faster than recent noisy ones
- branch-aware recall ordering and branch-view summaries
- session-memory suggestion heuristics for `decision` vs `diary`
- distiller-based memory promotion into `knowledge`, `decision`, `diary`, or `discard`
- end-to-end IDE workflow fixtures that combine branch recall, feedback ranking, task context, and session persistence

The current test entrypoints are:

- [tests/symbols.test.ts](/D:/projects/mind_keeper/tests/symbols.test.ts)
- [tests/recall.test.ts](/D:/projects/mind_keeper/tests/recall.test.ts)
- [tests/context_for_task.test.ts](/D:/projects/mind_keeper/tests/context_for_task.test.ts)
- [tests/feedback_ranking.test.ts](/D:/projects/mind_keeper/tests/feedback_ranking.test.ts)
- [tests/branch_views.test.ts](/D:/projects/mind_keeper/tests/branch_views.test.ts)
- [tests/session_suggestions.test.ts](/D:/projects/mind_keeper/tests/session_suggestions.test.ts)
- [tests/distiller_ranking.test.ts](/D:/projects/mind_keeper/tests/distiller_ranking.test.ts)
- [tests/ide_workflows.test.ts](/D:/projects/mind_keeper/tests/ide_workflows.test.ts)
- [tests/benchmark_suite.test.ts](/D:/projects/mind_keeper/tests/benchmark_suite.test.ts)

## Benchmark Coverage

The benchmark currently measures:

- per-language symbol extraction latency on representative snippets
- end-to-end `indexProject + recall` latency on a temporary mini project
- optional forced reindex + recall latency on a real project tree via `--project-root`
- optional multi-project benchmark suites via `--suite`

The benchmark entrypoint is:

- [scripts/benchmark.ts](/D:/projects/mind_keeper/scripts/benchmark.ts)

Useful commands:

```bash
npm run smoke
npm run bench
npm run bench:save
npm run bench:record
npm run bench:check
npm run bench:project
npm run bench:project:record
npm run bench:suite
npm run bench:suite:record
npm run bench:suite:check
```

Saved reports go to:

- `.mindkeeper/manifests/benchmark-latest.json`
- `.mindkeeper/manifests/benchmark-history/*.json`
- `.mindkeeper/manifests/benchmark-history/index.json`
- `.mindkeeper/manifests/benchmark-suite-latest.json`
- `.mindkeeper/manifests/benchmark-suite-history/*.json`
- `.mindkeeper/manifests/benchmark-suite-history/index.json`
- `.mindkeeper/manifests/benchmark-suite-history/profiles/index.json`
- `.mindkeeper/manifests/benchmark-suite-history/profiles/<suite-profile>/index.json`
- `.mindkeeper/manifests/benchmark-suite-history/profiles/<suite-profile>/latest.json`

The default local suite file is:

- [benchmarks/workspaces.local.json](/D:/projects/mind_keeper/benchmarks/workspaces.local.json)

Suite entry roots are resolved relative to the suite file, so one config can be moved between machines with only small path edits. The suite profile defaults to the suite filename, which means `bench:suite:check` compares only against history from the same workspace group instead of mixing unrelated repository sets.

`bench:check` and `bench:suite:check` are read-only checks. They use history for comparison but do not append a new sample unless you run a `*:record` command.

When suite history exists, the comparison output now includes per-project `indexMs` and `recallMs` baselines for the current workspace group, so you can see whether one repository is drifting even if the suite total still looks stable.

`npm run smoke` is the fastest end-to-end sanity check. It creates a temporary project and verifies the core memory path from scaffold to retrieval still works as one chain.

`npm run bench:check` compares the current run against the median of the most recent history window and exits non-zero only on clear regressions. The thresholds are intentionally conservative so routine machine noise does not fail the check.

## Language Matrix

Current parser-backed symbol adapters:

- `typescript`: AST-backed via TypeScript compiler API
- `javascript`: AST-backed via TypeScript compiler API
- `python`: AST-backed via local Python runtime when available
- `go`: AST-backed via a cached local Go parser tool
- `rust`: AST-backed via a cached local Cargo parser tool
- `java`: parser-backed via a cached local `javac` tool-based parser

Fallback behavior:

- unsupported languages use regex extraction
- supported languages also fall back to regex if the parser tool is unavailable or parsing fails

## Performance Notes

Based on the latest saved benchmark at [\.mindkeeper/manifests/benchmark-latest.json](/D:/projects/mind_keeper/.mindkeeper/manifests/benchmark-latest.json):

- `typescript` is the cheapest parser-backed adapter at about `3.52ms`
- `go` is now relatively cheap after binary caching at about `30.49ms`
- `python` and `rust` are moderate at about `138.03ms` and `177.11ms`
- `java` is currently the heaviest parser-backed adapter at about `438.58ms`

This means future optimization work is most likely to pay off in:

1. `java`
2. `rust`
3. wider benchmark coverage on real project trees

## Regression Heuristics

The current benchmark check uses a rolling history baseline and only flags a regression when both the relative slowdown and the absolute extra latency are meaningfully above the recent median:

- symbol extraction: at least `60%` slower and at least `8ms` worse
- retrieval indexing: at least `75%` slower and at least `30ms` worse
- retrieval recall: at least `100%` slower and at least `12ms` worse

This is meant to catch real step-function regressions without turning the benchmark into a flaky CI gate.

## Known Gaps

- there is not yet a parser-backed adapter for `csharp`
- there is not yet a parser-backed adapter for `kotlin`
- suite quality still depends on choosing representative repositories and queries

## Suggested Next Steps

1. Add `csharp` parser-backed symbol extraction
2. Add broader recall-quality regression fixtures for task-context gating
3. Populate the suite with multiple real repositories and track profile changes over time
4. Add project-benchmark history views split by workspace profile
