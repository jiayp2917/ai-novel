# 技术债清单（tech-debt.md）

> 从 2026-06-17 架构审计（3 个 Explore 子代理 + grep/Read 验证）萃取。
> 按严重度分 3 批，每批可独立验证（`npm run build && npm run test` + `python -m pytest -q`）。
> 状态标记：✅ 已处理 / ⏳ 待处理 / ⏸ 不处理（记录原因）

---

## 批次 1：阻塞级（Commit 1，随架构文档一起处理）

| ID | 文件 | 问题 | 动作 | 状态 |
|---|---|---|---|---|
| B1 | `frontend/src/components/ReaderToolbar.tsx` (214) | 完全死代码，0 引用，且导出的 `ReaderSearchBar` 与新版 prop 名不一致（潜在 import 时静默 bug） | 删除 | ⏳ |
| B1 | `frontend/src/components/ReaderContextMenu.tsx` 顶层版 (49) | 死代码，新版在 `reader/`，顶层 0 引用 | 删除 | ⏳ |
| B1 | `frontend/src/__tests__/ReaderToolbar.test.tsx` (10) | 占位测试 `expect(true).toBe(true)`，随死码删 | 删除 | ⏳ |
| B2 | `frontend/src/components/WorkflowActions.tsx` (3 行 re-export) | shim，2 个 importer 走旧路径 | 建 `workflow/index.ts` barrel，改 `CorePages.tsx:10` + `ModelsSkills.tsx:7` 直引，删 shim | ⏳ |
| B2 | `frontend/src/components/PipelineView.tsx:16` | `export { PipelineFailureSummary }` 重导出，仅为满足一个测试 | 删重导出，改 `ui-regressions.test.tsx:6` 直引子目录 | ⏳ |
| B3 | `frontend/src/hooks/useModelCallActions.ts:19-29` | `testConnection` placeholder throw | **⏸ 保留**（有意保留 API 形状，真实调用走 `probeRole`） | ⏸ |
| B3 | `frontend/src/lib/dynamicAsset.ts` | 零 importer | **⏸ 保留**（Phase 1 预留骨架，有测试覆盖） | ⏸ |
| B4 | `backend/app/services/pipeline/runner.py` (51) | 死代码，0 外部引用，docstring 写"Stage 4 will attach"但 Stage 4 已落地为 executor.py | 删除 | ⏳ |
| B4 | `backend/app/services/pipeline/policy.py` (31) | 死代码，`PipelineDecision`/`status_for_decision` 0 外部引用，executor.py 内联重实现其意图 | 删除 | ⏳ |

---

## 批次 2：重要级（Commit 2）

| ID | 文件 | 问题 | 动作 | 状态 |
|---|---|---|---|---|
| I2 | v0.8 子目录（reader/pipeline/models/workflow） | 拆分后无单元测试覆盖 | 补纯函数单测：`pipelineUtils.ts`、`modelsShared.ts`、`useChapterEditorExtensions.ts` 可抽部分 | ⏳ |
| I5 | `docs/ui-refactor-plan.md` §0.7 | 仍称 Phase 4.1/5/6 "✗ 未启动"且引用旧行号，与 §0.8 ✓ 自相矛盾 | §0.7 表格改为指向 §0.8 的"已完成"指针 | ⏳ |
| I6 | `frontend/src/components/ui/Surface.tsx` | `ui/` 里唯一无 co-located CSS 的组件 | **⏸ 保留在 styles.css**（与全局主题变量强耦合，抽块会 cascade 漂移），已在 architecture.md §5 记录为例外 | ⏸ |
| N12 | `requirements.txt` | `python-dotenv` 死依赖（0 处 `import dotenv`，pydantic-settings 自带 env 加载） | 删除 | ⏳ |
| B6 | `frontend/package.json` | `lucide-react ^1.18.0` 是旧 fork（上游现在是 0.x） | **⏸ 不升级**（运行正常，回归风险 > 收益），在 architecture.md §6 记录 | ⏸ |

---

## 批次 3：锦上添花级（Commit 3）

| ID | 文件 | 问题 | 动作 | 状态 |
|---|---|---|---|---|
| I4 | 11 个前端 + 11 个后端 >200 行文件 | 无 header 注释/docstring 说明用途 | 补 1-2 行 `/** 职责 */` / module docstring | ⏳ |
| N11 | `.env.example` | 未枚举全部 env（前端 3 个 VITE_* + 后端 24 个） | 补全 + 占位 + 注释 | ⏳ |
| N2/N3 | `runtime/` 旧文件 | `image2-theme-assets/20260615-*`（被 20260617 取代）、`runtime/runtime/`（空嵌套） | 删除（gitignored，纯磁盘清理） | ⏳ |
| N1 | `scripts/strip-old-theme-selectors.py` | 一次性迁移已完成，无未来消费者 | 文件头标注"已完成，保留作存档"或移 `scripts/old/` | ⏳ |

---

## 已识别但不处理（明确排除）

这些项在审计中发现，但**有意不在本次范围**，记录以防遗忘：

