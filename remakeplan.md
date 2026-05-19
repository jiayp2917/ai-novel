## 总提示词

```text
你是资深全栈架构工程师，请从零搭建一个“个人小说创作与批注驱动修文系统”。

不要依赖任何现有项目代码。目标是构建一个本地 Web 应用，支持打开小说、章节阅读、文本批注、根据批注调用大模型生成修订候选、展示 diff、人工批准后写回源文件，并逐步扩展为设定/章纲/正文生成、审核、修复、复审、短记忆维护的低成本流水线。

核心要求：
1. 高效：前台响应快，长任务异步执行，任务状态实时返回。
2. 低成本：禁止每次塞全书；必须有 context builder、token budget、hash 缓存、低成本模式。
3. 可并发：大模型调用支持并发，但必须有并发上限、同章节任务互斥、同源文件发布串行、失败重试和速率限制。
4. 低幻觉：reviewer 审核必须输出结构化 JSON，每条问题必须有 evidence；无证据问题转 manual_required。
5. 低遗忘：必须实现短记忆系统，包括 core_facts、chapter_cards、chapter_summaries、structured_state、annotation_insights。
6. 安全写回：任何正文/设定/章纲写回必须经过 publish gate，校验源文件 hash、候选文件 hash、人工批准、备份、diff。
7. 个人本地使用，不做多人权限、云部署、复杂微服务。
8. Markdown 文件是内容源，SQLite 是索引、状态和审计账本，不要把全文只存数据库。

技术路线：
- 前端：React + TypeScript + Vite + CodeMirror 6 + TanStack Query + Zustand。
- 后端：FastAPI + Pydantic v2 + SQLAlchemy 2 + SQLite + Alembic。
- 大模型：OpenAI-compatible adapter，支持国内模型供应商，通过 model_registry.yaml 配置。
- 任务系统：SQLite job queue + 后台 worker，不使用 Kafka/Temporal/Celery。
- 存储：content/ 保存 Markdown 源文件，runtime/ 保存 app.db、artifacts、logs、backups、diffs。

请按阶段实现。每个阶段完成后运行测试，不要一次性堆完整系统。
```

## 阶段 1：项目骨架

```text
请创建项目骨架。

目录：
- backend/
- frontend/
- content/settings/
- content/outlines/
- content/chapters/
- runtime/artifacts/
- runtime/backups/
- runtime/diffs/
- runtime/logs/
- config/

后端：
1. FastAPI。
2. /health API。
3. 配置加载模块，读取 .env。

前端：
1. React + TypeScript + Vite。
2. 首页显示后端 health 状态。

配置：
增加 .env.example：
- APP_DB_PATH
- CONTENT_ROOT
- RUNTIME_ROOT
- LOW_COST_MODE
- ENABLE_MODEL_CONCURRENCY
- MODEL_MAX_CONCURRENCY
- MODEL_TIMEOUT_SECONDS
- DAILY_MAX_MODEL_CALLS
- DAILY_MAX_ESTIMATED_COST
- MAX_INPUT_CHARS_PER_CALL
- MAX_OUTPUT_TOKENS_PER_CALL
- DEFAULT_MODEL_PROVIDER

增加 README.md，说明本地启动方式。

先保证项目能启动，不实现复杂业务。
```

## 阶段 2：数据库与版本模型

