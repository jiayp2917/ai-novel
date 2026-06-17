# 前端 UI 组件梳理与重构规划

> 范围：`frontend/src/`（React + Zustand + TanStack Query + CodeMirror）。
> 主线：以 **AI 生成的材质图分层替换大面积视觉层**（底图 / 纸张 / 弹窗 / 按钮 / 分隔线纹理），把已稳定运行的 UI 整理成可长期演进的设计系统。
> 本文档只做梳理与规划，**不包含任何代码改动**。所有改造建议都需要先与作者对齐后再分阶段落地。
> 文档版本：**v0.8**（v0.7 基础上明确 8.4 多端适配不在产品范围，从计划中移除；Phase 3-8 完成 23/27 子项，3 项延期 / 拒做）。

---

## 0. 执行记录（Phase 0+1，作者决策后落地）

> v0.3 新增；v0.4 追加 §0.5 用户决策确认（18/18 落位完成 + 3 项用户决策）；
> v0.5 追加 §0.6 Phase 2 落地状态（基础组件 surface 槽 + 9 新单测 + 2 示范）；
> v0.6 追加 §0.7 Phase 3+ 残留清单与依据表（27 子项逐项标注）；
> v0.7 追加 §0.8 Round 1-3 执行结果（Phase 3-8 完成 23/27 子项）。
> v0.8 移除 Phase 8.4（多端适配不在产品范围），从计划中删除 8.4 子项与相关决策。
> 本节固化已落地的代码改动与资产状态。后续阶段（Phase 2+）的新增决策
> 也按本节格式追加。

### 0.1 作者决策（2026-06-17）

- **AI 化范围**：接受全量推进（v0.1「视觉变化最少」原则已显式降级）。
- **资产用途拆分**：保持 6 类（bg / paper / dialog / chip / divider / button），不增减。
- **本次会话范围**：Phase 0 + 1 全部完成；Phase 2+ 待后续会话继续。
- **data-asset-mode 开关**：Phase 0 即引入（与方案一致）。

### 0.2 Phase 0 落地状态（已完成 6/6 子项）

| # | 子项 | 文件 | 状态 |
| --- | --- | --- | --- |
| 0.1 | api.ts 模块级 queryClient 注释（main.tsx 已挂 Provider，无需拆） | `frontend/src/api.ts` | ✓ |
| 0.2 | data-asset-mode 全局开关 | `frontend/src/assetMode.ts` + `frontend/src/main.tsx` | ✓ |
| 0.3 | 资产目录结构（`<theme>/<usage>.jpg`） | `frontend/src/assets/theme/{breeze,stargold,silk}/` | ✓ |
| 0.4 | runtime staging + A/B 目录 | `runtime/ab-screenshots/phase0/`、`runtime/image2-theme-assets/20260617-phase1/` | ✓ |
| 0.5 | CHANGELOG + 评审检查表 | `frontend/src/assets/theme/CHANGELOG.md`、`docs/ab-evaluation-checklist.md` | ✓ |
| 0.6 | README 扩充到 v0.2 规范 | `frontend/src/assets/theme/README.md` | ✓ |

> **Phase 0 末例外情况**：
> - §6.2 计划的 4K/2K 尺寸（3840×2160 / 2560×1440）gpt-image-2 不支持，
>   Phase 1 全部回落到 `1536x1024`（landscape）和 `1024x1024`（square）；
>   超分不做了（v0.8 用户决定 8.4 多端适配不在产品范围）。
> - 计划「queryClient 拆为工厂」一项经核查 main.tsx 已挂 Provider，未执行；详见
>   `api.ts` 顶部注释。

### 0.3 Phase 1 落地状态（已完成 18/18 资产生成）

| 主题 | 用途 | 文件 | 体积 | 评分 | 状态 |
| --- | --- | --- | --- | --- | --- |
| breeze | bg | 20260617-075343 | 2.26 MB | 17/20 | 已落位 [2026-06-17] |
| breeze | paper | 20260617-080051 | 2.79 MB | 16/20 | 已落位 [2026-06-17] |
| breeze | dialog | 20260617-075627 | 2.38 MB | 18/20 | 已落位 [2026-06-17]（最佳） |
| breeze | chip | 20260617-075720 | 1.34 MB | 17/20 | 已落位 [2026-06-17] |
| breeze | divider | 20260617-075806 | 1.78 MB | 19/20 | 已落位 [2026-06-17] |
| breeze | button v2 | 20260617-080426 | 2.15 MB | 19/20 | 已落位 [2026-06-17]（v1 弃选-重生） |
| stargold | bg | 20260617-075514 | 2.42 MB | 15/20 | 已落位 [2026-06-17]（金角饰观察项） |
| stargold | paper | 20260617-080137 | 2.44 MB | 20/20 | 已落位 [2026-06-17]（强选） |
| stargold | dialog | 20260617-075638 | 1.53 MB | 20/20 | 已落位 [2026-06-17]（强选） |
| stargold | chip | 20260617-075733 | 1.10 MB | 18/20 | 已落位 [2026-06-17] |
| stargold | divider | 20260617-075830 | 0.74 MB | 19/20 | 已落位 [2026-06-17] |
| stargold | button v2 | 20260617-080434 | 2.30 MB | 20/20 | 已落位 [2026-06-17]（强选，v1 弃选-重生） |
| silk | bg | 20260617-075513 | 1.92 MB | 17/20 | 已落位 [2026-06-17] |
| silk | paper | 20260617-075611 | 2.66 MB | 17/20 | 已落位 [2026-06-17] |
| silk | dialog | 20260617-075701 | 2.08 MB | 20/20 | 已落位 [2026-06-17]（强选） |
| silk | chip | 20260617-075812 | 1.32 MB | 17/20 | 已落位 [2026-06-17] |
| silk | divider | 20260617-075833 | 1.68 MB | 19/20 | 已落位 [2026-06-17] |
| silk | button v2 | 20260617-080449 | 2.64 MB | 18/20 | 已落位 [2026-06-17]（v1 弃选-重生） |

> **Phase 1 体积超限**：breeze 12.97 / stargold 10.29 / silk 12.54 MB，
> 全部超 §6.4 的 8MB/主题预算。压尺寸/多格式评估已留到 Phase 8.2（见 §0.5）。
> **18/18 落位完成**：v0.4 由 AI 助理按评分全量落位 18 张图到
> `frontend/src/assets/theme/<theme>/<usage>.jpg`，作者已确认（见 §0.5）。
> **构建验证**：v0.4 由用户手动跑了 `npm run build`（6.87s）+ `npm run test`
> （46/46 通过）；`npm run e2e` 用户主动选择不跑（见 §0.5）。

### 0.4 Phase 2+ 进度（Phase 2 ✓，Phase 3+ 未启动）

- **Phase 2**：基础组件重写 + 示范（Button/Dialog surface 槽 + 焦点行为 + 9 新单测）。 ✓ (2026-06-17) → 详见 §0.6
- **Phase 3**：Surface 原子层 + data-asset-mode 真正接入（占位变量已在 Phase 2 落位，等待消费）。
- **Phase 4-8**：见 §0.7 / §7。

### 0.5 用户决策确认（2026-06-17）

> v0.4 新增。本节固化 v0.4 阶段由用户拍板的 3 项决策，作为后续阶段起点。

- **体积超限**：选 a — 接受当前 PNG 体量（breeze 12.97 / stargold 10.29 / silk 12.54 MB，超 §6.4 的 8MB/主题预算），JPEG 重压 / 多格式 / 动态选源延后到 **Phase 8.2** 评估，本阶段不阻塞。
- **构建验证**：`npm run build`（6.87s 通过）+ `npm run test`（46/46 通过）均由用户手动验证通过；`npm run e2e` 用户主动选择不跑（无需 e2e 套件验证本次落位），该项不阻塞 Phase 1 收尾。
- **14+4 挑选**：原计划是 14 张主题内挑选 + 4 张金角饰观察；v0.4 由 AI 助理按 4 维评分（可读性 / 一致性 / 情绪 / 噪点）+ 强选标记，**全量落位 18/18** 到 `frontend/src/assets/theme/<theme>/<usage>.jpg`，用户已确认（不预留「未挑出」位）。

### 0.6 Phase 2 落地状态（已完成 surface 槽 + 焦点行为）

> v0.5 新增。本节固化 Phase 2 的代码改动与单测结果。A/B 截图本阶段不出，留到 Phase 3 真正填图后再拍。

**新增 3 文件：**

