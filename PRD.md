# 小说编辑器产品需求文档 (PRD)

## 1. 产品概述

### 1.1 产品定位
本地运行的通用长篇小说 AI 辅助创作工作台，支持多题材、多作品的设定管理、章纲规划、正文创作、批注审核、差异对比和发布管理。

产品不绑定单一小说。短期目标是支撑 20-30 万字小说跑通完整生产流程；长期目标是支撑百万字级别小说，通过分层记忆、人物状态、伏笔生命周期、时间线和发布审计降低长篇创作风险。

### 1.2 目标用户
- 长篇小说创作者（网文作者）
- 需要 AI 辅助但保持人工控制权的专业创作者
- 注重内容一致性和长期可维护性的创作者

### 1.3 核心价值
- **长期一致性保障**：通过上下文记忆系统确保百万字内容的连贯性
- **人工可控发布**：所有 AI 生成内容必须经过审核和人工确认才能写回源文件
- **多模型协同**：不同创作阶段使用最合适的 AI 模型
- **沙盒安全机制**：候选内容独立存储，源文件永不被动覆盖
- **通用题材适配**：作品档案、题材模板和审核清单按作品隔离，不把某本书的设定写成全局规则
- **稳定生产输入**：正文生成优先基于单章写作卡、短 skill 和分层记忆，减少随机漂移和 token 浪费

---

## 2. 功能模块

### 2.1 工作区管理

**功能描述**
- 支持三种工作区结构自动识别：旧目录（00-系统/01-设定/02-正文/03-章纲）、当前作品目录（00-设定/01-大纲/02-正文/03-章纲）和新目录（content/）
- 工作区路径配置和状态检测
- 素材文件扫描和索引建立
- 作品档案扫描为 settings，例如 `00-设定/作品档案.md`

**用户流程**
1. 打开应用，确认当前工作区路径
2. 点击"重新扫描"，系统自动识别目录结构
3. 左侧目录树显示系统设定、小说设定、章纲、正文分卷
4. 点击"重建短记忆"，生成核心事实、章卡、正文摘要

**核心数据**
- 源文件类型：settings（设定）、outlines（章纲）、chapters（正文）
- 检测统计：各类型文件数量
- 作品档案字段：题材、目标字数、目标读者、叙事人称、基调、核心卖点、主角驱动、主要角色、世界规则、禁写项、卷/章规划、当前阶段

---

### 2.2 素材浏览与管理

**功能描述**
- 三面板布局：目录树 + 内容阅读器 + 批注面板
- 支持 Markdown 渲染
- 章节范围定义（一个源文件可包含多个章节）

**用户流程**
1. 左侧目录选择章节或设定文件
2. 中间面板显示内容，支持滚动浏览
3. 右侧批注面板显示当前文档的所有批注

---

### 2.3 批注系统

**功能描述**
- 文本拖选创建批注
- 批注类型：问题指出、改进建议、事实核查、风格调整、伏笔管理、角色一致性
- 批注严重度：低、中、高、严重
- 批注状态：open（待处理）、relocated（已重定位）、resolved（已解决）
- 支持示例重写文本

**用户流程**
1. 在阅读器中拖选文本
2. 弹出批注创建对话框
3. 选择类型、严重度，填写评论
4. 可选填写示例重写
5. 保存后批注显示在右侧面板

**批注类型详解**
| 类型 | 说明 | 典型场景 |
|------|------|----------|
| 问题指出 | 标记文本中的问题 | 逻辑漏洞、设定冲突 |
| 改进建议 | 提出优化方向 | 描写不够生动、节奏问题 |
| 事实核查 | 需要验证的内容 | 技能设定、装备属性 |
| 风格调整 | 文风相关标注 | 对话不自然、叙述过细 |
| 伏笔管理 | 剧情伏笔标注 | 需要后续回收的伏笔 |
| 角色一致性 | 人物行为一致性 | 角色性格、说话方式 |

---

### 2.4 AI 候选生成

**功能描述**
- 按批注生成修订候选（正文）
- 生成设定/章纲提案
- 上下文预览（显示核心事实、章卡、结构化状态）
- 当前正文版本生成
- AI 主导生产流：构思补全、设定 proposal、大纲 proposal、卷纲 proposal、逐章章纲 proposal、单章写作卡、正文 artifact、审核、修复、复审、diff、人工确认发布
- 生成模式：稳定省钱、质量优先、速度优先