```text
请实现 SQLite 数据模型、Alembic 迁移和基础 repository/service 层。

必须包含表：

1. source_files
- id
- path
- kind: settings/outlines/chapters
- sha256
- mtime
- size
- active

2. chapters
- id
- chapter_no
- title
- source_file_id
- current_version_id
- range_start
- range_end

3. chapter_versions
- id
- chapter_id
- source_file_id
- body_hash
- source_file_hash
- title
- text_snapshot_path，可为空
- range_start
- range_end
- created_at

4. annotations
- id
- chapter_id
- chapter_version_id
- source_file_id
- source_file_hash_at_create
- chapter_body_hash_at_create
- range_start
- range_end
- quote_text
- quote_hash
- prefix_text
- suffix_text
- type
- severity
- comment
- example_rewrite
- status: open/resolved/needs_relocate/learned/ignored
- created_at
- updated_at

5. annotation_insights
- id
- kind: style_preference/negative_pattern/logic_rule/consistency_rule/rewrite_example
- content
- source_annotation_ids_json
- enabled
- confidence
- created_at

6. memory_items
- id
- kind: core_fact/chapter_card/chapter_summary/structured_state
- scope
- content_json
- source_hash
- updated_at

7. jobs
- id
- type
- status: queued/running/succeeded/failed/manual_required/paused_budget
- payload_json
- result_json
- error
- locked_chapter_id
- locked_source_file_id
- created_at
- updated_at

8. artifacts
- id
- kind: candidate/review/diff/context_report/proposal
- path
- sha256
- base_source_file_id
- base_source_file_hash
- base_chapter_id
- base_chapter_version_id
- metadata_json
- created_at

9. reviews
- id
- artifact_id
- passed
- issues_json
- evidence_count
- manual_required
- created_at

10. publish_decisions
- id
- artifact_id
- approved_by_user
- force
- force_reason
- source_hash_before
- candidate_hash
- diff_path
- backup_path
- published_at

11. model_calls
- id
- role
- provider
- model
- prompt_hash
- input_chars
- output_chars
- usage_json
- cost_estimate
- cache_hit
- status
- error
- created_at

12. events
- id
- event_type
- entity_type
- entity_id
- payload_json
- created_at

要求：
- 使用 SQLAlchemy 2。
- 使用 Pydantic schema。
- 增加基础 CRUD 测试。
```

## 阶段 3：源文件扫描与设定/章纲/正文索引

```text
请实现内容扫描。

扫描目录：
- content/settings/
- content/outlines/
- content/chapters/

功能：
1. 扫描 settings 和 outlines 下的 Markdown 文件，记录到 source_files。
2. 扫描 chapters 下的 Markdown 文件，识别章节。
3. 支持标题：
   - # 第001章 标题
   - # 第1章 标题
4. 每次章节内容变化时：
   - 更新 source_files.sha256
   - 新增 chapter_versions
   - 更新 chapters.current_version_id
5. 扫描后检测批注：
   - 如果 annotation.chapter_body_hash_at_create 与当前 chapter version body_hash 不一致，尝试重定位。
   - 重定位优先用 quote_text 精确匹配。
   - 若唯一匹配，更新 range_start/range_end，状态保持 open。
   - 若找不到或多处匹配，标记 needs_relocate。
6. 不写回源文件。

API：
- POST /api/library/scan
- GET /api/source-files
- GET /api/chapters
- GET /api/chapters/{id}

测试：
- settings/outlines/chapters 扫描。
- 章节变化生成新 version。
- 批注失效后 needs_relocate。
```

## 阶段 4：短记忆系统

```text
请在 Context Builder 前实现短记忆系统。

记忆类型：

1. core_facts
- 来源：settings、稳定世界观、主角设定、不可变规则。
- 结构：[{fact, source_file_id, confidence, updated_at}]

2. chapter_cards
- 来源：outlines。
- 结构：{chapter_no, goal, key_events, characters, constraints, source_file_id}

3. chapter_summaries
- 来源：已发布正文。
- 结构：{chapter_no, summary, character_state_delta, plot_state_delta, unresolved_hooks}

4. structured_state
- 来源：chapter_summaries 聚合。
- 结构：{characters, timeline, locations, power_system, unresolved_clues}

5. annotation_insights
- 来源：用户批注和最终批准稿。
- 阶段 8 深化，此阶段只读取已存在数据。

API：
- POST /api/memory/rebuild
- GET /api/memory
- GET /api/memory/context-preview?chapter_id=...

生成时机：
1. library scan 后可手动 rebuild。
2. publish 成功后自动更新 chapter_summary 和 structured_state。
3. settings/outlines 文件 hash 变化后，core_facts/chapter_cards 标记 stale，等待 rebuild。

要求：
- 初版允许使用规则抽取，不强制调用大模型。
- 保存到 memory_items。
- 增加测试。
```

## 阶段 5：批注 API 与重定位工具

