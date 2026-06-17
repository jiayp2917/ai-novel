# 架构说明（architecture.md）

> 本文是 ai-novel 项目的**权威架构文档**，描述前后端分层契约、目录职责边界、扩展规则与已知边界例外。
> 新增功能或重构时，先对齐本文；本文与代码冲突时，以代码为准并更新本文。
>
> 最后更新：2026-06-17（v0.8 UI 重构提交 `f028862` 之后）

---

## 1. 系统全景

本地小说编辑器，单机运行，无云端。

```
┌─────────────────┐     HTTP (127.0.0.1)     ┌─────────────────────────┐
│  React/Vite     │ ◄──────────────────────► │  FastAPI 后端 (8000)     │
│  前端 (5173)    │                           │                         │
│  CodeMirror     │                           │  ┌───────────────────┐  │
│  编辑器         │                           │  │ api/ (12 routers) │  │
└─────────────────┘                           │  └─────────┬─────────┘  │
                                              │            ▼            │
                                              │  ┌───────────────────┐  │
                                              │  │ services/         │  │
                                              │  │  ├ pipeline/      │  │
                                              │  │  ├ model_client   │  │
                                              │  │  └ ...            │  │
                                              │  └─────────┬─────────┘  │
                                              │     ┌──────┴──────┐     │
                                              │     ▼             ▼     │
                                              │  SQLite(app.db)  文件系统│
                                              │                   工作区 │
                                              └─────────────────────────┘
```

**关键数据流**：

1. 前端扫描工作区 → 后端 `LibraryScanner` 读文件系统入 DB
2. 用户在正文上建批注 → 存 `Annotation` 表
3. AI 按 pipeline 生成候选稿 → 写入 `runtime/artifacts/`
4. 人工审核 → 通过发布门（`ReviewPublishService`）原子写回正文 + 备份

**工作区目录**：

```
content/           源文件（设定、章纲、正文）
runtime/           运行时数据（gitignored）
├── artifacts/     AI 生成的候选稿
├── backups/       发布前备份
├── diffs/         差异对比
└── app.db         SQLite
```

---

## 2. 前端分层契约（`frontend/src/`）

单 Vite 工程，无 monorepo。按关注点分层 + v0.8 引入的特性文件夹模式。

| 层 | 位置 | 放什么 | 不放什么 |
|---|---|---|---|
| **App shell** | `App.tsx`, `main.tsx` | 导航、主题切换、Provider 包裹、全局错误边界 | 业务逻辑、数据获取 |
| **全局状态** | `store.ts` + `storeSlices.ts` + `storeTypes.ts` + `storePersistence.ts` | Zustand slice（slice 模式，6 个 slice） | 业务组件、API 调用 |
| **领域层** | `api.ts`, `hooks.ts`, `hooks/`, `lib/`, `types.ts`, `utils.ts` | React Query 包装、mutation、纯函数、类型 | 组件 |
| **页面** | `pages/CorePages.tsx`, `pages/DashboardPage.tsx` | 薄页面壳 + 组件组合 + 读 store | 业务实现（下沉到组件） |
| **特性组件** | `components/{reader,pipeline,models,workflow}/` | 单特性的组件 + 该特性的 hooks/utils | 跨特性逻辑、全局状态定义 |
| **顶层组件** | `components/*.tsx`（根目录） | 跨页面复用组件、shim 壳、未拆分的单体 | 已迁入子目录的特性 |
| **基础原语** | `components/ui/` | 无业务的可复用原语（Button/Dialog/Toast/Surface…），**唯一带 `index.ts` barrel 的目录，唯一 co-located CSS** | 业务知识、状态 |
| **主题资产** | `assets/theme/{breeze,silk,stargold}/` | jpg 图片 + README/CHANGELOG | 代码 |

### 2.1 路由约定

无 URL 路由。页面切换由 Zustand `activeView` 状态驱动，`App.tsx` 渲染对应的 `pages/CorePages` 导出。新增页面 = `CorePages.tsx` 加一个导出 + `App.tsx` 加导航项。

### 2.2 数据获取约定

- 所有 HTTP 走 `api.ts` 的 `apiRequest<T>`（74 处调用）。**禁止**业务代码直接 `fetch`。
- React Query key 统一在 `lib/queryKeys.ts` 工厂生成。**禁止**散落的字面量 key。
- mutation hook 放 `hooks/`（跨特性）或特性文件夹内（特性专属）。

### 2.3 样式约定

- `styles.css`（5427 行）是**单一全局样式表**，由 `main.tsx` 导入一次。
- **唯一例外**：`components/ui/` 的 6 个组件各带 co-located `.css`（Button/Chip/Dialog/EmptyState/LoadingSpinner/Toast）。
- `Surface.tsx` 是 `ui/` 里**唯一无 co-located CSS** 的组件，样式在 `styles.css`（见 §5 例外）。
- `styles.css` 不按组件拆分（Phase 7.1 已拒做，cascade 耦合）。

