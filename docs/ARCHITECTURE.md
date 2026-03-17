# Mind Keeper 设计说明

这份文档面向两类人：

- 想快速理解 `Mind Keeper` 为什么这样设计的人
- 后续要继续开发、扩展、维护这个项目的人

如果你只是第一次使用，优先看 [README.md](/D:/projects/mind_keeper/README.md)。
如果你想知道每个 MCP 工具怎么用，优先看 [docs/MCP_TOOLS.md](/D:/projects/mind_keeper/docs/MCP_TOOLS.md)。

---

## 1. 产品定位

`Mind Keeper` 是一个服务于 IDE 的项目级记忆 MCP。

它不是“又一个向量库插件”，也不是“把聊天记录塞进 RAG”的工具。它更接近一个按项目分区的记忆层，目标是让 IDE 在开发现场具备：

- 长期记忆
- 主动检索
- 被动但克制的上下文补全
- 稳定的项目隔离

它借鉴的是 VCP 的记忆方法论，而不是 VCP 的 UI 或日记语法。

---

## 2. 设计原则

整个系统围绕四条核心原则展开：

### 2.1 主动检索优先

优先让调用方显式问“我要找什么”，而不是默认把所有记忆塞进 prompt。

这就是为什么：

- `recall` 是一级能力
- `context_for_task` 也是建立在检索之上的门控能力
- 系统没有做“全时无差别记忆注入”

### 2.2 被动注入要克制

IDE 场景里的上下文非常贵。

如果系统只因为“查到了一些相似文本”就把它们全塞进去，很容易造成：

- prompt 污染
- 当前任务偏航
- 结果变慢
- 用户对系统失去信任

所以 `Mind Keeper` 的方向一直是“门控后注入”，而不是“召回即注入”。

### 2.3 门控先于召回规模

不是召回越多越好，而是“召回对不对”更重要。

当前系统已经引入的门控包括：

- 当前文件门控
- 当前符号门控
- diagnostics 文件门控
- related files 门控
- source priority 门控
- score threshold 门控
- budget 门控

### 2.4 项目隔离是底线

记忆默认按项目根目录隔离，不做跨项目共享池。

这是为了避免：

- 不同仓库之间的知识串味
- 老项目约定污染新项目
- 一个项目的报错和另一个项目的代码混在一起

---

## 3. 记忆模型

`Mind Keeper` 把记忆分成几层，每层含义不同、优先级也不同。

### 3.1 `manual`

用户主动整理并确认过的知识。

典型内容：

- 约定
- 命名规范
- 流程说明
- 外部资料摘要

目录位置：

- `.mindkeeper/knowledge`

### 3.2 `decision`

明确的架构决策、规范和结论。

典型内容：

- 为什么选某个方案
- 哪个策略已经被确认
- 哪些规则必须遵守

目录位置：

- `.mindkeeper/decisions`

### 3.3 `diary`

开发过程记录和工作日记。

典型内容：

- 某次修复过程
- 某阶段开发总结
- 某轮调试留下的线索

目录位置：

- `.mindkeeper/diary`

### 3.4 `project`

项目源码、文档、配置的原地索引结果。

注意：

- 它不是用户手写记忆
- 它来自项目原文件
- 它只存索引产物，不复制整个项目

### 3.5 `imported`

手动导入的项目外资料。

典型内容：

- 外部说明文档
- 手工导入的参考材料

目录位置：

- `.mindkeeper/imports`

---

## 4. 目录设计

每个项目根目录下有一个 `.mindkeeper`：

```text
.mindkeeper/
  config.toml
  knowledge/
  diary/
  decisions/
  imports/
  manifests/
  vector/
  cache/
```

### 4.1 为什么这样分

- `knowledge / diary / decisions / imports`
  对应不同来源和语义层
- `vector`
  存索引产物
- `manifests`
  存索引摘要、benchmark 报告
- `cache`
  存解析中间物

### 4.2 为什么 `vector` 不放项目副本

因为复制整个项目会带来三个问题：

1. 体积变大
2. 更新难做增量
3. 命中后不容易回跳原文件

所以 `Mind Keeper` 只保存：

- chunk
- embedding
- metadata
- manifest

项目文件本体仍然留在原始路径。

---

## 5. 数据流

从写入到召回，大致经过下面这条链路：

```text
用户内容 / 项目文件
  -> chunk
  -> embedding
  -> metadata enrich
  -> SQLite 存储
  -> recall / context_for_task
  -> rerank
  -> gated result
```

### 5.1 写入路径

写入分两类：