```text
请实现批注 API。

API：
- POST /api/chapters/{id}/annotations
- GET /api/chapters/{id}/annotations
- PATCH /api/annotations/{id}
- DELETE /api/annotations/{id}
- POST /api/annotations/{id}/relocate

创建批注时必须保存：
- 当前 chapter_version_id
- source_file_hash_at_create
- chapter_body_hash_at_create
- range_start/range_end
- quote_text
- quote_hash
- prefix_text/suffix_text

重定位逻辑：
1. 优先用 quote_text 在当前章节中查找。
2. 唯一匹配则更新 range。
3. 多处匹配则结合 prefix/suffix 辅助判断。
4. 仍失败则 status=needs_relocate。
5. UI 后续允许用户手动重定位。

测试：
- 批注创建。
- 章节修改后自动 needs_relocate。
- quote_text 唯一匹配后自动重定位。
```

## 阶段 6：前台工作台

```text
请实现前台基础工作台。

布局：
1. 左侧：小说目录树，显示 settings/outlines/chapters。
2. 中间：章节阅读/编辑区，使用 CodeMirror 6。
3. 右侧：批注侧栏。
4. 底部：任务状态面板。

功能：
1. 点击章节打开正文。
2. 选中文本后新增批注。
3. 批注类型：
   - 风格
   - 逻辑
   - 一致性
   - AI味
   - 节奏
   - 人设
   - 设定冲突
   - 章纲偏离
   - 错字病句
   - 示例句
   - 人工决策
4. 批注高亮。
5. 点击批注定位正文。
6. needs_relocate 批注在 UI 明确标红，并提供手动重定位入口。
7. 前端状态使用 Zustand。
8. API 请求使用 TanStack Query。

要求：
- 工作台风格，不做营销页。
- 不做复杂富文本，正文仍是 Markdown。
```

## 阶段 7：大模型接入、探测与成本控制基础

```text
请实现大模型接入层。

配置：
config/model_registry.yaml

支持字段：
- provider
- model
- base_url
- api_key_env
- roles
- default_max_tokens
- cheap
- supports_json
- enabled

角色：
- writer
- reviewer
- fixer
- outliner
- structural_fix
- memory
- arbiter

要求：
1. 使用 OpenAI-compatible chat completions。
2. model_router 根据 role 选择模型。
3. LOW_COST_MODE 下优先 cheap 模型并降低 max_tokens。
4. 增加 prompt_hash 缓存：同 role + model + prompt_hash 不重复调用，除非 force=true。
5. 记录 model_calls。
6. 支持超时、重试、退避。
7. 支持 provider semaphore 并发控制。
8. 不把 API Key 写进代码。

模型探测：
提供两个入口：
- CLI: python -m backend.tools.probe_model --role reviewer
- API: POST /api/admin/probe-model

探测内容：
- JSON 输出稳定性。
- 简短中文改写能力。
- 最大输出测试。
- 是否返回 usage。

成本统计：
- 优先使用模型返回的 usage 字段。
- 没有 usage 时才用字符数估算。
```

## 阶段 8：Context Builder 与批注驱动修文

```text
请实现 Context Builder 和“按批注修文”任务。

Context Builder 输入：
- chapter_id
- annotation_ids
- task_type

只允许加载：
1. 当前章节正文。
2. 指定批注。
3. 当前章节相关 chapter_card。
4. core_facts。
5. structured_state 摘要。
6. 已启用 annotation_insights。
7. 必要的 settings/outlines 片段。

必须有 token/字符预算：
- 用户批注最高优先级。
- 当前章节正文其次。
- 相关章纲其次。
- core_facts/structured_state 再次。
- annotation_insights 最后。
- 超预算必须裁剪并生成 context_report artifact。

API：
POST /api/chapters/{id}/revise-from-annotations

流程：
1. 创建 job。
2. 检查同 chapter_id 是否已有 running 修改任务，有则拒绝或排队。
3. 构建 context。
4. 调用 writer/fixer 生成候选正文。
5. 保存 candidate artifact。
6. artifact.sha256 必须等于候选文件实际内容 hash。
7. artifact.metadata_json 记录 context_report、base_chapter_version_id、model、prompt_hash。
8. 不写回源文件。

候选要求：
- 完整保留当前章节标题。
- 只处理当前章节。
- 不生成解释文本。
```

## 阶段 9：审核、diff 与 Publish Gate