| 项 | 原因 |
|---|---|
| `styles.css` 按组件拆分（原 I 级） | Phase 7.1 已拒做（cascade 耦合） |
| 虚拟列表（CatalogPanel/VersionHistory/Annotations 的 `.map`） | Phase 8.1 延期（无性能基线） |
| `review_publish.py` 与 `pipeline/reviewer.py` 两套 review 实现 | 涉及业务语义，需单独设计 |
| 三处 pipeline 报告生成器（`runs.py`/`sandbox_pipeline_smoke.py`/`production_pipeline_validate.py`）合并 | 三者结构不同，合并收益有限 |
| `schemas.py` 217 行按资源拆 | 尚可承受，留待增长 |
| `db/models.py` 11 表按关注点拆文件 | 尚可承受 |
| `model_config.py` 抛 HTTPException 改领域异常 | 涉及 admin 契约，风险大 |
| `api/test_support.py` 反向 import `tools/` | 受双重门控，可接受 |
| `storeSlices.ts` 346 行按 slice 拆文件 | 6 个 slice 尚可 |
| `CatalogPanel.tsx` 672 行拆分 | 留待后续按需 |
| 后端多处 `runtime_root / "artifacts"` 等字面路径集中为 `RuntimePaths` | 改动面大，收益有限 |
| ~~`MutateAction` 类型重复定义~~ | ✅ 已处理（追加批次）：移到 `pipelineUtils.ts` 单一源 |
| ~~`api/library.py` GET catalog-status~~ | ⏸ 确认后保留：前端 `useCatalogStatus`（hooks.ts:65）依赖 GET 做"查询即扫描"，POST /scan 是手动触发，二者是 CQRS 分离非简单重复；改动有回归风险 |
| `tools/real_chapter_batch_publish.py` 硬编码 001-005 | 一次性脚本，按需 |
| 前端 `pushTask`（145x）与 `useToast` 双错误管线 | 设计问题，需统一方案 |
| 后端无统一 logger（28 处 print/logging） | 需引入 logging 配置，范围大 |
| `__tests__/visible-copy-language.test.ts` 内容策略 lint 位置 | 可接受 |

---

## 处置记录

每批处理后在下方追加记录（日期 + commit + 处理项）。

### 2026-06-17 — 批次 1 处理（commit d2e4c62）

- ✅ B1 删除：`ReaderToolbar.tsx`、顶层 `ReaderContextMenu.tsx`、`ReaderToolbar.test.tsx`
- ✅ B2 迁移：建 `components/workflow/index.ts` barrel；删 `WorkflowActions.tsx` shim（CorePages/ModelsSkills 改走 barrel）；删 `PipelineView.tsx` 的 `PipelineFailureSummary` 重导出（测试直引子目录）
- ⏸ B3 保留：`useModelCallActions.testConnection`（有意 API 占位）、`lib/dynamicAsset.ts`（Phase 1 预留骨架，有测试）
- ✅ B4 删除：`pipeline/runner.py` + `pipeline/policy.py`（含 tests 零引用；`test_pipeline_state_machine` 改为直测 `PipelineStateMachine.mark_output`）
- 附带：新增 `docs/architecture.md` + `docs/tech-debt.md`

### 2026-06-17 — 批次 2 处理（commit a02ba09）

- ✅ C1 补测试：3 文件 140 用例（`pipelineUtils.test.ts` 89 + `modelsShared.test.ts` 44 + `useChapterEditorExtensions.test.ts` 7）；前端测试 95→235
- ✅ C2 修文档：`ui-refactor-plan.md` §0.7 加导航注释（标明为 v0.6 快照，最新看 §0.8）
- ⏸ C3 保留：`Surface.tsx` co-located CSS（已在 architecture.md §5 记录为例外）
- ✅ C4 删依赖：`requirements.txt` 移除 `python-dotenv`
- ⏸ B6 不升级：`lucide-react`（已在 architecture.md §6 记录）

### 2026-06-17 — 批次 3 处理（commit 29faaf9）

- ✅ I4 文件头：21 个 >200 行文件补 1 行 header/docstring（10 前端 + 11 后端）
- ✅ N11 配置：`.env.example` 补全（分组 + 3 个缺失 env + 前端 VITE 段）
- ✅ N1 存档：`scripts/strip-old-theme-selectors.py` docstring 标注 ALREADY RUN
- ✅ N2/N3 磁盘清理：删 `runtime/image2-theme-assets/20260615-*` × 3 + `runtime/runtime/`（gitignored，不入 commit）

> 三批全部通过 `frontend build + frontend test 235/235 + backend pytest 206/206`。

### 2026-06-17 — 追加清理（"不处理"段中可顺手项）

- ✅ **MutateAction 重复定义**：`PipelineRunDetail.tsx` 与 `usePipelineMutations.ts` 各自定义同一类型 → 移到 `pipelineUtils.ts` 作单一源，两处改为 `import { type MutateAction }`（两者本就 import pipelineUtils，零新增依赖路径）。验证：build 2.47s + test 235/235。
- ⏸ **library GET catalog-status**：读 `library.py` 确认 GET /catalog-status 与 POST /scan 都调 `LibraryScanner.scan()`（GET 有副作用，HTTP 语义不优雅）。但前端 `useCatalogStatus`（hooks.ts:65）依赖 GET 做 React Query 的"查询即刷新扫描"，POST /scan 是 WorkspacePanel 手动触发；二者用途不同，属 CQRS 式分离。改为纯读需拆 `LibraryScanner` 实现，回归风险 > 收益，**保留现状**。
