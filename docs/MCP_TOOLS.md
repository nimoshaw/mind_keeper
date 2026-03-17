# MCP Tools 实战手册

这份文档不是单纯列参数，而是告诉你：

- 每个工具什么时候用
- 最少要传什么
- 推荐怎么传
- 常见误区是什么

如果你是第一次上手，最推荐的顺序是：

1. `bootstrap_project`
2. `index_project`
3. `remember` 或 `remember_decision`
4. `context_for_task`
5. `recall`

---

## 1. `bootstrap_project`

### 什么时候用

- 第一次把 `Mind Keeper` 用在一个新项目上
- 项目根目录下还没有 `.mindkeeper`

### 它会做什么

- 创建 `.mindkeeper` 目录结构
- 生成默认 `config.toml`
- 返回当前启用的 embedding / reranker profile

### 最小调用

```json
{
  "project_root": "D:/your_project"
}
```

### 你会得到什么

通常会看到：

- `projectName`
- `activeEmbeddingProfile`
- `activeRerankerProfile`
- 关键目录列表

### 最常见误区

- 它不会自动索引项目源码
- 它只是初始化，不会自动写入任何知识和日记

所以初始化后通常下一步就是 `index_project`。

---

## 2. `index_project`

### 什么时候用

- 新项目初始化后第一次建立索引
- 项目源码和文档有明显变化后
- 你改了模型、索引规则、符号提取逻辑后想重建索引

### 它会做什么

- 扫描项目里的代码、文档、配置
- 跳过 `.mindkeeper`、构建产物、二进制、超大文件
- 为每个文件生成 chunk、embedding、metadata
- 把索引产物写进 `.mindkeeper/vector`
- 把索引摘要写进 `.mindkeeper/manifests/project-index.json`

### 最小调用

```json
{
  "project_root": "D:/your_project"
}
```

### 强制重建

```json
{
  "project_root": "D:/your_project",
  "force": true
}
```

### 什么时候建议加 `force`

- 切换了 `activeEmbeddingProfile`
- 修改了 `includeGlobs / excludeGlobs`
- 更新了 parser-backed symbol extraction
- 怀疑旧索引和当前配置不一致

### 返回值怎么看

- `indexedFiles`: 这次真正重建的文件数
- `skippedFiles`: 被排除或跳过的文件数
- `unchangedFiles`: 没变所以直接跳过的文件数
- `removedFiles`: 已删除文件被清理掉的索引数

### 最常见误区

- 它不会把整个项目复制进 `.mindkeeper/vector`
- 它索引的是项目内容，不是备份项目

---

## 3. `remember`

### 什么时候用

- 你有一条“值得长期记住”的知识
- 这条内容不一定是架构决策，但确实对项目有长期价值

适合写进去的内容：

- 命名规范
- 项目约定
- 常见修复方式
- 外部资料摘要
- 某个模块的人工说明

### 可选的 `source_kind`

- `manual`
- `decision`
- `diary`
- `imported`

如果你不是很确定，通常优先用 `manual`。

### 最小调用

```json
{
  "project_root": "D:/your_project",
  "source_kind": "manual",
  "content": "All external DTO fields use camelCase."
}
```

### 推荐调用

```json
{
  "project_root": "D:/your_project",
  "source_kind": "manual",
  "title": "DTO naming convention",
  "module_name": "api",
  "tags": ["convention", "dto"],
  "content": "All external DTO fields use camelCase. Database columns remain snake_case."
}
```

### 它会写到哪里

按 `source_kind` 分别写到：

- `manual` -> `.mindkeeper/knowledge`
- `decision` -> `.mindkeeper/decisions`
- `diary` -> `.mindkeeper/diary`
- `imported` -> `.mindkeeper/imports`

同时它会立刻完成索引，不需要你额外再调一次 `index_project`。

### 最常见误区

- 不要把大段低价值聊天记录直接塞进来
- `remember` 更适合“总结过、值得留下”的内容，不适合原始噪声

---