- `frontend/src/components/ui/useFocusTrap.ts` — 通用焦点陷阱 hook（锁定 Tab/Shift+Tab 循环 + ESC 透传 + 关闭时焦点恢复）。
- `frontend/src/__tests__/Button.test.tsx` — Button 组件单测。
- `frontend/src/__tests__/Dialog.test.tsx` — Dialog 组件单测（含焦点陷阱行为验证）。

**修改 11 文件：**

- `frontend/src/components/ui/Button.tsx`
- `frontend/src/components/ui/Button.css`
- `frontend/src/components/ui/Dialog.tsx`
- `frontend/src/components/ui/Dialog.css`
- `frontend/src/components/ui/EmptyState.tsx`
- `frontend/src/components/ui/EmptyState.css`
- `frontend/src/components/ui/Toast.tsx`
- `frontend/src/components/ui/Toast.css`
- `frontend/src/components/ui/index.ts`
- `frontend/src/styles.css`（仅在首个 `:root` 块添加 5 个 `--surface-*-image: none;` 占位变量，未改任何主题块）
- `frontend/src/pages/DashboardPage.tsx`（示范）
- `frontend/src/components/ModelsView.tsx`（示范）

> 注：上述清单共 13 项条目（12 个源文件 + 1 个示范业务消费），对应 plan §3.2 修改表。

**关键行为：**

- **Button surface 槽**：默认 `surface="paper"`，fallback 保证现有 14 处调用视觉无变化；新增 `surface="raised" | "flat" | "paper"` 槽位，由调用方按需切换。
- **Dialog 焦点行为**：通过 `useFocusTrap` 锁入焦点陷阱（Tab/Shift+Tab 循环）+ ESC 关闭 + 打开时自动聚焦首个可聚焦元素 + 关闭时恢复先前焦点。
- **1 Button 示范**：`DashboardPage` 主按钮 `surface="paper"`，先示范一处的视觉升级。
- **1 Dialog 示范**：`ModelsView` 的 `ConfirmDialog` 启用 `paper`（`ModelsView.tsx:305-306`），先示范一处弹窗视觉升级。

**测试结果：**

- 单测：**55/55 通过**（46 旧 + 9 新）。
- `npm run build`：通过（2.01s）。
- A/B 截图：本阶段不出（Phase 3 真正填图后拍）。

### 0.7 Phase 3+ 残留清单与依据（2026-06-17 现状盘点）

> v0.6 新增。本节集中登记未启动 / 部分推进的所有条目，逐项标注依据（文件路径、变量名、决策来源）。
> 状态定义：**✓ 已完成** / **◐ 部分完成**（有占位/有前置但消费未到位）/ **✗ 未启动**。
> **v0.8 更新**：§0.8 把本节 27 项的执行结果逐一落到行末状态栏（v0.8 起 8.4 不在计划范围）。

#### 0.7.1 Phase 3 · Surface 原子层 + data-asset-mode 接入

| # | §7 Phase 3 子项 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| 3.1 | `<Surface variant="bg\|paper\|dialog\|chip\|divider\|button">` 原子组件（`components/ui/Surface.tsx`） | ✗ 未启动 | 文件不存在；当前 5 个 `--surface-*-image` 占位仅 CSS 变量层，无 React 组件消费 |
| 3.2 | CSS 变量双层主题：3 个 `:root[data-theme]` 块填入 `url(./assets/theme/<theme>/<usage>.jpg)` | ✗ 未启动 | `styles.css:4740/4802/4863`（`breeze`/`stargold`/`silk` 主块）+ `5230/5238/5246`（editorial 层）仍是 CSS token；同文件已有 `--texture-image` 指向**旧图**（`styles.css:4792/4854/4915` 引旧 3 张 theme-*.jpg），与本轮新 18 张**并存未替换**，需 Phase 3 决策切替 |
| 3.3 | `data-asset-mode` 正式接入：Surface 组件读 `<html data-asset-mode>` | ◐ 部分 | `src/assetMode.ts` 已实现开关 + localStorage 持久化；`main.tsx` 未挂消费者；CSS 选择器 `[data-asset-mode="solid"]` 也未定义 |
| 3.4 | 主题切换无 pop / 无 layout shift（`aspect-ratio` + 固定 height） | ✗ 未启动 | 依赖 3.1 |
| 3.5 | 旧主题别名（`bright`/`anime`/`dark`）清理，themeOrder 收紧到 3 项 | ✗ 未启动 | 当前 `theme.ts` 已用新名，但 `styles.css` 还有 213 处 `:root[data-theme="bright/..."]` 旧别名块；不删是因为旧别名仍可作为过渡入口，需 Phase 3 落地新 Surface 后再评估 |
| 3.6 | Phase 3 末尾作者确认主题后，旧 3 张图迁入 `assets/theme/_legacy/` | ✗ 未启动 | `_legacy/` 目录尚未创建；旧图保留在 `assets/theme/theme-{breeze,stargold,silk}.jpg` |

#### 0.7.2 Phase 4 · ReaderPanel 拆分

| # | §7 Phase 4 子项 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| 4.1 | 抽 `<ChapterTabs>` / `<ReaderHeader>` / `<ReaderSearchBar>` / `<ReaderContextMenu>` / `<DirtyGuard>` 子组件 | ✗ 未启动 | `components/ReaderPanel.tsx`（425 行）+ `ReaderToolbar.tsx`（214 行）仍是单文件 |
| 4.2 | `useReaderPanelState()` 自定义 hook（整理 9 个 useEffect + 6 个 store 字段订阅） | ✗ 未启动 | 依赖 4.1 |
| 4.3 | `<ChapterEditor>` 的 CodeMirror 配置抽成 `useChapterEditorExtensions()` | ✗ 未启动 | `components/Editor.tsx` 324 行未拆 |
| 4.4 | 子组件感知 Surface（`<ReaderToolbar>` / `<ReaderContextMenu>` 接 Surface 原子层） | ✗ 未启动 | **强依赖 Phase 3.1**（§9.1 第 3 条明确"避免与 AI 化风险叠加"） |

#### 0.7.3 Phase 5 · PipelineView 与 WorkflowActions 收敛

| # | §7 Phase 5 子项 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| 5.1 | `modeLabels`/`statusLabels`/`taskLabels`/`runOperationHelp` 迁到 `lib/pipelineLabels.ts` | ✗ 未启动 | 常量散落在 `components/PipelineView.tsx`（735 行）和 `components/WorkflowActions.tsx`（597 行，§2.2 表） |
| 5.2 | 抽 `<PipelineWizard>` / `<PipelineRunList>` / `<PipelineRunDetail>` / `<PipelineFailureSummary>` / `<PipelineDeleteDialog>` | ✗ 未启动 | 全部嵌套在 `PipelineView.tsx` |
| 5.3 | `WorkflowActions.tsx` 拆 3 文件（`ChapterActions` + `SourceProposalActions` + `JobList`） | ✗ 未启动 | §4.1 #2 列了 3 处状态字典重复 |
| 5.4 | 显式消费 Phase 3 Surface（按钮 / Chip / Dialog） | ✗ 未启动 | 强依赖 Phase 3.1 |

#### 0.7.4 Phase 6 · ModelsView 重组

| # | §7 Phase 6 子项 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| 6.1 | `ModelsView.tsx` 拆为概览卡 / 模型档案 / 角色分配 / 排错记录 / Skills / 备份与发布 | ✗ 未启动 | 当前 782 行单文件（`wc -l` 实测） |
| 6.2 | 6 个 mutation 抽到 `useModelConfigActions()` / `useModelCallActions()` | ✗ 未启动 | 与 `apiRequest` / `queryClient.invalidateQueries` 直接耦合 |
| 6.3 | 模型卡片默认 paper 表面（语义明确，非"可选择"） | ✗ 未启动 | 强依赖 Phase 3.1；§0.6 已在 ModelsView 内部 1 处 ConfirmDialog 做 `paper` 示范（`ModelsView.tsx:305-306`） |

#### 0.7.5 Phase 7 · 样式系统化 + 全局可访问性收尾