**用户流程**
1. 选择章节，勾选相关批注
2. 点击"上下文预览"查看 AI 上下文
3. 点击"按批注生成候选"创建任务
4. 点击"运行任务"执行队列中的任务
5. 任务完成后查看候选产物

**AI 主生产流程**
```text
作品档案
-> 设定 proposal
-> 大纲 proposal
-> 卷纲 proposal
-> 逐章章纲 proposal
-> 单章写作卡
-> 正文 artifact
-> reviewer 审核
-> fixer 修复
-> 复审
-> diff
-> 人工确认发布
-> 记忆/风格 proposal
```

**单章写作卡**
正文生成前优先锁定单章写作卡，字段包括：章节编号、标题、本章目标、场景、出场人物、冲突/机制、常规推进方式、主角行动、情绪点/爽点/悬念点、配角反应、结尾钩子、禁写项、字数范围和风格摘要。写作卡先作为 proposal/artifact 保存，用户确认后才能作为稳定正文生成输入。

**生成模式**
| 模式 | 用途 | 行为 |
|------|------|------|
| 稳定省钱 | 默认生产 | 短 skill、低随机性、单候选、常规 reviewer |
| 质量优先 | 关键章节 | 增加一致性检查、复审或 arbiter 辅助 |
| 速度优先 | 快速草稿 | 减少 AI 审核步骤，主要依赖人工审核 |

**模型路由**
| 岗位 | 模型 | 职责 |
|------|------|------|
| writer | Agnes AI `agnes-2.0-flash` | 正文创作 |
| reviewer | Agnes AI `agnes-2.0-flash` | 内容审核 |
| fixer / quick_fix | Agnes AI `agnes-2.0-flash` | 修复和小修 |
| memory / long_context | Agnes AI `agnes-2.0-flash` | 上下文记忆 |
| outliner / structural_fix | Agnes AI `agnes-2.0-flash` | 章纲和结构调整 |
| arbiter | Agnes AI `agnes-2.0-flash` | 高风险判断辅助 |

DeepSeek、Kimi、Qwen、GLM 保留为后备供应商，但当前默认全流程走 Agnes。

---

### 2.5 审核与差异对比

**功能描述**
- 候选内容自动审核（检查问题、规则违反）
- 差异对比显示原文 vs 候选
- 人工确认/拒绝机制
- 强制发布（需填写理由，但不能绕过 diff、backup、人工确认和发布审计）

**用户流程**
1. 进入"审核中心"视图
2. 选择章节，查看候选产物
3. 点击"执行审核"，AI 检查候选内容
4. 查看"差异对比"，逐行对比变更
5. 审核通过后标记为可发布

**审核维度**
- 章节标题一致性
- 源文件版本一致性
- Markdown 格式规范
- 规则违反检测
- 事实一致性检查

---

### 2.6 发布门

**功能描述**
- 人工正文版本发布流程：保存正文版本 → 本地校验 → 差异确认 → 人工写回
- AI 草稿发布流程：生成草稿 → AI 检查 → 必要时修订和复审 → 差异确认 → 人工写回
- 发布前自动备份
- 发布记录追踪

**用户流程**
1. 在“写作”保存人工正文版本，或在“AI 工作台/自动流水线”生成 AI 草稿
2. 人工正文版本可直接查看最终差异；AI 草稿必须先检查通过
3. 点击“确认写回正文”
4. 系统备份原文，写入草稿，更新版本记录

**发布约束**
- AI 草稿必须先审核才能发布
- 人工草稿不强制 AI 审核，但必须通过本地格式、标题、版本校验、改动对比和人工确认校验
- 必须人工确认（approved_by_user=true）
- 强制发布需要理由，且仍必须保留 diff、backup、publish decision 和审计记录
- 设定和章纲只生成提案，不直接发布
- 长期记忆补充和风格规则也必须先生成 proposal，用户确认后才成为正式资料

---

### 2.7 短记忆系统

**功能描述**
- 核心事实提取（人物、地点、物品、设定）
- 章卡生成（章节摘要）
- 结构化状态管理（人物状态、伏笔状态）
- 批注规则学习
- 风格差异学习：从 AI 初稿与用户确认稿的 diff 中提炼 AI 味问题和用户偏好，生成 style proposal

**用户流程**
1. 点击"重建短记忆"
2. 系统扫描所有源文件
3. 提取实体和关系
4. 生成结构化记忆
5. 后续生成时自动注入上下文