### 2.4 v0.8 特性文件夹现状

| 文件夹 | 组件 | 内置 hooks | 内置 utils | barrel |
|---|---|---|---|---|
| `reader/` | ChapterTabs, DirtyGuard, ReaderHeader, ReaderContextMenu, ReaderSearchBar | 6 个 `use*.ts` | （`readerUtils.ts` 在父级，历史遗留） | 无 |
| `pipeline/` | PipelineDeleteDialog, PipelineRunDetail, PipelineRunList, PipelineWizard, PipelineFailureSummary | `usePipelineMutations.ts` | `pipelineUtils.ts`, `deletePipelineRun.ts` | 无 |
| `models/` | 6 个 Models 面板 | （放 `hooks/` 根） | `modelsShared.ts` | 无 |
| `workflow/` | ChapterActions, JobList, SourceProposalActions | 无 | `jobLabelMap.ts` | **有（本次新增）** |

**未拆分的顶层单体**（留待后续按需，非缺陷）：`CatalogPanel.tsx`(672)、`ArtifactGate.tsx`/`ArtifactGatePanels.tsx`、`VersionHistory.tsx`(396)、`WorkspacePanel.tsx`(322)、`MemoryView.tsx`(204)、`Annotations.tsx` 及 4 个 `Annotation*.tsx`、`Editor.tsx`(196)。

### 2.5 shim 壳约定

`ReaderPanel.tsx` / `PipelineView.tsx` / `ModelsView.tsx` 是**组合壳**：保留稳定 import 面，内部组装子目录组件。这种壳用于"外部按旧路径导入，内部已拆分"的场景。

---

## 3. 后端分层契约（`backend/app/`）

严格四层 FastAPI 布局。

| 层 | 位置 | 放什么 | 不放什么 |
|---|---|---|---|
| **组合根** | `app/main.py` | 路由注册、CORS、全局异常 handler、`/health` | 业务逻辑 |
| **HTTP** | `app/api/*.py`（一资源一 router，共 12 个） | Pydantic body、`Depends`、HTTPException 映射、response shaping | 业务校验、跨表 SQL、model 调用 |
| **领域** | `app/services/*.py` + `app/services/pipeline/` | 业务逻辑、事务、文件系统/ORM 副作用 | HTTPException（**仅 `model_config.py` 例外**，见 §5） |
| **数据** | `app/db/models.py` + `app/repositories.py` + `app/db/session.py` | 11 张 ORM 表、通用 `Repository[ModelT]`、Session 工厂 | 业务校验 |
| **横切** | `app/core/` | `config.py`(24 env)、`admin_auth.py`、`file_utils.py`、`http_errors.py` | 领域逻辑 |
| **工具** | `backend/tools/*.py`（`python -m backend.tools.X` 可运行） | 诊断、迁移、一次性脚本 | 被 `app/` 反向依赖（仅 `test_support.py` 一处例外，见 §5） |

### 3.1 依赖方向（单向，禁止反向）

```
tools/  ──►  app/api/  ──►  app/services/  ──►  app/db/ + app/core/
                  │
                  └─(test_support.py 唯一反向 import tools/)
```

- `api/` 不 import 其他 `api/` 模块
- `services/` 不 import `api/`（`model_config.py` 抛 HTTPException 是契约耦合，非 import 违规）
- `db/` 不 import `services/`
- 循环依赖用"函数内 import"打破（`model_router.py`、`memory.py`、`revision.py`、`review_publish.py` 各有，有意为之）

### 3.2 pipeline 子包内部组织（`services/pipeline/`）

按 pipeline 阶段切分，非单体：

```
state_machine.py   17 态枚举 + 转换矩阵（纯逻辑）
planner.py         任务规划 + hash 锁定
executor.py        按 job.type 分派到 writer/reviewer/fixer/summarize
writer.py          写章节草稿
reviewer.py        审核候选（合并本地规则 + 模型审核）
fixer.py           修复候选（仅 writer 授权的 finding）
summarizer.py      章节摘要
runs.py            PipelineRunService（生命周期 + 序列化 + 报告）
findings.py        审核结果归一化（纯函数，被 reviewer/review_publish 共用）
local_rules.py     标题/字数/重复句审核（纯函数）
payloads.py        child_task_ids 提取
```

### 3.3 外部集成集中点

所有出站 HTTP 到模型供应商**只**在 `services/model_client.py`（`ModelClient.chat`）：缓存、重试、DPAPI 密钥查找、并发信号量、成本估算都在这一个文件。