```text
请实现审核、diff 和安全发布。

审核 API：
POST /api/artifacts/{id}/review

reviewer 必须输出 JSON：
{
  "passed": true,
  "overall": "...",
  "issues": [
    {
      "chapter": 1,
      "severity": "blocking/high/medium/low",
      "type": "...",
      "description": "...",
      "evidence": "...",
      "owner": "writer/outliner/state/admin",
      "fix_instruction": "..."
    }
  ]
}

规则：
1. 无 evidence 的 issue 必须转 manual_required。
2. JSON 解析失败保存 raw artifact，并将 job 标记 manual_required。
3. 审核失败不写回。

Diff API：
- GET /api/artifacts/{id}/diff

Publish API：
POST /api/artifacts/{id}/publish
参数：
- approved_by_user: true
- force: false
- force_reason: 可选

Publish Gate 必须校验：
1. artifact 存在。
2. artifact.sha256 必须与 artifact 实际文件内容 hash 一致。
3. artifact.base_source_file_hash 必须等于当前源文件 hash，防止源文件被外部修改。
4. 用户 approved_by_user=true。
5. review passed=true；若不通过，只有 force=true 且 force_reason 非空才允许。
6. 同一 source_file 发布必须串行。
7. 发布前生成 backup。
8. 发布前生成 diff。
9. 写回后重新扫描该源文件，生成新 chapter_version。
10. 记录 publish_decision 和 event。

注意：
不要把 candidate_hash 与当前源文件 hash 比较。candidate_hash 只用于校验候选 artifact 文件未被篡改。
```

## 阶段 10：Annotation Learner

```text
请实现 annotation learner。

目标：
从用户批注、示例改写、最终批准稿中提炼短规则，用于后续写作，不把所有批注原文塞进 prompt。

API：
- POST /api/annotations/learn
- GET /api/annotation-insights
- PATCH /api/annotation-insights/{id}

输入：
- resolved 批注
- 示例句
- 原文/候选/最终稿 diff
- publish_decision

输出 annotation_insights：
- style_preference
- negative_pattern
- logic_rule
- consistency_rule
- rewrite_example

要求：
1. 每条 insight 必须短、可复用。
2. 必须记录来源 annotation_id。
3. 前台可查看、启用、禁用、编辑。
4. Context Builder 只加载 enabled insight。
5. LOW_COST_MODE 下优先规则归纳，复杂批注才调用 memory 模型。
```

## 阶段 11：并发与预算守卫

```text
请增强并发和成本控制。

后台 worker：
1. 支持并发执行模型任务。
2. 配置：
   - MODEL_MAX_CONCURRENCY
   - WRITER_MAX_CONCURRENCY
   - REVIEWER_MAX_CONCURRENCY
   - PROVIDER_MAX_CONCURRENCY
3. 同 chapter_id 的生成/修复任务互斥。
4. 同 source_file 的 publish 互斥。
5. writer 可较高并发。
6. reviewer 默认低并发。
7. publish 永远串行到 source_file 级别。

预算守卫：
- DAILY_MAX_MODEL_CALLS
- DAILY_MAX_ESTIMATED_COST
- MAX_INPUT_CHARS_PER_CALL
- MAX_OUTPUT_TOKENS_PER_CALL

规则：
1. 超预算任务进入 paused_budget。
2. 前台显示暂停原因。
3. 用户可手动恢复。
4. 成本统计优先使用模型 usage 字段，没有 usage 才估算。

前台增加 cost dashboard：
- 今日调用次数
- input/output 字符数
- usage token
- 估算成本
- cache 命中次数
- 并发中任务数
```

## 阶段 12：设定/章纲生成与结构修复

```text
请实现设定/章纲维护的轻量闭环。

功能：
1. 前台可以打开 settings/outlines Markdown。
2. 可以对设定/章纲添加批注。
3. 可以生成设定/章纲候选提案 artifact。
4. 可以审核设定/章纲候选。
5. 默认不自动覆盖源文件。
6. 覆盖也必须走 publish gate。

API：
- GET /api/source-files/{id}
- POST /api/source-files/{id}/annotations
- POST /api/source-files/{id}/generate-proposal
- POST /api/artifacts/{id}/review
- POST /api/artifacts/{id}/publish

模型角色：
- outliner：生成设定/章纲候选。
- structural_fix：根据审核问题生成结构修复提案。
- arbiter：冲突裁决。

要求：
- 设定/章纲候选必须生成 diff。
- 人工批准后才写回。
```