## 4. `remember_decision`

### 什么时候用

- 你做了一条明确的架构决策
- 你确认了某条流程、规范、技术选型
- 你想让后续召回时这条决策拥有更高权重

### 最小调用

```json
{
  "project_root": "D:/your_project",
  "title": "Use incremental indexing",
  "decision": "Only changed files should be reindexed."
}
```

### 推荐调用

```json
{
  "project_root": "D:/your_project",
  "title": "Use incremental indexing",
  "decision": "Only changed files should be reindexed.",
  "rationale": "Full rebuilds are too expensive in IDE workflows.",
  "impact": "When parser rules change, run a force reindex once.",
  "module_name": "indexing",
  "tags": ["indexing", "performance"]
}
```

### 为什么单独有这个工具

因为 `decision` 在 IDE 记忆里通常比普通手记更重要：

- 更稳定
- 更高价值
- 更适合后续 `context_for_task` 优先召回

---

## 5. `recall`

### 什么时候用

- 你想主动问项目记忆：“之前有没有提过这个事”
- 你知道自己在查什么，但不一定在当前编辑现场
- 你需要一个通用检索入口

### 最小调用

```json
{
  "project_root": "D:/your_project",
  "query": "incremental indexing manifest checksum"
}
```

### 推荐调用

```json
{
  "project_root": "D:/your_project",
  "query": "remember decision memory workflow",
  "module_name": "src",
  "symbol": "rememberDecision",
  "top_k": 5,
  "explain": true
}
```

### 常用过滤参数

- `source_kinds`
  只查某类来源，例如只查 `decision`
- `path_contains`
  只看某个文件或路径片段
- `module_name`
  只看某个模块
- `language`
  只看某种语言
- `symbol`
  只看某个符号
- `branch_name`
  只看某个 git 分支
- `related_files`
  给相关文件加权

### 时间过滤

支持三种方式：

1. 显式给时间范围

```json
{
  "project_root": "D:/your_project",
  "query": "recent debugging notes",
  "last_days": 7
}
```

2. 给 `date_from / date_to`

3. 直接在 query 里带时间词

比如：

- `recent`
- `today`
- `yesterday`
- `last week`

### `explain` 有什么用

打开后每条结果会带 `scoreDetails`，里面能看到：

- `vector`
- `lexical`
- `sourcePriority`
- `freshness`
- `pathBoost`
- `symbolBoost`
- `branchBoost`
- `titleBoost`
- `rerank`
- `rerankModel`

如果你觉得“为什么这个结果排第一”，就开 `explain: true`。

### 最常见误区

- `recall` 是主动检索，不会自动帮你判断当前 IDE 现场
- 如果你已经在某个具体文件里工作，通常更推荐 `context_for_task`

---

## 6. `context_for_task`

### 什么时候用

这是 IDE 场景里最应该优先使用的工具。

适合：

- 你正在改某个文件
- 你在某个函数/类里工作
- IDE 里刚出现报错或测试失败
- 你想让系统结合“当前现场”给你上下文

### 最小调用

```json
{
  "project_root": "D:/your_project",
  "task": "Fix memory recall ranking"
}
```

### 推荐调用

```json
{
  "project_root": "D:/your_project",
  "task": "Fix diagnostics-aware context recall",
  "current_file": "D:/your_project/src/mindkeeper.ts",
  "current_symbol": "contextForTask",
  "selected_text": "async contextForTask(input: ContextForTaskInput)",
  "diagnostics": "TypeError in src/mindkeeper.ts: contextForTask should prefer symbol-aware recall",
  "branch_name": "feature/memory-gating",
  "related_files": [
    "D:/your_project/src/index.ts",
    "D:/your_project/src/types.ts"
  ],
  "top_k": 6
}
```

### 它和 `recall` 的最大区别

`recall` 是你主动检索。

`context_for_task` 是它基于当前编码现场做带门控的检索包，重点会放在：