### 3.4 ORM 约定

- 11 张表全部在 `db/models.py`（按关注点用注释分组，不按表拆文件）。
- 通用 `Repository[ModelT]`，无每表 DAO 类。
- 迁移用 alembic（repo 根），正常生命周期**不**调 `Base.metadata.create_all`（仅 test_support + 部分 tools 调）。

---

## 4. 扩展规则（新增功能往哪放）

| 新增… | 做法 |
|---|---|
| **前端页面** | `pages/CorePages.tsx` 加薄壳导出 → `App.tsx` 加导航项 → 业务实现下沉到 `components/` |
| **前端特性** | 建 `components/<feature>/` 文件夹（组件 + 特性 hooks + 特性 utils）；跨特性的 mutation 放 `hooks/` |
| **前端可复用原语** | 放 `components/ui/`，**必须** co-located CSS + 在 `index.ts` barrel 导出 |
| **React Query key** | 加到 `lib/queryKeys.ts`，**禁止**散落字面量 |
| **后端 API 资源** | 新建 `api/<resource>.py`（带 `prefix="/api/<resource>"`）→ `main.py` `include_router` |
| **后端业务服务** | 新建 `services/<domain>.py`，`Session` 作参数；抛领域异常由 `api/` 映射 HTTPException |
| **pipeline 任务类型** | 新建 `services/pipeline/<type>.py` → `planner.py` 注册 `PipelineTaskType` → `executor.py` 加分派分支 |
| **ORM 表** | 加到 `db/models.py` → 写 alembic 迁移 → 用 `Repository(session, Model)` 访问 |
| **主题资产** | `assets/theme/<theme>/` 放 6 张 jpg（bg/paper/button/chip/dialog/divider）→ `theme.ts` 登记 CSS 变量 |
| **配置项** | 后端加到 `core/config.py` `Settings`（SCREAMING_SNAKE_CASE env）；前端加到 `.env.example` + `import.meta.env` |

---

## 5. 已知边界例外（诚实记录，非缺陷）

| 例外 | 位置 | 原因 | 处置 |
|---|---|---|---|
| `api/` 反向 import `tools/` | `api/test_support.py:18` import `tools/create_e2e_workspace` | E2E 种子逻辑复用 | 受 `ENABLE_TEST_SUPPORT` + sandbox 路径双重门控，仅测试环境启用 |
| Service 抛 HTTPException | `services/model_config.py`（14 处） | admin 契约紧耦合 | 待重构为领域异常；当前可接受 |
| 函数内 import 打破循环 | `model_router.py:53`, `memory.py:65`, `revision.py:167`, `review_publish.py:309` | 避免 import 循环 | 有意为之，勿轻易提前到模块顶部 |
| `Surface.tsx` 无 co-located CSS | `components/ui/Surface.tsx` | Surface 相关样式与全局主题变量强耦合 | 样式留在 `styles.css`，**有意例外** |
| `useModelCallActions.testConnection` 是 placeholder throw | `hooks/useModelCallActions.ts:19-29` | 保留 API 形状，真实调用走 `useModelConfigActions.probeRole` | 有意保留，勿删 |
| `lib/dynamicAsset.ts` 零 importer | `lib/dynamicAsset.ts` | Phase 1 预留的多格式扩展骨架 | 保留（有测试覆盖） |

---

## 6. v0.8 重构遗留（明确不做）

| 项 | 状态 | 原因 |
|---|---|---|
| `styles.css` 整体拆分 | 拒做（Phase 7.1） | 巨型共享选择器块 + cascade 物理顺序耦合，拆分会视觉漂移 |
| 虚拟列表 | 延期（Phase 8.1） | 无性能基线 + 违反零新增依赖 |
| 多端适配 | 移除（Phase 8.4） | 不在产品范围 |
| A/B 截图 | 未做 | 独立事项 |
| `review_publish.py` 与 `pipeline/reviewer.py` 合并 | 未做 | 涉及业务语义，需单独设计 |
| `schemas.py` 按资源拆 | 未做 | 217 行尚可承受 |
| `lucide-react ^1.18.0` 升级 | 未做 | 运行正常，升级回归风险 > 收益 |

详见 `docs/tech-debt.md`。

---

## 7. 相关文档

- `CLAUDE.md` — Claude Code 工作准则 + 启动命令 + 架构速查
- `docs/tech-debt.md` — 技术债全量清单（分 3 批）
- `docs/ui-refactor-plan.md` — UI 重构 v0.8 计划与落地记录
- `docs/ab-evaluation-checklist.md` — A/B 截图评估清单（待执行）
- `frontend/src/assets/theme/README.md` — 主题资产说明