## 阶段 13：验收测试

```text
请补齐测试和验收。

必须通过：

后端：
1. 数据库迁移测试。
2. source scan 测试。
3. chapter_versions 测试。
4. annotation relocation 测试。
5. memory rebuild 测试。
6. context budget 测试。
7. artifact hash 测试。
8. publish gate 拒绝条件测试。
9. model cache 测试。
10. budget guard 测试。

前端：
1. 构建通过。
2. 打开章节。
3. 创建批注。
4. needs_relocate 显示。
5. diff 展示。
6. publish 操作状态反馈。

端到端手工流程：
1. 扫描章节。
2. 打开章节。
3. 添加批注。
4. 按批注生成候选。
5. 审核候选。
6. 查看 diff。
7. 人工批准。
8. 写回。
9. 生成备份。
10. 记录事件。
11. 更新 chapter_summary 和 structured_state。

并发测试：
1. 同时生成多个章节候选。
2. 同章节重复任务被拒绝或排队。
3. 同源文件发布串行。

安全测试：
1. 源文件 hash 变化时拒绝发布。
2. artifact 文件被篡改时拒绝发布。
3. 无人工批准拒绝发布。
4. 审核未通过且无 force 拒绝发布。
5. force=true 必须记录 force_reason。
```
几个不影响交付但可留意的细节
下面这些点都不是错误，但未来如果遇到边界情况，可以快速定位。

设定/章纲文件的版本追踪

当前 source_files 表没有像 chapter_versions 那样的版本机制。阶段12中设定/章纲的修订也走 artifacts + publish gate，写回后通过 source_file.sha256 变化来感知。这对个人使用足够，但如果想对设定/章纲批注也做自动重定位，后续可能需要扩展。

影响：极低。Codex 按现有设计实现，设定/章纲的批注在文件修改后可能直接失效，但不会崩溃。

短记忆重建的执行方式

阶段4 POST /api/memory/rebuild 未明确是同步还是异步。初期章节少时同步可行，若章节多可能阻塞。

建议：未来若需优化，可改成创建 job 异步执行，当前提示词不必修改。

Context Builder 中 settings/outlines 片段的检索

阶段8只说加载“必要的 settings/outlines 片段”，但未提供检索方法。Codex 很可能实现为简单的关键词搜索或最近匹配，这在本地场景够用。

注意：如果将来需要精准引用，可能需要借助 RAG 或全文索引，但提示词现在这样写完全合理。

成本估算与 usage 的降级策略

已明确“优先使用 usage，没有才估算”。有一点可留意：某些国内模型虽然返回 usage，但 total_tokens 可能为 0 或与实际不符，届时成本统计会不准。这是模型适配层的细节，不属于提示词问题。


几个不影响交付但可留意的细节
下面这些点都不是错误，但未来如果遇到边界情况，可以快速定位。

设定/章纲文件的版本追踪

当前 source_files 表没有像 chapter_versions 那样的版本机制。阶段12中设定/章纲的修订也走 artifacts + publish gate，写回后通过 source_file.sha256 变化来感知。这对个人使用足够，但如果想对设定/章纲批注也做自动重定位，后续可能需要扩展。

影响：极低。Codex 按现有设计实现，设定/章纲的批注在文件修改后可能直接失效，但不会崩溃。

短记忆重建的执行方式

阶段4 POST /api/memory/rebuild 未明确是同步还是异步。初期章节少时同步可行，若章节多可能阻塞。

建议：未来若需优化，可改成创建 job 异步执行，当前提示词不必修改。

Context Builder 中 settings/outlines 片段的检索

阶段8只说加载“必要的 settings/outlines 片段”，但未提供检索方法。Codex 很可能实现为简单的关键词搜索或最近匹配，这在本地场景够用。

注意：如果将来需要精准引用，可能需要借助 RAG 或全文索引，但提示词现在这样写完全合理。

成本估算与 usage 的降级策略

已明确“优先使用 usage，没有才估算”。有一点可留意：某些国内模型虽然返回 usage，但 total_tokens 可能为 0 或与实际不符，届时成本统计会不准。这是模型适配层的细节，不属于提示词问题。