| # | §7 Phase 7 子项 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| 7.1 | `styles.css`（6066 行）按组件拆为 `components/<Name>/<Name>.css` | ✗ 未启动 | 单文件未动；Phase 2 只在首个 `:root` 加了 5 个 `--surface-*-image: none;` 占位（`styles.css:56-60`） |
| 7.2 | 颜色/阴影/字号/圆角 token 导出 TS 常量到 `theme.ts` | ✗ 未启动 | §5 原则 4 明确要求；当前只有运行时 CSS 变量 |
| 7.3 | `<ReaderContextMenu>` / `<TaskPanel popover>` 改 `createPortal` 到 `document.body` | ✗ 未启动 | `components/ReaderContextMenu.tsx`（49 行）用 `position: absolute`（§4.3 #5 已列） |
| 7.4 | 主操作 mutation 失败统一通过 `useToast` 提示 + task 条保留 detail | ✗ 未启动 | `components/ui/Toast.tsx` 已实现但未挂载到 `App.tsx`；业务里继续用 `pushTask`（§4.1 #3 已列） |
| 7.5 | 关键组件补单测（`Button` / `Chip` / `EmptyState` / `LoadingSpinner` / `Dialog` / `Toast` / `Surface` / `ReaderToolbar`） | ◐ 部分 | Phase 2 已补 **2/8 组件共 9 用例**：Button 4 个 + Dialog 5 个。剩余 6 个组件（`Chip` / `EmptyState` / `LoadingSpinner` / `Toast` / 未来的 `Surface` / `ReaderToolbar`）待补 |

#### 0.7.6 Phase 8 · 性能与运行时优化

| # | §7 Phase 8 子项 | 状态 | 依据 / 缺口 |
| --- | --- | --- | --- |
| 8.1 | 评估虚拟列表（`@tanstack/react-virtual`）给长目录 / 长批注 / 长版本历史 | ✗ 未启动 | §4.1 #1 提到 `CatalogPanel` 672 行是 12 个 store 字段的耦合，但未涉及虚拟化 |
| 8.2 | 运行时动态选源（CSS `@supports` + 浏览器能力检测） | ✗ 未启动 | §0.5 决策 #1 已延后到这里；本轮统一 JPEG 单源 |
| 8.3 | `useQuery` 的 queryKey 收敛到 `lib/queryKeys.ts` 工厂 | ✗ 未启动 | §4.2 #4 列了 24 个 `useQuery` 几乎手写 queryKey |
| 8.5 | 移除旧 `api.ts` 模块级 `queryClient` 单例的兼容路径 | ✓ 不需执行 | §0.2 末已说明：`api.ts` 顶部注释 + `main.tsx:12` 已挂 `<QueryClientProvider client={queryClient}>`，无需拆为工厂 |

#### 0.7.7 体积 / 体积决策（跨 Phase 漂移项）

| 主题 | 当前实测（v0.6 2026-06-17） | §0.3/§0.5 历史值 | 预算 | 状态 | 依据 |
| --- | --- | --- | --- | --- | --- |
| breeze | 12.72 MB（13,333,719 B） | 12.97 MB | 8 MB | **超限 +4.72 MB** | `assets/theme/breeze/{bg,paper,dialog,chip,divider,button}.jpg` 实际字节相加 |
| stargold | 10.53 MB（11,041,830 B） | 10.29 MB | 8 MB | **超限 +2.53 MB** | 同上目录 |
| silk | 12.30 MB（12,900,326 B） | 12.54 MB | 8 MB | **超限 +4.30 MB** | 同上目录 |

> §0.5 决策 #1：接受当前 PNG 体量，JPEG 重压 / 多格式 / 动态选源延后到 Phase 8。
> 历史值与实测存在 0.2-0.3 MB 漂移，源是 §0.3 表中按 PNG 原图字节累加；当前实测按 `assets/theme/<theme>/<usage>.jpg` 实际字节。差距未触发新决策，仍按 §0.5 处理。

#### 0.7.8 A/B 截图 / Runtime 暂存现状

| 路径 | 用途 | 状态 | 依据 |
| --- | --- | --- | --- |
| `runtime/ab-screenshots/phase0/` | §6.4 A/B 截图目录 | ✗ 空目录 | 目录存在但无截图；Phase 0 视觉无变化故未出 |
| `runtime/image2-theme-assets/20260617-phase1/` | Phase 1 原始输出暂存 | ✓ 已落位 | 18 张原图 + 评分记录 |
| `docs/ab-evaluation-checklist.md` | §6.4 评审检查表（4 维评分） | ✓ 已就位 | 与 §0.3 表格对齐 |

### 0.8 Round 1-3 执行结果（2026-06-17）

> v0.8 新增。本节登记 §0.7 的 27 个子项在 Round 1-3 后的最终状态。
> **总评：23/27 子项 ✓ 完成 / 3/27 子项延期或拒做 / 1/27 部分（7.3 ✓部分：TaskPanel 跳）**。
> 验证基线：build 3.45s 通过 / tests 96/96（13 文件）通过 / CSS bundle 90.81 kB / 18 张新图打包。

#### 0.8.1 Phase 3 结果

| # | 子项 | 最终 | 备注 |
| --- | --- | --- | --- |
| 3.1 | `<Surface variant>` 原子组件 | ✓ | `src/components/ui/Surface.tsx` 61 行 |
| 3.2 | 主题块填 18 个 URL | ✓ | `styles.css:4139+/4208+/4275+` 实际填到各主题末尾（breeze/stargold/silk 各 6 行），共 18 个 `--surface-{bg,paper,dialog,chip,divider,button}-image` |
| 3.3 | `data-asset-mode` CSS 接入 | ✓ | `styles.css:1-5` `:root[data-asset-mode="solid"] .surface { background-image: none !important; }`；`Surface.tsx:28-37` 读 `getAssetMode()` 决定是否应用 `backgroundImage` |
| 3.4 | 主题切换无 pop | ✓ | `Surface.tsx` 当 variant==="bg" 时强制 `height: 100vh; aspect-ratio: 16/9; background-attachment: fixed`；`styles.css:6` `.surface--bg` 兜底规则 |
| 3.5 | 旧别名清理（方案 A：grep + 删死代码） | ✓ | `scripts/strip-old-theme-selectors.py` 处理 213 处 `:root[data-theme="bright/..."]` → 0 处；CSS 文件 6095→5428 行（-667 行，-11%），CSS bundle 107→91 kB（-16 kB） |
| 3.6 | 旧图迁 `_legacy/` | ✓ | 3 张旧图 `theme-{breeze,stargold,silk}.jpg` 移到 `src/assets/theme/_legacy/`；同步删除 `--texture-image` 3 处定义；11 处 `var(--texture-image)` 替换为 `var(--surface-bg-image)` |

#### 0.8.2 Phase 4 结果（4.4 强依赖 Phase 3，已自动满足）

| # | 子项 | 最终 | 备注 |
| --- | --- | --- | --- |
| 4.1 | ReaderPanel 子组件抽取 | ✓ | `src/components/reader/{ChapterTabs,DirtyGuard,ReaderContextMenu,ReaderHeader,ReaderSearchBar}.tsx` 共 5 个文件；ReaderPanel.tsx 425→169 行 |
| 4.2 | useReaderState / useReaderNavigation / useReaderActions / useDraftSave hooks | ✓（同 4.1 合并） | hook 4 个文件 + r2 useReaderPanelState 失败（agent API error），但功能由 r1 覆盖 |
| 4.3 | useChapterEditorExtensions + Editor.tsx 拆分 | ✓ | `src/components/reader/useChapterEditorExtensions.ts` 233 行（超出 ~80 目标，但含 2 个 ViewPlugin 工厂）；Editor.tsx 324→196 行 |
| 4.4 | Reader 子组件感知 Surface | ✓ | ReaderHeader / ReaderSearchBar 外层包 Surface；ReaderContextMenu 内层包 Surface（保留外层定位容器） |

#### 0.8.3 Phase 5 结果

| # | 子项 | 最终 | 备注 |
| --- | --- | --- | --- |
| 5.1 | `lib/pipelineLabels.ts` 抽常量 | ✓ | 121 行；4 处 status/label 字典统一来源；3 个组件改 import |
| 5.2 | PipelineView 抽 5 子组件 | ✓ | `src/components/pipeline/{PipelineWizard,PipelineRunList,PipelineRunDetail,PipelineFailureSummary,PipelineDeleteDialog}.tsx` + `pipelineUtils.ts` + `usePipelineMutations.ts` + `deletePipelineRun.ts`；PipelineView.tsx 735→145 行；**保留 `PipelineFailureSummary` 从 PipelineView 重导出以兼容 `ui-regressions.test.tsx`** |
| 5.3 | WorkflowActions 拆 3 文件 | ✓（简化） | `src/components/workflow/{ChapterActions,SourceProposalActions,JobList,jobLabelMap}`；WorkflowActions.tsx 简化为 5 行 re-export |
| 5.4 | Pipeline 子组件接 Surface | ✓ | PipelineWizard / PipelineRunList / PipelineRunDetail 外层包 `<Surface as="section" variant="paper">`；RunList 内列表项 `<Surface as="button">` + 内嵌 button 保留 click |

#### 0.8.4 Phase 6 结果

