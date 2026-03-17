# Mind Keeper Release Checklist

## Recommended Pre-Release Flow

Before cutting a release or handing the project to another developer, run:

```bash
npm run verify
```

This bundles the fastest high-signal checks:

- `npm run check`
- `npm test`
- `npm run build`
- `npm run smoke`

If you changed retrieval heuristics, symbol extraction, or indexing behavior, also run:

```bash
npm run bench:check
npm run bench:suite:check
```

If you want to refresh local benchmark history after a meaningful change, run:

```bash
npm run bench:record
npm run bench:suite:record
```

## What `verify` Protects

`npm run verify` is meant to catch four classes of regressions quickly:

- Type-level breakage in the TypeScript codebase
- behavior regressions in retrieval, branch logic, feedback ranking, and workflow fixtures
- build breakage in the distributable server output
- end-to-end failures across scaffold, indexing, persistence, task context, and recall

## Suggested Release Notes Checklist

Before calling a version "ready", confirm:

- docs match the current MCP tools and benchmark workflow
- the default `.mindkeeper/config.toml` still loads cleanly from old projects
- benchmark suite checks are compared against the correct workspace profile
- no new capability depends on a toolchain that is absent on the target machine

## Current Known Environment Limits

These are not release blockers for the current V1, but they should stay visible:

- `csharp` parser-backed extraction is not implemented
- `kotlin` parser-backed extraction is not implemented
- richer multi-repo benchmark suites still depend on local machine repository availability