**记忆与风格约束**
- 自动重建的短记忆只能来自已确认资料和已发布正文。
- AI 生成的记忆补充不能直接成为 canonical memory，必须先进入 proposal。
- 未发布草稿不进入长期记忆，也不参与风格学习。
- 风格规则按作品隔离，不自动更新全局 skill。

**记忆类型**
| 类型 | 内容 | 作用 |
|------|------|------|
| core_fact | 核心事实 | 人物、地点、设定 |
| chapter_card | 章卡 | 章节摘要 |
| structured_state | 结构化状态 | 人物状态、伏笔 |
| annotation_insight | 批注规则 | 从批注中学习的规则 |

---

### 2.8 任务队列

**功能描述**
- 异步任务执行
- 任务状态跟踪（pending、running、completed、failed）
- 任务锁定机制（防止并发修改）
- 任务日志记录

**任务类型**
- revise_from_annotations：按批注修订正文
- generate_proposal：生成设定/章纲提案
- snapshot_candidate：创建待检查副本（内部/高级能力，不作为写作页普通入口）
- review_artifact：审核候选
- rebuild_memory：重建记忆

---

### 2.9 成本监控

**功能描述**
- 每日 API 调用次数统计
- 每日预估成本
- 输入/输出字符统计
- 缓存命中率
- 运行中任务数

**控制参数**
- daily_max_model_calls：每日最大调用次数（默认 200）
- daily_max_estimated_cost：每日最大预估成本（默认 20 元）
- max_input_chars_per_call：单次最大输入字符（默认 60000）
- max_output_tokens_per_call：单次最大输出 token（默认 12000）

---

### 2.10 模型管理

**功能描述**
- 模型注册表（config/model_registry.yaml）
- 模型探测工具（测试模型可用性）
- 模型使用报告

**配置格式**
```yaml
providers:
  agnes:
    enabled: true
    base_url: https://apihub.agnes-ai.com/v1
    api_key_env: AGNES_API_KEY
    models:
      - id: agnes-2.0-flash
        enabled: true
        supports_json: true
        roles: [writer, reviewer, fixer, quick_fix, memory, long_context, outliner, structural_fix, arbiter]
        default_max_tokens: 12000
```

---

## 3. 用户界面设计

### 3.1 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar: 工作区路径 | 主题切换 | 当前状态                      │
├──────┬───────────────────────────────────────┬──────────────┤
│ Act  │  Main Content                         │  Right Panel  │
│ Rail │                                       │              │
│ 🏠   │  - 首页：状态概览和常用入口            │  - 批注/版本  │
│ 写   │  - 写作：目录+正文编辑+草稿            │  - 可隐藏     │
│ 素   │  - AI 素材库：设定、章纲、提案         │              │
│ AI   │  - AI 工作台：检查、修订、质量趋势      │              │
│ 流   │  - 自动流水线：批量生成和检查           │              │
│ ⚙   │  - 设置/模型：工作区、模型路由          │              │
└──────┴───────────────────────────────────────┴──────────────┘
```

### 3.2 视图导航

| 图标 | 名称 | 说明 |
|------|------|------|
| 🏠 | 首页 | 当前作品状态、最近章节、常用入口 |
| 写 | 写作 | 正文编辑、搜索、批注、保存正文版本、版本历史 |
| 素 | AI 素材库 | 系统设定、小说设定、章纲只读查看和提案 |
| AI | AI 工作台 | 草稿检查、AI 修订、质量趋势、上下文裁剪、skills 状态 |
| 流 | 自动流水线 | 批量生成、检查、修订和 dry-run |
| ⚙ | 设置/模型 | 工作区、模型路由、环境和高级状态 |

### 3.3 主题系统
- 主题1：轻快动漫，用于默认日常写作和首页展示
- 主题2：赛博朋克，用于更强视觉识别的工作台风格
- 主题选择保存到浏览器本地；正文编辑区始终保持高对比度和无遮挡

---

## 4. 数据模型

### 4.1 核心实体

```
SourceFile (源文件)
├─ id, path, kind, sha256, mtime, size, active
└─ Chapters[]

Chapter (章节)
├─ id, chapter_no, title, source_file_id
├─ range_start, range_end
└─ Annotations[]

Annotation (批注)
├─ id, chapter_id, source_file_id
├─ range_start, range_end, quote_text
├─ type, severity, comment, example_rewrite
└─ status