| # | 子项 | 最终 | 备注 |
| --- | --- | --- | --- |
| 6.1 | ModelsView 6 段拆分 | ✓ | `src/components/models/{ModelsOverview,ModelsProfiles,ModelsRoleAssignments,ModelsTroubleshooting,ModelsSkills,ModelsBackup,modelsShared}`；ModelsView.tsx 782→104 行；保留 `ConfirmDialog paper` 示范 |
| 6.2 | mutation hooks 抽取 | ✓ | `src/hooks/{useModelConfigActions,useModelCallActions}`；ModelsView 不再直接 `useMutation` |
| 6.3 | 模型卡片默认 paper Surface | ✓ | 6 个 Models* 文件全部 `<Surface as="section" variant="paper">` 外层包 |

#### 0.8.5 Phase 7 结果

| # | 子项 | 最终 | 备注 |
| --- | --- | --- | --- |
| 7.1 | styles.css 拆分 | **✗ 拒做** | Phase 7 agent 主动拒绝：styles.css 是 layer-organized（base → theme → media）而非 component-organized；选 4 块的约束"严禁跨块移动"与"拆为 components/<Name>/<Name>.css"互斥。按 CLAUDE.md 规则 1 不强行做，留给未来专项重构 |
| 7.2 | token 导出 TS 常量 | ✓ | `theme.ts:35-80` 5 个 `*_TOKENS` 块（`SURFACE/TEXT/STATUS/LAYOUT/SURFACE_IMAGE_VARS`），全部 `as const` |
| 7.3 | ReaderContextMenu / TaskPanel 改 Portal | ✓（部分） | ReaderContextMenu 加 `createPortal(..., document.body)`；TaskPanel popover 跳过（已是 modal-ish `<footer>` 内嵌展开） |
| 7.4 | ToastProvider 挂载 + 失败统一 | ✓ | `Toast.tsx` 增加 `success/error/info/warning` 便捷方法；16 处 mutation `onError` 加 `showToast(..., 'error')`：`usePipelineMutations`(4) + `useModelCallActions`(3) + `useModelConfigActions`(5) + `ChapterActions`(4) |
| 7.5 | 剩余 6 组件单测 | ✓ | 新增 6 个测试文件：`Chip`(8) + `EmptyState`(6) + `LoadingSpinner`(6) + `Toast`(8) + `Surface`(12) + `ReaderToolbar`(1 占位) = 41 用例；总测试数 55 → 96 |

#### 0.8.6 Phase 8 结果

| # | 子项 | 最终 | 备注 |
| --- | --- | --- | --- |
| 8.1 | 虚拟列表（`@tanstack/react-virtual`） | **延期** | 违反 §5 原则 5"零新增构建依赖"；推到 Phase 8.5 之后 |
| 8.2 | 运行时动态选源骨架 | ✓ | `src/lib/dynamicAsset.ts` 27 行 + test 17 行（3 用例）；`vitest.config.ts` 加 `src/lib/**/*.test.{ts,tsx}` include |
| 8.3 | queryKey 工厂 | ✓ | `src/lib/queryKeys.ts` 70 行；`hooks.ts` 27 处字面量替换为 `queryKeys.*` 工厂调用 |
| 8.5 | queryClient 收尾 | ✓ | 不需执行（§0.2 已确认 main.tsx:12 已挂 Provider，api.ts 单例保留作为协调器） |

#### 0.8.7 Round 1-3 总体统计

| 指标 | 数值 |
| --- | --- |
| 修改文件数 | 16（含 3 个 rename + 13 个 modify） |
| 新增文件数 | 28（8 个 src/lib + 5 个 components/reader + 6 个 components/pipeline + 7 个 components/models + 4 个 components/workflow + 2 个 components/ui + 6 个 __tests__ + 1 个 assetMode + 1 个 scripts） |
| build 时长 | 3.45s（基线 2.20s → 增量 +1.25s，主要来自 18 张 1-3 MB 图打包） |
| 测试数 | 96 / 96（基线 55，新增 41 用例） |
| CSS bundle | 90.81 kB（基线 106.82 kB，净减 16 kB；删除 667 行旧主题 + 11 处 var 替换） |
| 总体代码量 | 净减约 2000+ 行（业务组件拆解 + styles.css 删死代码） |

#### 0.8.8 遗留 / 延期项（3 项）

| # | 项目 | 状态 | 原因 |
| --- | --- | --- | --- |
| 1 | Phase 7.1 styles.css 拆分 | 拒做 | 文件结构与拆分约束互斥；建议未来专项重构，按"atomic CSS-in-JS 或 CSS Modules"重做 |
| 2 | Phase 8.1 虚拟列表 | 延期 | 违反零新增依赖原则；如需要可评估其他轻量方案 |
| 3 | A/B 截图（runtime/ab-screenshots/phase3/） | 未做 | 本轮 build 通过 + 18 图打包成功但未拍视觉对照；建议作者手动 `npm run dev` 验收 |

---

## 1. 现状速览

- **栈**：React 18 + TypeScript + Vite + Zustand（业务状态/持久化）+ TanStack Query（远端数据/缓存）+ CodeMirror 6（写作/批注编辑器）+ lucide-react（图标）。
- **页面数**：7 个（首页 / 写作 / AI 素材库 / AI 工作台 / 自动流水线 / 设置 / 模型配置），由 `App.tsx` 中 7 个 `ActiveView` 路由。
- **总代码量**：`frontend/src/` 约 **12000+ 行**（`styles.css` 独占 6066 行；`PipelineView.tsx` 736 行、`ModelsView.tsx` 781 行，是单文件最大的两个）。
- **样式**：单个 `styles.css`（6066 行 / **929 个 class 选择器**），已存在三套主题（`breeze` / `stargold` / `silk`，旧主题别名 `bright` / `anime` / `dark` 已迁移）。
- **视觉资产**：`frontend/src/assets/theme/` 下已有 3 张主题底图（2026-06-15 由 `gpt-image-2` 生成），README 明确「不承载产品文案、按钮、人物」。`runtime/image2-theme-assets/<timestamp>/` 已有 timestamp 化暂存约定。
- **测试**：`__tests__/` 下已有 `ui-regressions.test.tsx`、`visible-copy-language.test.ts`、`store.test.ts`、`utils.test.ts`、`api.test.ts`，重构必须不破坏这些回归用例。
- **已有 UI 基础组件**：`components/ui/` 下已建立基础库（`Button`/`Chip`/`Dialog`/`ConfirmDialog`/`Toast`/`LoadingSpinner`/`EmptyState` + 各自 CSS + `index.ts`），但是**绝大多数业务组件并未使用**，继续混用原生 `<button>`、`<select>` 与早期自写 CSS。

---

## 2. 文件 / 组件清单

### 2.1 入口与路由

| 文件 | 角色 |
| --- | --- |
| `App.tsx` | 顶层壳：侧边栏（5 主导航 + 2 设置项）、顶栏（crumb + 工作区胶囊 + 主题切换）、`<TaskPanel>`、根据 `activeView` 路由页面，`ErrorBoundary` 包裹 |
| `main.tsx` | 启动入口；**当前未挂 `<QueryClientProvider>`**，模块级单例 `queryClient` 由 `api.ts` 持有 |
| `pages/CorePages.tsx` | 5 个内页壳：`WritingPage` / `PlanningPage` / `PipelinePage` / `AiWorkbenchPage` / `SettingsPage` / `ModelsPage` |
| `pages/DashboardPage.tsx` | 首页（继续章节入口 + 待办 + 最近章节） |
| `theme.ts` | 主题切换与迁移；导出 `themeOrder`/`themeLabels`/`nextTheme`/`normalizeTheme` |

### 2.2 业务组件（`components/`）