- 当前文件
- 当前符号
- diagnostics 命中的文件和符号
- related files
- knowledge-layer memories are also preserved on purpose; `context_for_task` now keeps room for `manual`, `decision`, `diary`, and `imported` results so current-file project chunks do not crowd them out
- code-local hints like `current_symbol`, `branch`, and `language` mainly tighten `project` recall; they are not meant to hard-filter note-like memories under `.mindkeeper`
- inferred task stage such as `debug`, `implement`, `verify`, `refactor`, or `document`
- 手工知识和决策
- a final token-budget trim so the IDE does not receive an oversized context pack

### 返回里你该关注什么

- `query`
  系统最后实际构建出来的检索语句
- `gates`
  这次用了哪些门控
- `results`
  最终返回给 IDE 的上下文块
- `gates.taskStage / gates.budgetPolicy`
  解释这次是按什么任务阶段来分配上下文预算
- `gates.knowledgeReserve / gates.projectReserve / gates.selectedBySource`
  解释高价值记忆和源码上下文各自占了多少席位
- `gates.tokenBudget / gates.estimatedTokensUsed / gates.omittedByTokenBudget / gates.usedTokenBudgetGate`
  解释结果是否因为上下文体积过大而被 token 预算裁剪过

### 最常见误区

- diagnostics 不传也能用，但传了通常更准
- `current_symbol` 不传也能跑，但对方法级召回帮助很大

---

## 7. `summarize_session`

在真正写入之前，如果你想先判断“值不值得存”和“更像 diary 还是 decision”，可以先调用 `suggest_session_memory`。

Phase 1 distiller notes:

- `suggest_session_memory` may now return `discard`, `diary`, `decision`, or `knowledge`
- `summarize_session` may return `persisted: false` when the notes are too low-signal
- `knowledge` is stored under `.mindkeeper/knowledge` as a stable long-term note
- returned metadata now includes `recommendedTier`, `stabilityScore`, and `discardReason`

最小调用：

```json
{
  "project_root": "D:/your_project",
  "session_text": "We decided to keep branch_name as a ranking perspective instead of a hard filter. Need to document the new behavior."
}
```

你会拿到：

- `shouldPersist`
- `recommendedKind`
- `confidence`
- `suggestedTitle`
- `reasons`
- `alternatives`

这一步适合 IDE 在“任务结束”或“切换上下文”时给出沉淀建议，而不是直接写库。

### 什么时候用

- 一次开发阶段结束后
- 一次调试、修复、重构完成后
- 你想把原始工作记录沉淀成长期记忆

### 最小调用

```json
{
  "project_root": "D:/your_project",
  "title": "Session on recall gating",
  "session_text": "Added diagnostics file hints. Improved symbol-aware reranking."
}
```

### 推荐调用

```json
{
  "project_root": "D:/your_project",
  "title": "Session on recall gating",
  "session_text": "Implemented symbol boost. Added diagnostics file hints. Need to benchmark reranking later.",
  "kind": "diary",
  "module_name": "retrieval",
  "tags": ["session", "retrieval"]
}
```

### `kind` 怎么选

- `diary`
  更偏过程记录
- `decision`
  更偏结论和规范

如果不传，系统会按内容推断。

---

## 8. `forget`

### 什么时候用

- 记忆写错了
- 有污染记忆
- 某条笔记已经不该保留

### 按路径删除

```json
{
  "project_root": "D:/your_project",
  "path": "D:/your_project/.mindkeeper/knowledge/temp-note.md"
}
```

### 按 `doc_id` 删除

```json
{
  "project_root": "D:/your_project",
  "doc_id": "manual:xxxxxxxx"
}
```

### 它会删什么

- 底层记忆文件
- 对应 chunk 索引
- 对应 manifest

---

### Prefer `disable_source` before `forget` when you are unsure

If a memory looks noisy but you are not ready to delete the underlying file, use `disable_source` first:

```json
{
  "project_root": "D:/your_project",
  "path": "D:/your_project/.mindkeeper/knowledge/temp-note.md",
  "reason": "Temporary noisy memory during retrieval tuning."
}
```