1. 手动写入
   通过 `remember / remember_decision / summarize_session`
2. 项目索引
   通过 `index_project`

从当前版本开始，IDE 还可以在真正写入前先走一层“沉淀建议”：

- 先用 `suggest_session_memory` 判断这段会话值不值得保存
- 再决定是否调用 `summarize_session`
- 这样可以减少把低价值流水账直接写进 `.mindkeeper/diary`

Phase 1 distiller adds one more layer:

- session notes can now be classified as `discard / diary / decision / knowledge`
- `knowledge` is treated as stable project memory even though it lives under the manual knowledge partition
- persisted memories now carry `memoryTier` and `stabilityScore`
- recall can use those fields to favor stable knowledge over transient worklog notes

### 5.2 元数据增强

在进入存储前，系统会尽量补充：

- `sourceKind`
- `moduleName`
- `language`
- `symbol`
- `branchName`
- `checksum`
- `updatedAt`

### 5.3 召回路径

召回时先从 SQLite 里拉候选，再走评分和重排。

---

## 6. 存储设计

当前存储核心是本地 SQLite。

这样选的原因是：

- 本地项目使用足够轻量
- 没有额外服务依赖
- 适合 IDE 本地工作流
- 调试和迁移相对简单

当前主要存两类数据：

### 6.1 chunk 数据

每个 chunk 会记录：

- 文档归属
- 来源类型
- 路径
- chunk 序号
- 内容
- tags
- module / language / symbol / branch
- embedding
- checksum
- updatedAt

### 6.2 file manifest

每个被索引文件会记录：

- 路径
- 相对路径
- checksum
- mtime
- size
- embedding profile

它的作用是做增量索引判断。

---

## 7. 索引策略

### 7.1 项目文件如何进入索引

由 `config.toml` 里的：

- `includeGlobs`
- `excludeGlobs`
- `maxFileBytes`

共同决定。

默认会索引：

- 代码文件
- Markdown / 文本
- 配置文件
- SQL / shell / PowerShell

默认会排除：

- `.mindkeeper`
- `node_modules`
- 构建输出
- 二进制资源
- 锁文件

### 7.2 增量索引规则

当前规则是：

- manifest 不存在 -> 建新索引
- `mtime / size / profile` 都一致 -> 跳过
- `mtime` 变了但 `checksum` 没变 -> 只刷新 manifest
- 文件已删除 -> 清理 chunk 和 manifest

### 7.3 强制重建

在这些场景应该跑 `force: true`：

- embedding profile 变化
- 向量维度变化
- 符号提取逻辑变化
- include / exclude 规则变化

---

## 8. 符号提取设计

符号提取是 `Mind Keeper` 这版里最重要的 IDE 能力之一。

### 8.1 为什么要做符号级信息

因为 IDE 场景里“我正在编辑哪个函数/类”通常比“我输入了什么 query”更重要。

如果没有 symbol：

- 文件内不同职责的 chunk 很难区分
- 方法级召回不稳定
- diagnostics 和选中代码很难精确挂钩

### 8.2 当前策略

优先用 parser-backed adapter，失败再回退正则。

当前已支持：

- TypeScript / JavaScript
- Python
- Go
- Rust
- Java

### 8.3 为什么不是所有语言都上重型 parser

因为本项目优先考虑：

- 本地可用性
- 依赖可控
- 开发复杂度

所以策略是渐进式扩展，而不是一开始就把所有语言都做成完整 LSP 级解析。

---

## 9. 检索与评分

`Mind Keeper` 当前不是单一向量检索，而是混合检索。

### 9.1 第一阶段：候选召回

候选会综合：

- 向量相似
- 词面重合
- 来源优先级
- 时间新鲜度
- 路径命中
- 符号命中
- 分支命中
- 标题重合

### 9.2 第二阶段：本地 heuristic rerank

会对前排候选做轻量重排。

主要看：

- query coverage
- exact phrase
- tag overlap
- module overlap
- title overlap

### 9.3 第三阶段：可选模型重排

如果当前启用了外部 reranker profile，就会对头部窗口做一层 model rerank。

如果失败：

- 自动回退
- 不影响基础召回可用性

### 9.4 为什么要保留 `explain`

因为 IDE 场景里用户很容易问：

- 为什么这条排第一
- 为什么这条没出来
- 为什么某个符号没命中

`scoreDetails` 就是给这类问题准备的。

---

## 10. `context_for_task` 的设计

这是整套系统里最接近“IDE 记忆现场”的能力。

它不是简单地把 task 传给 `recall`，而是会综合：