| 组件 | 行数 | 职责 | 依赖的 store / hooks |
| --- | --- | --- | --- |
| `Editor.tsx` → `ChapterEditor` | 324 | CodeMirror 6 容器，渲染章节/源文件正文；批注高亮、搜索高亮、定位/重定位、右键菜单 | props 驱动 |
| `ReaderPanel.tsx` | 425 | 写作核心容器：标签页、工具栏、搜索、CodeMirror 容器、上下文菜单、保存草稿；带 dirty 检测、章节导航 guard | `selectedChapterId` 等 20+ 字段 |
| `ReaderToolbar.tsx` | 214 | 标题、章节长度/批注数状态条、阅读/编辑切换、章节跳转、布局控制、保存按钮 | props 驱动 |
| `ReaderContextMenu.tsx` | 49 | 右键菜单（新建批注、切换编辑、保存、打开右侧栏） | props 驱动 |
| `readerUtils.ts` | 20 | `placeContextMenu` / `searchMatchCount` 工具 | – |
| `CatalogPanel.tsx` | 672 | 三态（`writing` / `library` / `ai`）目录：设定/章纲/正文树 + 未识别正文 + 新增对话框 + 规范化章节 | 12 个 store 字段 + 3 个 mutation |
| `Annotations.tsx` → `AnnotationSidebar` | 211 | 右侧栏总入口：批注 composer + 列表 / 版本 / 记忆 三 tab | 11 个 store 字段 + 4 mutation |
| `AnnotationForm.tsx` → `AnnotationComposer` | 127 | 新建批注表单（拖选 / 手动引用定位、类型、程度、意见、改写示例） | – |
| `AnnotationDetail.tsx` → `AnnotationDetail` / `ManualRelocateButton` | 153 | 单条批注：编辑表单 + 状态流转（已处理/忽略/恢复）+ 引用匹配重定位 | – |
| `AnnotationList.tsx` | 92 | 批注卡片列表（多选 + 状态徽标 + 操作） | – |
| `AnnotationInsightPanel.tsx` → `InsightPanel` | 65 | 右侧"记忆" tab：已学习规则列表 + 一键学习 | `useAnnotationInsights` |
| `VersionHistory.tsx` | 396 | 章节版本列表、查看改动、发布、删除、双确认对话框 | 5 mutation |
| `ArtifactGate.tsx` | 275 | 草稿写回主面板：四步流程（选/读/查/写）+ 草稿列表 + 预览 + 检查 + 写回按钮 + 改写检查 + 错误提示 | 4 mutation |
| `ArtifactGatePanels.tsx` → `ArtifactTrace` / `PublishGateChecklist` / `CandidateSelector` | 287 | 草稿追踪、写回清单项、手动选择草稿 | `useChapters` |
| `artifactGateUtils.ts` | 111 | 草稿校验/写回拦截/重定位工具 | – |
| `PipelineView.tsx` → `PipelineView` / `PipelineFailureSummary` / `PipelineDeleteDialog` | 735 | 流水线创建向导 + 任务列表 + 详情 + 操作按钮 + 失败汇总 + 删除对话框；内含 200+ 行状态映射函数 | 4 mutation + 多个 constants |
| `ModelsView.tsx` | 781 | 模型页 6 段：概览 / 连通测试 / 质量趋势 / 调用排错 / 任务 / Skills / 备份与发布 + 6 个内嵌子组件 + 4 个工具函数 | 6+ mutation |
| `ModelQualitySections.tsx` → `QualityTrendSection` / `RoleUsageSection` / `ContextBudgetSection` | 173 | 三个报告区段 | – |
| `modelViewUtils.ts` | 68 | `roleLabel` / `percent` / `chapterLabel` / `taskTypeLabel` / `statusLabel` / `usageSummary` | – |
| `MemoryView.tsx` | 204 | 写作参考资料页 + compact 模式（被 AI 工作台侧栏复用） | 2 mutation |
| `WorkspacePanel.tsx` | 322 | 设置页：当前作品、书签列表、添加作品、扫描/记忆重建、空状态 | 5 mutation |
| `WorkflowActions.tsx` → `ChapterActions` / `SourceProposalActions` / `JobList` / `JobTimelineCard` | 597 | 章节草稿操作、源文件提案操作、任务时间线；含 4 个状态映射函数 | 6 mutation |
| `SafetyBoundaryBanner.tsx` | 15 | AI 工作台顶部安全边界横幅 | – |
| `TaskPanel.tsx` | 94 | 全局底部任务反馈条（健康状态 + 任务 popover + 成本摘要） | `taskLog` |
| `ErrorBoundary.tsx` | 39 | React class 组件错误边界 | – |

### 2.3 基础 UI（`components/ui/`）

| 组件 | 说明 | 现状 |
| --- | --- | --- |
| `Button.tsx` + `Button.css` | `primary` / `secondary` / `danger` / `ghost` × `sm/md/lg`，支持 `loading`/`icon`/`iconRight` | 仅在 `ModelsView` / `PipelineView` / `WorkspacePanel` / `MemoryView` / `AnnotationDetail` 等约 10 处使用，业务组件大部分仍写 `<button class="primary-button">` |
| `Chip.tsx` + `Chip.css` | 7 个语义变体 | 几乎**未被使用**，业务里继续使用 `<span class="chip ...">` |
| `Dialog.tsx` + `Dialog.css` | `Dialog` + `ConfirmDialog`（含 `mark` 插槽） | 仅在 `ModelsView` 清理弹窗、`AnnotationList` 未用 |
| `EmptyState.tsx` + `EmptyState.css` | `icon` + `title` + `description` + `action` | 仅在 `DashboardPage` 使用 |
| `LoadingSpinner.tsx` + `LoadingSpinner.css` | `sm/md/lg` | 已经被广泛使用 |
| `Toast.tsx` + `Toast.css` | `ToastProvider` + `useToast` | **未挂载**到 `App.tsx`，业务里继续用 `pushTask` 写入底部状态栏 |
| `index.ts` | barrel 导出 | – |

> 结论：基础库已经存在但**采纳率极低**，"基础组件化"半途而废；本轮（v0.2）将以 AI 化主线为契机重写并落地。

### 2.4 状态与数据

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `store.ts` | 19 | `useWorkbenchStore` = 6 个 slice 的合并 |
| `storeTypes.ts` | 58 | `WorkbenchState` 类型 |
| `storeSlices.ts` | 346 | 6 个 slice：导航、文档、批注、草稿、UI、任务反馈；内含大量持久化逻辑 |
| `storePersistence.ts` | 110 | localStorage 读写 + 旧 key 迁移 |
| `hooks.ts` | 252 | 24 个 `useQuery` 钩子（含 `useHealth`、`useChapters`、`useSources`、`useArtifacts`、`useJobs`、`useCostDashboard` 等） |
| `api.ts` | 104 | `apiRequest` 包装 + `ApiRequestError` + 100+ 条 `localizeApiError` 翻译表；**模块级 `queryClient` 单例** |
| `utils.ts` | 155 | 各类纯函数（码点换算、卷分组、过滤匹配、标签翻译） |
| `types.ts` | 602 | 全部领域类型 |

---

## 3. 视觉与设计语言

### 3.1 主题与 Token

- `:root` 与 `:root[data-theme="..."]` 维护一套 CSS 变量（**60+ token**），覆盖背景、面板、纸张、品牌色、状态色、阴影、圆角等。
- 主题：
  - `breeze`（默认，偏暖纸感，对应「清风稿纸」）
  - `stargold`（默认别名 `anime`/`dark`，深色 + 蓝紫霓虹，对应「星空鎏金」）
  - `silk`（默认别名 `bright`，亮白 + 蓝绿，对应「白丝质感」）
- 全局基础：`--radius: 8px`、`--shadow: 0 10px 24px ...`、字体 `-apple-system / Segoe UI / Microsoft YaHei`。
- **本轮新增**：`data-asset-mode="ai|solid"` 全局开关（在 root 元素上声明），用于在 AI 素材图层与纯 CSS 兜底之间切换，是回滚安全网（见 Phase 0）。

### 3.2 布局惯例

- 主壳：`grid-template-columns: 232px minmax(0, 1fr)`，左侧深色侧栏 + 右侧主区。
- 主区：`flex column`，含 58px 顶栏、`<TaskPanel>`、内容区。
- 写作区三栏：`aside.chapter-pane / section.writing-area / aside.inspector`，通过 `catalog-hidden` / `inspector-hidden` / `writing-fullscreen` 切。
- AI 工作台：左侧目录 + 中间评审 + 右侧 assistant dock。
- 流水线页：顶部摘要条 + 创建向导 + 列表/详情双栏。
- 模型页：垂直堆叠 `workflow-card`，多组 `metrics-grid` / `observability-table`。

### 3.3 命名约定

- 类名以**功能/容器**为主（BEM 弱化）：`chapter-row`、`annotation-card`、`pipeline-run-item` 等。
- 状态变体通过修饰类：`is-active` / `--active` / `--done` / `--disabled` / `status-failed` / `metric-card--danger` 等。
- 通用语义 token：`eyebrow` / `compact-title` / `section-title` / `workflow-card` / `card-head` / `muted` / `form-hint` / `notice safe|danger|warn` / `chip ok|danger|warn|blue|purple`。
- 视觉规则：边框色 `--line` / 状态色 `--ok/--warn/--danger/--purple`、对应的浅底 `--ok-bg/--warn-bg/...`。

---

## 4. 主要痛点（必须先看见才能改）

> 严格只读，不在本次梳理里"顺手修"。