If you later decide the memory should participate in recall again, use `enable_source` with the same `path` or the returned `doc_id`.

If you do not want to disable a source outright, use `rate_source` to record `helpful` or `noisy` feedback. This feeds a lighter ranking signal than full disablement.

The current ranking behavior is intentionally time-aware:

- recent `helpful` feedback is stronger than old `helpful` feedback
- stale sources with repeated `noisy` feedback are pushed down more aggressively than recent noisy ones
- branch-aware ranking also treats `branch_name` as a branch perspective: exact branch first, sibling branch next, cross-branch results still visible but penalized

---

## 9. `list_sources`

### 什么时候用

- 你想看看当前项目到底记住了什么
- 你想定位某条笔记的 `doc_id`
- 你准备配合 `forget` 使用

### 最小调用

```json
{
  "project_root": "D:/your_project"
}
```

### 返回内容

- `docId`
- `path`
- `relativePath`
- `sourceKind`
- `title`
- `chunkCount`
- `updatedAt`
- `isDisabled`
- `disabledAt`
- `disabledReason`
- `helpfulVotes`
- `noisyVotes`
- `lastFeedbackAt`

## 10. `list_branch_views`

### 什么时候用

- 你想看当前项目的记忆主要分布在哪些分支
- 你想确认某个 feature 分支是否已经积累了独立记忆
- 你想给 IDE 做一个 branch-scoped memory 面板

### 最小调用

```json
{
  "project_root": "D:/your_project"
}
```

### 返回内容

- `branchName`
- `docCount`
- `chunkCount`
- `disabledCount`
- `lastUpdatedAt`
- `sourceCounts`

### 最常见用途

- 找一条错误记忆的路径
- 确认某条手记是否已经进库
- 观察项目索引里有哪些来源

---

## 10. 一套最实用的工具工作流

如果你不想记太多工具名，最实用的一套流程是：

1. 新项目先 `bootstrap_project`
2. 立刻 `index_project`
3. 确认性结论用 `remember_decision`
4. 普通知识用 `remember`
5. 日常编码现场优先 `context_for_task`
6. 主动查历史时用 `recall`
7. 阶段结束先看 `suggest_session_memory`，再决定是否用 `summarize_session`
8. 记忆变脏时用 `forget`

---

## 11. 非 MCP 的质量命令

这些不是 MCP tools，但在开发和维护时很重要：

- `npm run check`
- `npm test`
- `npm run bench`
- `npm run bench:save`

其中：

- `npm test` 运行回归测试
- `npm run bench` 输出一次 benchmark
- `npm run bench:save` 把 benchmark 保存到 `.mindkeeper/manifests/benchmark-latest.json`

---

## 12. 常见问题

### 我只想“让它先能用”，最少要调用哪些工具

最少就是：

1. `bootstrap_project`
2. `index_project`
3. `context_for_task`

### 为什么我写了 `config.toml`，但效果没变化

可能原因：

- 你改的是 embedding profile，但没有重建索引
- 你改的是 reranker profile，但当前没有对应 API Key
- 你改了 include/exclude，但没有重新跑 `index_project`

### 为什么 `remember` 和 `remember_decision` 都存在

因为两者语义不同：

- `remember` 更像“值得存的知识”
- `remember_decision` 更像“正式结论”

在检索里，正式决策通常更值得被优先召回。

### 为什么 `context_for_task` 比 `recall` 更适合 IDE

因为它会把：

- 当前文件
- 当前符号
- diagnostics
- related files

一起拿来做门控和重排，而不是只靠 query 文本。

---

## 13. 进一步阅读

- 总体上手说明：[README.md](/D:/projects/mind_keeper/README.md)
- 架构说明：[docs/ARCHITECTURE.md](/D:/projects/mind_keeper/docs/ARCHITECTURE.md)
- 质量说明：[docs/QUALITY.md](/D:/projects/mind_keeper/docs/QUALITY.md)