- `task`
- `currentFile`
- `currentSymbol`
- `selectedText`
- `diagnostics`
- `branchName`
- `relatedFiles`

这里有一个刻意设计的约束：

- `context_for_task` 不直接把这些 IDE 线索当成所有记忆层的硬过滤条件
- 对 `project` 源，它会更积极地使用 `currentFile / currentSymbol / branch / relatedFiles` 来压缩候选
- 对 `manual / decision / diary / imported` 这类知识层，它更偏向“软约束 + 结果保留席位”，避免把正确的项目结论误挡在候选集外

然后构造带门控的查询和重排链路。

在当前版本里，这条链路的最后还有一层“体积门控”：

- 先按相关性、来源平衡、任务阶段挑出候选
- 再按估算 token 做一次收口
- 默认尽量至少保留一个最高优先级 chunk，避免因为预算过紧而返回空结果

除此之外，系统现在还有一层轻量“反馈门控”：

- 被 `disable_source` 的来源会直接退出召回候选
- 被 `rate_source(noisy)` 标记过的来源会逐步降权
- 被 `rate_source(helpful)` 标记过的来源会得到轻量加权
- 这层反馈不会像 disable 一样一刀切，更适合处理“不是错，但有点吵”的记忆
- 反馈本身也会衰减，近期反馈比很久以前的反馈更有影响
- 对“内容本身已经很旧，且仍持续收到 noisy 信号”的来源，会额外加速降权
- 分支视角不是硬过滤：exact branch > sibling branch > cross-branch penalty

### 10.1 为什么单独做这个工具

因为 IDE 场景里用户通常不是在“搜资料”，而是在“修当前这段代码”。

这时真正有价值的是：

- 当前文件附近的决策
- 当前符号相关的历史
- diagnostics 命中的模块
- 手工知识里和当前问题相关的结论

### 10.2 当前门控

当前已经有：

- `usedFileGate`
- `usedSymbolGate`
- `usedBranchGate`
- `usedDiagnosticsGate`
- `usedRelatedFileGate`
- `usedModuleGate`
- `budget`
- `taskStage`
- `budgetPolicy`
- `knowledgeReserve / projectReserve / selectedBySource`
- `tokenBudget / estimatedTokensUsed / omittedByTokenBudget`

### 10.3 当前还没有做的

还没有完整实现的包括：

- token budget aware 注入
- 多轮对话级别的阶段门控
- 用户反馈驱动的噪声降权
- 更细的 branch-aware memory views

---

## 11. 模型策略

系统把 embedding 和 reranker 分开看待。

### 11.1 Embedding profile

当前支持：

- `hash-local`
- `qwen3-8b`
- `embedding-001`
- `embedding-cheap`

设计原则：

- profile 可切换
- 单项目同一时刻只用一个 active profile
- 向量维度改变时必须重建索引
- 必须保留离线可用的本地模式

### 11.2 Reranker profile

当前支持：

- `heuristic-local`
- `openai-rerank`
- `cheap-rerank`

设计原则：

- 默认必须离线可用
- 外部 reranker 失败不能拖垮召回
- 只对头部窗口做 model rerank，控制延迟

---

## 12. 质量保障

当前已经有一套轻量质量护栏：

- `npm run check`
- `npm test`
- `npm run bench`
- `npm run bench:save`

### 12.1 测试覆盖

当前测试覆盖：

- 多语言 parser-backed symbol extraction
- symbol-targeted recall

### 12.2 benchmark 覆盖

当前 benchmark 覆盖：

- 各语言符号提取耗时
- 小型临时项目的 `index + recall` 耗时

更多细节见：

- [docs/QUALITY.md](/D:/projects/mind_keeper/docs/QUALITY.md)

---

## 13. 当前边界

这版系统已经足够支撑：

- 本地项目记忆
- 手动知识沉淀
- 项目级增量索引
- IDE 现场上下文召回
- 多语言基础符号感知

但它还不是：

- 全功能代码知识图谱
- 跨项目共享记忆中台
- 完整 LSP 替代品
- 全自动长期代理记忆系统

这条边界是刻意保留的，因为当前目标是“先把 IDE 现场记忆做好”。

---

## 14. 后续演进方向

从投入产出比来看，后续最值得继续的方向是：

1. `csharp / kotlin` 这类语言继续补 parser-backed adapter
2. benchmark 历史对比，不只保存 latest
3. 更强的 task-context 回归测试
4. 更细的 passive injection gate
5. 分支感知和时间感知进一步增强

如果只选一个最务实的下一步，我会优先做：

**benchmark 历史对比 + task-context 回归测试。**