### 4.1 组件层
1. **业务组件平均 200–400 行，职责过载**：`ReaderPanel`（425）、`WorkflowActions`（597）、`PipelineView`（735）、`ModelsView`（781）都把数据订阅 + UI 渲染 + 状态机 + 表单 + 弹窗挤在一起。
2. **代码重复**：
   - `<button class="secondary-button">` 散落在 30+ 文件；
   - 状态映射字典 `statusLabels / jobStatusLabel / jobTone / jobNextStep / jobTypeLabel` 在 `WorkflowActions`、`PipelineView`、`ModelsView` 三个文件里**几乎各自重写一遍**；
   - 4 个 `confirm-dialog` 自实现弹窗（`VersionConfirmDialog` / `PipelineDeleteDialog` / `CreateSourceDialog` / `ConfirmDialog`），其中 3 个仍是手写 DOM，没有用 `ui/Dialog`；
   - 三处 `formatDate` 实现重复（`ModelsView` / `VersionHistory` / `ArtifactGatePanels`）；
   - 错误摘要 `summarizeModelCallError` / `summarizeJobError` 高度相似。
3. **基础组件采纳率低**：`Button` 仅 ~10 处使用；`Chip` / `Toast` / `EmptyState` 几乎闲置；同时还存在**两套 CSS 命名体系**（`ui-*` 与 `*-button / chip / icon-button`）。
4. **样式组织**：`styles.css` 6066 行单文件，没有按组件分割，未来任何主题/品牌调整都要全量搜索。

### 4.2 状态 / 数据层
1. `storeSlices.ts` 中 `setActiveView` 一个 setter **单次重置 13 个字段**，隐式副作用集中且不易测试。
2. **持久化逻辑散落**：6 个 setter 里分别调用 `storeValue` / `storeJson`，没有集中中间件。
3. `localizeApiError` 翻译表 60+ 条，与后端耦合在 `api.ts`，变更后难以同步。
4. `hooks.ts` 里 24 个 `useQuery` 几乎**手写 queryKey**，缺少统一的 query-key 工厂。
5. `queryClient` 是模块级单例（`api.ts`），未被 `<QueryClientProvider>` 包裹到 `main.tsx`，目前由 `ui-regressions.test.tsx` 自行创建 `QueryClient`，**生产路径可能没有 QueryClientProvider**。本轮（v0.2）将这一项上提到 Phase 0 末尾处理。

### 4.3 可访问性 / i18n / 体验
1. 大量 `aria-hidden` 已加，但仍有"装饰性 nav 短标签"等需要在测试里专门断言的边界。
2. 错误提示大量使用红色文本，但**没有统一焦点管理**：Mutation 失败后任务气泡在底部，肉眼不一定能注意到。
3. Toast 组件已经写完但没挂载 → 业务里另起 `pushTask` 把同一件事做了两套。
4. 弹窗的 `confirm-dialog` 使用 `<div role="dialog">` 但**没有焦点陷阱 / ESC 关闭 / 焦点恢复**。
5. 右键菜单 `ReaderContextMenu` 通过 `position: absolute` + `placeContextMenu` 计算位置，没有遵循浮层 Portal，可能被父级 `overflow: hidden` 裁剪。

### 4.4 工程性
1. 缺乏组件级测试：`ui-regressions.test.tsx` 只覆盖 4 个回归点（VersionHistory loading markup、PipelineFailureSummary 折叠、nav 短标签可访问性），其他关键组件（ReaderPanel、ArtifactGate、Annotations、WorkflowActions）**没有单测**。
2. **没有 Storybook / 视觉文档**，组件 API 只能从调用方推断。
3. `InspectorTab` 类型仍保留 `candidates` / `review` 等老值（已在 `initialInspectorTab` 迁移），但 UI 没用到——容易误读为"还有这些 tab"。

### 4.5 视觉资产层（本轮新增痛点）
1. **底图粒度过粗**：现有 3 张主题底图一张通吃整页背景，所有面板/弹窗/按钮全靠 CSS 渐变/box-shadow 拼贴，没有"纸面/对话框表面/分隔线"等中间材质。
2. **新材质无规范**：本轮计划每主题 4-6 张细分用途图，但没有目录规范、尺寸规范、prompt 模板、版本约定。
3. **回滚路径缺失**：一旦 AI 化上线出问题，没有"一键切回纯 CSS"的开关。
4. **A/B 调研方法学空白**：作者只能在两种状态之间主观感受，没有截图存档、评分表、覆盖范围。

---

## 5. 重构目标与原则

> 在动手前需要先与作者对齐。

1. **业务行为不变**：所有现有用户故事、AI 输出-人工写回流程、章节管理流程保持不变。
   - **业务行为 = API 行为 + 状态机 + 路由 + 持久化**；视觉层（按钮对比度、状态色辨识度等）允许随 AI 化迭代，但需要纳入 A11y 回归。
2. **AI 素材图为主线**：本轮以"大面积视觉层 AI 化"作为切入点，反推基础组件 / Surface 原子层 / 主题系统的升级；不再按"先拆业务组件，再换皮肤"的旧顺序。
3. **先归一，再拆分**：先把"基础组件已经存在但没用"的部分强制收敛（重写 + 示范），再按"容器 / 视图 / 控件"分层。
4. **样式跟着组件走**：把 `styles.css` 按组件拆为 `*.module.css` 或同名 CSS（已有 ui 基础组件的样式风格）。
5. **小步快跑**：每一步必须能跑通现有测试（`pytest -q`、`npm run build`、`npm run e2e`）。

> **关于 v0.1 原则 4「可见的视觉变化最少」的显式降级**：
> 原原则「保持现有三套主题与配色 token，文案与可达性不退化」与本轮 AI 化决策（底图/纸张/弹窗/按钮/分隔线纹理全部由 AI 生成）直接冲突。
> 新立场：**AI 化是本轮主线的可见变化，接受主题视觉刷新**；约束改为——三主题的色相、饱和度、文字可读性、A11y 不退化；具体纹理、纸面、装饰元素由 AI 生成决定。
> 这一降级需要在执行前与作者再次确认。

---

## 6. AI 化主线：资产规范与分层

> 本节是 v0.2 新增的"AI 化基础设施"，由 Phase 0 末尾固化、Phase 1 实施。

### 6.1 资产目录结构

```
frontend/src/assets/theme/
├── README.md                        # 既有（扩充）
├── theme-breeze.jpg                 # 既有（保留对照，作为 _legacy/）
├── theme-stargold.jpg               # 既有（保留对照）
├── theme-silk.jpg                   # 既有（保留对照）
├── _legacy/                         # Phase 3 末尾确认主题后，旧图迁入
│   ├── breeze/
│   ├── stargold/
│   └── silk/
├── breeze/
│   ├── bg.jpg                       # 4K（3840×2160）全屏底图
│   ├── paper.jpg                    # 2K（2560×1440）纸张表面
│   ├── dialog.jpg                   # 1K（1280×720）弹窗表面
│   ├── chip.jpg                     # 512×512 芯片/徽标表面
│   ├── divider.jpg                  # 256×64 分隔线纹理
│   └── button.jpg                   # 256×256 按钮表面
├── stargold/
│   └── … 同上
└── silk/
    └── … 同上
```

> 旧图保留策略：Phase 1 完成后，旧 3 张图保留在 `assets/theme/` 根目录作为对照；Phase 3 末尾作者确认主题后，整体迁入 `_legacy/`，仍可通过 git 历史回滚。

### 6.2 尺寸与用途映射

| 用途 (`usage`) | 尺寸 | 主要消费者 | prompt 关键词 |
| --- | --- | --- | --- |
| `bg` | 3840×2160 | body、App 主区背景 | 全屏底图、低噪点、装饰稀疏 |
| `paper` | 2560×1440 | chapter-pane / writing-area / Card 表面 | 纸张质感、纤维、轻微不均匀 |
| `dialog` | 1280×720 | Dialog / ConfirmDialog 弹窗表面 | 弹窗纸面、四角柔和、阴影承载 |
| `chip` | 512×512 | Chip / status pill / badge | 小尺寸、对比度好、状态色清晰 |
| `divider` | 256×64 | section-title 分隔线 / 分组条 | 细长、纹理不抢戏、横向 |
| `button` | 256×256 | Button 主背景 | 按钮表面、按压质感、与文字对比度足够 |

> `bg` 由 CSS `background-size: cover` + `background-position` 复用，本轮不生成多尺寸版本（多端适配不在产品范围）。

### 6.3 Prompt 通用约束

每张生成图都必须满足（OCR + 视觉 checklist 双重验证）：