Artifact (候选产物)
├─ id, kind, path, sha256
├─ base_source_file_id, base_chapter_id
├─ metadata_json
└─ Review, PublishDecision

Proposal (创作提案)
├─ settings / outline / chapter_outline / writing_card / style
├─ status: draft, accepted, rejected
├─ source_artifact_id, accepted_by, accepted_at
└─ target_source_file_id

ChapterWritingCard (单章写作卡)
├─ chapter_no, title, goal, scene, characters
├─ conflict_or_mechanism, normal_solution, protagonist_action
├─ emotional_point, supporting_reactions, ending_hook
└─ constraints, target_length, style_summary

Review (审核记录)
├─ id, artifact_id, passed, manual_required
├─ evidence_count, issues_json
└─ created_at

PublishDecision (发布记录)
├─ id, artifact_id, approved_by_user, force
├─ diff_path, backup_path
└─ published_at

MemoryItem (记忆项)
├─ id, kind, scope, content_json
├─ source_hash, stale
└─ created_at, updated_at

StyleDeltaReport (风格差异报告)
├─ source_artifact_id, published_version_id
├─ ai_taste_issues, user_preferences
├─ proposed_rules
└─ status: proposal, accepted, rejected

Job (任务)
├─ id, type, status, payload_json
├─ result_json, error
├─ locked_chapter_id, locked_source_file_id
└─ created_at, updated_at
```

---

## 5. 技术架构

### 5.1 后端技术栈
- FastAPI（Web 框架）
- SQLAlchemy + SQLite（ORM + 数据库）
- Alembic（数据库迁移）
- Pydantic（数据验证）
- httpx（HTTP 客户端）

### 5.2 前端技术栈
- React 19（UI 框架）
- Zustand（状态管理）
- TanStack Query（数据获取）
- CodeMirror（编辑器）
- Vite（构建工具）

### 5.3 AI 集成
- 多模型路由服务
- 温度控制（Agnes 默认按岗位和生成模式控制）
- 思考模式控制（Kimi/GLM 默认关闭）
- Token 估算和成本控制

---

## 6. 安全与质量控制

### 6.1 沙盒机制
- 所有 AI 输出写入 `runtime/artifacts/`
- 源文件永不被动修改
- 发布前必须人工确认
- 设定、大纲、章纲、写作卡、记忆补充和风格规则均 proposal-first

### 6.2 版本控制
- 源文件 SHA256 校验
- 章节版本追踪
- 发布自动备份

### 6.3 并发控制
- 任务锁定机制
- 并发数限制（模型、岗位、提供商）
- 超时保护（默认 300 秒）

---

## 7. 非功能需求

### 7.1 性能要求
- 扫描 500 个源文件 < 5 秒
- 候选生成 < 60 秒
- 差异计算 < 5 秒
- 前端响应 < 200ms
- 百万字项目不得依赖全文塞入 prompt，应使用分卷摘要、最近章节摘要、人物状态、伏笔、时间线和相关设定检索
- context report 应记录每次使用的写作卡、skill、memory 和裁剪情况

### 7.2 可用性要求
- 错误信息中文化
- 键盘快捷键支持
- 离线模式（只读）
- 数据导入/导出

### 7.3 可维护性要求
- 完整的测试覆盖（单元测试 83+）
- E2E 测试覆盖核心流程
- API 文档自动生成
- 操作日志记录

---

## 8. 发展规划

### 8.1 短期（1-2 月）
- [ ] 通用产品边界文档和安全策略收口
- [ ] 作品档案模板与 proposal 流
- [ ] 单章写作卡 proposal 与稳定正文生成
- [ ] 生成模式：稳定省钱、质量优先、速度优先

### 8.2 中期（3-6 月）
- [ ] 风格差异学习和作品级风格规则版本化
- [ ] 人工编辑器补齐：复制、软删除/恢复、选区 AI 候选
- [ ] 长期记忆 proposal 和 canonical memory 边界
- [ ] 多题材模板和审核 checklist

### 8.3 长期（6 月+）
- [ ] 百万字分层记忆和检索式上下文
- [ ] 人物状态、伏笔生命周期、时间线和设定影响分析
- [ ] 重复桥段和角色口吻漂移检测
- [ ] 插件系统、协作编辑、移动端适配

---

**版本**: 1.1.0
**最后更新**: 2026-06-11