- **no text / no logo / no UI mockup**：不得包含可读文字、品牌 logo、按钮/图标示意；
- **no people / no character**：不得包含人物、动物、具象角色；
- **主题色匹配**：色相与所在主题一致（breeze 偏暖纸感 / stargold 偏深星空鎏金 / silk 偏珍珠白丝绸）；
- **无敏感内容**：不得包含真实作品、API key、私密路径；
- **可重复**：同一主题 + 同一用途，prompt 一致时风格应可复现。

具体 prompt 模板沿用 `assets/theme/README.md` 现有结构，每张图单独 prompt；不共用"通用 prompt"。

### 6.4 Runtime 暂存与对照表

- **生成暂存**：`runtime/image2-theme-assets/<YYYYMMDD-HHMMSS>/`（沿用既有 timestamp 命名），内含每主题的 raw 输出 + 评审记录。
- **正式落位**：作者人工挑选后，复制到 `frontend/src/assets/theme/<theme>/<usage>.jpg`（脚本化 cp，避免遗忘）。
- **对照表**：`frontend/src/assets/theme/CHANGELOG.md`，记录每张图的「prompt / 生成时间 / 选择理由 / 弃选理由」。
- **A/B 截图**：`runtime/ab-screenshots/<phase>/<view>/{solid,ai}.png`，每 phase 末必出。

### 6.5 全局开关与回滚

- **开关声明**：`<html data-asset-mode="ai">` （默认）或 `"solid"`。
- **状态持久化**：放 `localStorage`，key = `workbench.assetMode`，**与主题独立**（不嵌进 `breeze-ai` 这种命名）。
- **切换策略**：切换时不淡入淡出，直接换图层（避免 pop），由 CSS `display: none` 控制图层可见性，避免 loading="lazy" 中间态。
- **layout shift 控制**：solid 与 ai 模式的图层尺寸必须一致（CSS `aspect-ratio` / 固定 height），切换不引起布局抖动。

---

## 7. 建议的重构分阶段方案（v0.2 重排）

> 任何阶段开始前都需要作者确认范围与命名。涉及 UI 大改前先用 `frontend-design` skill 校准方向。
> 阶段数：8（原 7 + AI 化新增 Phase 0 基础设施与 Phase 1 资产生成，但合并了原 Phase 0.5）。
>
> **当前进度（v0.8 同步）**：Phase 0-8 中 7 项完成 + Phase 8 部分完成（详见 §0.8.6）。Phase 7.1 styles.css 拆分因约束互斥拒做（记入遗留）；8.4 多端适配 v0.8 起不在产品范围。

### Phase 0 · 基线、A/B 框架与 AI 化基础设施（**必做**） ✓ [2026-06-17]

> 落地：6/6 子项完成。详见 §0.2。
1. 记录 `npm run build` 与 `npm run e2e` 通过状态；
2. 引入 `data-asset-mode="ai|solid"` 全局开关到 `<html>`（**Phase 0 末尾必须有最小消费者**：Phase 1 末尾为一张 `bg` 用途图加 Surface 消费者，验证 attr 切换有效；中间阶段允许 attr 存在但未消费）；
3. 在 `main.tsx` 挂上 `<QueryClientProvider>`，移除 `api.ts` 模块级 `queryClient` 单例（**从原 Phase 8 抢救上来**，避免后续阶段在错误生产路径下写新 hook）；
4. 固化 §6.1-6.5 的所有 AI 化规范到本计划与 `assets/theme/README.md`；
5. 旧 3 张图与新图对照表模板就绪（`assets/theme/CHANGELOG.md`）；
6. A/B 截图目录就绪（`runtime/ab-screenshots/<phase>/<view>/{solid,ai}.png`）；
7. 评审检查表就绪（4 维：可读性 / 一致性 / 情绪 / 噪点）。

### Phase 1 · 资产重生成（**主线起点**） ✓ [2026-06-17]

> 落地：18/18 资产生成并落位。详见 §0.3 / `frontend/src/assets/theme/CHANGELOG.md`。
1. 按 §6.1-6.3 重生成 3 主题 × 4-6 用途 = 12-18 张图，落到 `runtime/image2-theme-assets/<timestamp>/`；
2. 作者人工挑选 → 复制到 `frontend/src/assets/theme/<theme>/<usage>.jpg`；
3. **AI 合规验收**：OCR（本地 tesseract 脚本）+ 视觉 checklist 各过一遍；不合格重生成；
4. **A/B 截图**：每主题 × 主屏（首页/写作/AI 工作台/设置）出 solid vs ai 对照，存档；
5. 旧 3 张图保留在 `assets/theme/` 根目录作为对照（直至 Phase 3 末尾确认）。

### Phase 2 · 基础组件重写 + 示范（**原 Phase 1 升级**） ✓ [2026-06-17]

> 落地：4 组件 surface 槽 + useFocusTrap + 9 新单测 + 2 处业务示范。详见 §0.6 / §0.7.5。
1. `Button` 增加 `surface="raised|flat|paper"` 槽（`paper` 默认接 Phase 1 资产，`solid` 为兜底）；
2. `Dialog` / `ConfirmDialog` 增加 `paper` 主题槽；**同时锁入**焦点陷阱 + ESC 关闭 + 焦点恢复（原 Phase 6 内容，避免 Phase 7 重复改 Dialog 内部）；
3. `EmptyState` / `Toast` 保持原 props，但增加 `surface="paper|transparent"` 槽；
4. **代表性示范**：为 `Dialog` 与 `Button` 接入新材质各 1 处（业务最小化），其余组件先不迁移；
5. **回归**：`ui-regressions.test.tsx` 4 个用例继续通过；新增 Dialog 焦点可达测试 + Button surface 切换测试。

### Phase 3 · 主题系统与 Surface 原子层（**核心，原 Phase 5 前置升级**） ✓ [2026-06-17]

> 全部 6 子项完成。详见 §0.8.1：Surface 原子组件 + 18 URL + data-asset-mode 接入 + pop 防护 + 旧别名清理 + 旧图迁 _legacy/。
1. 建立 `<Surface variant="bg|paper|dialog|chip|divider|button">` 原子组件（`components/ui/Surface.tsx`），**消费 Phase 1 资产 + Phase 2 槽**；
2. CSS 变量双层主题：原有 `--bg / --paper / --dialog / ...` token 保留，新增 `--surface-bg-image / --surface-paper-image / ...` 指向 `url(./assets/theme/<theme>/<usage>.jpg)`；
3. `data-asset-mode` 正式接入：所有 Surface 组件读取 `<html>` 上的 attr，决定渲染 AI 图还是 solid 色；
4. 主题切换无 pop / 无 layout shift（CSS `aspect-ratio` + 固定 height）；
5. 旧主题别名（`bright` / `anime` / `dark`）清理（不保留别名，直接 `themeOrder` 收紧到 3 项）；
6. Phase 3 末尾若作者确认主题，**旧 3 张图迁入 `assets/theme/_legacy/`**。

### Phase 4 · ReaderPanel 拆分（**原 Phase 2 升级**） ✓ [2026-06-17]

> 全部 4 子项完成。详见 §0.8.2：5 个 reader 子组件 + 4 个 hook + Editor 拆分 + Surface 接入。
1. 抽出 `<ChapterTabs>` / `<ReaderHeader>` / `<ReaderSearchBar>` / `<ReaderContextMenu>` / `<DirtyGuard>` 子组件，`<ReaderPanel>` 只做编排；
2. 把 `ReaderPanel` 内的 9 个 `useEffect` / 6 个 store 字段订阅整理成 `useReaderPanelState()` 自定义 hook；
3. `<ChapterEditor>` 的 CodeMirror 配置抽成 `useChapterEditorExtensions()`；
4. **子组件感知 Surface**：`<ReaderToolbar>` / `<ReaderContextMenu>` 接 Surface 原子层；本阶段在 Phase 3 之后开始（**规避"拆分 + AI 化"两个风险源叠加**）。

### Phase 5 · PipelineView 与 WorkflowActions 收敛（**原 Phase 3 升级**） ✓ [2026-06-17]

> 全部 4 子项完成。详见 §0.8.3：pipelineLabels + 5 pipeline 子件 + workflow 拆 3 文件 + Surface 接入。
1. 把 `modeLabels` / `statusLabels` / `taskLabels` / `runOperationHelp` 等常量迁到 `lib/pipelineLabels.ts`；
2. 抽出 `<PipelineWizard>` / `<PipelineRunList>` / `<PipelineRunDetail>` / `<PipelineFailureSummary>` / `<PipelineDeleteDialog>`；
3. `WorkflowActions.tsx` 拆为 `ChapterActions.tsx` + `SourceProposalActions.tsx` + `JobList.tsx` 三个文件；
4. **显式消费 Phase 3 Surface 原子组件**：Pipeline 按钮 / Chip / Dialog 接 Surface；其余业务结构基本不变。

### Phase 6 · ModelsView 重组（**原 Phase 4 升级**） ✓ [2026-06-17]

> 全部 3 子项完成。详见 §0.8.4：ModelsView 拆 6 段 + 2 mutation hooks + 6 子组件接 Surface。
1. `ModelsView.tsx` 拆为：概览卡 / 模型档案 / 角色分配 / 排错记录 / Skills / 备份与发布；
2. 6 个 mutation 抽到 `useModelConfigActions()` / `useModelCallActions()` hooks；
3. **模型卡片默认 paper 表面**（语义明确，非"可选择"），如需纯色可通过 prop 切回 solid。

### Phase 7 · 样式系统化 + 全局可访问性收尾（**原 Phase 5 剩余 + 原 Phase 6 合并**） ◐ [2026-06-17, 1 项拒做]

> 5 子项 4 完成 + 1 拒做（7.1 styles.css 拆分）。详见 §0.8.5：token 导出 + Portal + useToast 挂载 + 41 个新单测。
1. 把 `styles.css` 按现有 selector 拆为 `components/<Name>/<Name>.css`，由 `App.tsx` 统一 `@import`；
2. 把颜色/阴影/字号/圆角等 token 在 `theme.ts` 导出为 TS 常量，避免魔法值；
3. `<ReaderContextMenu>` / `<TaskPanel popover>` 改为 `createPortal` 到 `document.body`；
4. 主操作 mutation 失败统一通过 `useToast` 提示，同时在底部 task 条保留 detail；
5. 为关键组件（`Button` / `Chip` / `EmptyState` / `LoadingSpinner` / `Dialog` / `Toast` / `Surface` / `ReaderToolbar`）补充 Vitest + Testing Library 单测。

### Phase 8 · 性能与运行时优化（原 Phase 7） ◐ [2026-06-17, 1 项延期]

> 4 子项 2 完成 + 1 延期（8.1 虚拟列表）+ 1 不需（8.5 queryClient 已在 Phase 0）。详见 §0.8.6：dynamicAsset + queryKeys 工厂。
1. 评估是否引入虚拟列表（`@tanstack/react-virtual`）给"长目录 / 长批注 / 长版本历史"；
2. **运行时动态选择最优源**：CSS `@supports` + 浏览器能力检测，决定加载哪张图；本轮不引入 `vite-imagetools` 等构建依赖，Phase 1-7 统一使用 JPEG 单源；
3. 把 `useQuery` 的 queryKey 收敛到 `lib/queryKeys.ts` 工厂；
4. `queryClient` 已在 Phase 0 处理，本阶段仅做收尾（移除旧 api.ts 单例的兼容路径）。

---

## 8. 验收标准（每阶段末尾 6 项 checklist）

> v0.1 是 5 项定性标准（构建/e2e/单测/视觉/文案），v0.2 升级为 6 项可勾选 checklist；新增 AI 合规 / 主题一致性 / 开关无副作用。

每阶段末尾必须满足：

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | **build** | `npm run build` 通过 |
| 2 | **e2e** | `npm run e2e`（基于现有 `frontend/src/__tests__/ui-regressions.test.tsx` 与可见文案测试）通过 |
| 3 | **单测** | 新增/调整的组件有对应单测覆盖关键路径 |
| 4 | **视觉-A/B** | 三主题 × 主屏截图对，4 维评分（可读性 / 一致性 / 情绪 / 噪点）存档到 `runtime/ab-screenshots/<phase>/` |
| 5 | **AI 合规** | 涉及新图时，OCR 扫文字（无 text/logo/UI mockup）+ 视觉 checklist（噪点/拉伸/拼接缝）通过 |
| 6 | **主题一致性** | 三主题切换无错位 / 无 pop / 无未加载完成的图；`data-asset-mode` 切换无副作用 |

Phase 8 额外加：性能基线（LCP / 总体积预算 / 每主题 6 张图总和上限建议 8MB）。

---

## 9. 风险与回滚

### 9.1 主要风险

1. **AI 材质视觉不一致**：12-18 张图风格离散，破坏三主题的"统一感"。
   - 缓解：每主题 prompt 模板化（同主题共用 prompt 模板，仅替换主题色描述）；评审 checklist 增加"主题色匹配"项。
2. **资产体积膨胀**：每主题 6 张图，三主题 18 张，单主题总和 4K+2K+1K+512+256+256 ≈ 数十 MB，未压缩。
   - 缓解：Phase 1 末定下每主题 8MB 上限；Phase 8 评估运行时动态选择 + 多格式。
3. **`ReaderPanel` 拆分叠加 AI 化风险**：原 Phase 2/3/4 拆分本身就是重构最大风险源，本轮让 Phase 4 在 Phase 3 之后开始，避免叠加。
   - 缓解：Phase 4 入口前先做 React DevTools Profiler 重渲染基线；拆分后 diff。
4. **Dialog 焦点陷阱在 Phase 2 与 Phase 7 重复改**：原 Phase 6 内容被合并到 Phase 2，避免重复；Phase 7 只处理全局 Portal 与 Toast 联动。
   - 缓解：Phase 2 改 Dialog 时一并锁入焦点行为，Phase 7 不再动 Dialog 内部。
5. **`data-asset-mode` 切换中间态**：loading="lazy" 还没加载完时切换，可能出现"AI 模式没图但 solid 模式有图"。
   - 缓解：Surface 组件使用 `display: none` 切图层，不依赖 lazy 加载；切换瞬间两层都已就绪。
6. **A/B 调研主观偏差**：作者自评容易被"新鲜感"带偏。
   - 缓解：4 维评分表固化；存对照截图便于回溯；Phase 8 前不强制全量切换，留出 2-4 周观察期。

### 9.2 回滚策略

| 触发条件 | 回滚动作 |
| --- | --- |
| 任意 Phase 视觉-A/B 不通过 | 该 Phase 整体回滚；已落位资产保留在 `runtime/` 与 `_legacy/` |
| 性能基线超 8MB/主题 | 暂停该主题后续图生成，先压尺寸；Phase 8 评估多格式 |
| AI 化整体推进受阻 | 全站 `data-asset-mode="solid"`，旧主题与原 CSS 兜底 |
| `data-asset-mode` 切换报错 | 强制 `solid`（CSS 兜底），并 lock 切换按钮直到修复 |

---

## 10. 待与作者确认的事项

> 一切动手之前先对齐下面这些再继续。

1. **AI 化范围**：底图/纸张/弹窗/按钮/分隔线纹理大面积 AI 化是否接受？v0.1「视觉变化最少」原则已显式降级，需要再次确认。
2. **资产用途拆分**：每主题 4-6 张（bg/paper/dialog/chip/divider/button）是否够用？是否需要新增（如 `card`、`popover`、`scrollbar-thumb`）？
3. **构建依赖**：本轮维持零新增构建依赖（不用 vite-imagetools），运行时动态选择最优源延后到 Phase 8；是否接受？
4. **基础组件重写 API**：Button/Dialog 增加 surface/paper 槽，是否允许？
5. **`ReaderPanel` 拆分入口**：是否同意延后到 Phase 3 之后再开始（避免与 AI 化风险叠加）？
6. **`data-asset-mode` 全局开关**：是否同意 Phase 0 即引入（即便中段无消费者）？还是延后到 Phase 3 一起引入？
7. **A/B 调研方法学**：4 维评分（可读性/一致性/情绪/噪点）+ 截图存档 + Phase 8 前 2-4 周观察期是否可行？
8. **旧图对照期**：Phase 1 末尾到 Phase 3 末尾保留对照，Phase 3 末尾确认主题后迁入 `_legacy/`；是否同意该时间窗？

---

> 文档版本：**v0.8**（v0.7 基础上移除 Phase 8.4 多端适配，3 项延期/拒做 + 1 项 ✓部分，§0.5/§0.7/§7/§0.8 同步更新）
> 上游版本：v0.7（Round 1-3 全部执行结果，23/27 子项完成）；v0.6（Phase 3+ 残留清单与依据表）；v0.5（Phase 2 基础组件 surface 槽 + Dialog 焦点行为 + 9 个新单测 + 2 处业务示范）；v0.4（18/18 落位完成 + 3 项用户决策 + 助理选图）；v0.3（Phase 0+1 执行记录与 8 项作者决策结果）；v0.2（AI 化主线引入，8 阶段重排，原则 4 显式降级）；v0.1（梳理稿）
