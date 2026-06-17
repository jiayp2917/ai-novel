# ai-novel 开发计划

本文面向维护者和后续开发者，记录当前状态、已验收能力、剩余风险、迭代路线和测试矩阵。它回答“下一步先做什么、怎么验收、哪些边界不能退化”。

## 1. 当前状态

当前项目已经具备以下基础能力：

- 工作区扫描统一到 `content/settings`、`content/outlines`、`content/chapters`；旧 `00/01/02/03` 目录仅作为迁移工具输入。
- 设定、大纲、章纲等 source proposal。
- 正文 artifact、review、diff、backup、publish decision 和发布门。
- 人工正文版本保存、diff 和发布确认。
- 自动流水线任务、子任务推进、状态观察和 dry-run 验证。
- 模型调用记录、角色路由、质量趋势和用量报告。
- 模型配置已升级为模型档案池和角色分配；内置档案只读，自定义档案被角色使用时禁止删除。
- AI 工作台已形成“选择草稿 -> 查看内容 -> 检查完成 -> 查看改动 -> 确认写回正文”的人工主线。
- 通用 skills、作品级 skill 隔离原则和生成模式记录。
- 后端单元/集成测试、前端单元测试、前端构建、Playwright E2E 覆盖和 GitHub Actions 基线。

仍需保持保守表述：自动流水线当前是章节候选生产和安全门验证，不是无人值守全书发布器。

## 2. 已完成治理

开源准备和高优先级治理已落地：

- I/O 层不再直接抛 HTTP 响应异常，由 API 层转换。
- Admin API 增加本机访问和 token 保护边界。
- 工作区切换、扫描、候选创建、批注、AI 生成、任务推进、流水线、人工检查、版本发布和正文写回等状态变更接口统一使用本机或 token 访问边界。
- 预算暂停使用明确异常类型，不靠字符串匹配。
- 流水线 artifact 准备从异常控制流改为状态化推进。
- 文件哈希改为分块读取。
- 主应用工作区扫描统一为 `content/settings`、`content/outlines`、`content/chapters`，历史 `00/01/02/03` 目录只保留为迁移工具输入。
- 测试目录已按 `unit`、`integration`、`acceptance`、`tools`、`fixtures` 分层；原 1000 行级 pipeline API 测试已拆为运行管理、发布保护、worker 流程和 sandbox 工具测试。
- `backend/tools` 已补充工具边界说明，区分本地启动、沙盒验证、迁移、打包、验收和高风险批量发布工具。
- 运行态、沙盒、E2E、image2 临时输出和旧/新作品目录 ignore 规则已补强，避免本地数据误入仓库。
- CI 覆盖后端编译、pytest、前端构建和 Playwright E2E。
- README 和 docs 不写真实作品内容、密钥明文和个人本机路径。

当前后续治理重点：

- 减少 services 中高频 `dict[str, Any]`，优先改为 Pydantic model 或 dataclass。
- 拆分职责过重的 pipeline runs 逻辑。
- 合并子任务状态统计查询，减少重复 SQL。
- 补前端组件、hook 和 store 单元测试。
- 按当前视图启停轮询。
- 拆分过大的全局样式文件。
- 增加 Dockerfile 或安装包说明，改善部署体验。
- 保持前端普通用户可见文案中文优先，并用测试防止新增明显英文按钮、提示、空状态或错误说明。
- 保持三主题视觉系统可维护：清风微动、星空鎏金、白丝质感必须共享语义 token 和操作结构，禁止退回通用 AI Dashboard 风格或只靠大面积渐变堆叠。

## 3. 当前验证基线

项目当前默认 AI 路径是 Agnes AI，角色探针、沙盒发布门、流水线 dry-run、前端 E2E 和原始工作区 hash 复核是后续模型与流水线变更的基础验收组合。

最近一次本地审核验证（2026-06-17）：

- `python -m compileall -q .\backend .\tests`：通过
- `python -m pytest -q`：206 passed，1 个 Starlette/httpx 兼容性 warning
- `cd .\frontend && npm test -- --run`：235 passed
- `cd .\frontend && npm run build`：通过
- `cd .\frontend && npm run e2e`：27 passed（此前 7 个 v0.8 回归已修复，见 commit a0f3792）
- `python <codex-home>\skills\codex-dev-team\scripts\project_audit.py --root <repo-root> --json`：无 forbidden hits；`.env.example` 仅作为配置模板被标记为可疑路径。

此前 v0.8 重构引入的 7 个 e2e 回归已修复（commit a0f3792）：Dialog 关闭守卫恢复、ReaderPanel 搜索状态去重、模型页/流水线过期选择器与文案更新，外加后端 `app.routes` 版本漂移过滤；流水线章节卡片漏译的 `Paused by user` 也一并按状态过滤修复。详见 docs/tech-debt.md。

新增 E2E 覆盖包含破坏性误操作：草稿切换后旧 diff 不得残留、未检查草稿不能查看改动或写回、无效模型配置被拒绝、被角色使用的模型档案不能删除、预算暂停状态必须从任务队列正确显示。

保留风险：

- 需要补一章复制工作区显式发布门验收，确认 diff、backup、publish decision 和原始作品 hash 不变。
- 审计仍显示 `frontend/src/styles.css`、模型配置/流水线组件和若干集成测试文件偏大，需要继续拆分。
- 当前 `docs/` 除三份核心公开文档外还保留架构、技术债、UI 重构和 A/B 评审记录；开源前需要确认是合并进三件套，还是作为过程材料移出公开文档目录。
- 三主题 image2 素材已进入前端构建，当前图片体积较大；后续应压缩或增加 WebP/AVIF 资产，避免安装包和首屏资源膨胀。
- 自动流水线的宣传和文档必须继续避免“无人值守全书发布”表述。

## 4. P0：稳定写作闭环

P0 目标是让作者能够稳定完成“资料准备 -> 写作卡 -> 正文候选 -> 审核修订 -> diff -> 人工发布 -> 记忆更新”的最短闭环。

实施项：

- 作品档案模板和补全 proposal。
- 单章写作卡生成、确认和 writer 上下文接入。
- artifact metadata 稳定记录 `generation_mode`、写作卡、skill、memory 和上下文来源。
- AI 工作台完成正文候选、review、fixer、复审、diff 和确认写回。
- 发布后生成章节摘要和短记忆 proposal。
- pipeline report 统一 UTF-8 输出并增加 parse 回归。
- 复制工作区单章显式发布门验收，必须生成 diff、backup、publish decision，并复核原始作品 hash 不变。

验收：

- 模型不可用时人工编辑闭环仍可用。
- AI 草稿 review 未通过不能发布。
- 写作卡未确认前不进入 stable writer 上下文。
- 发布后能追踪 artifact、review、diff、backup、publish decision 和 model call。

## 5. P1：提升长篇质量

P1 目标是降低长篇生产的漂移、遗忘和 AI 味。

实施项：

- 导入已有作品的只读分析：识别设定、大纲、正文、章纲和缺失资料。
- 对标/拆文资产库：保存抽象拆解、节奏标签和短规则，不保存大段原文。
- 角色状态卡、伏笔卡、时间线和地点/组织关系。
- 多版本正文候选和结构化评审报告。
- reviewer 输出结构化 findings，fixer 只消费有证据且被授权的问题。
- 风格差异学习：从 AI 初稿和用户确认稿 diff 生成 style proposal。
- 长上下文构建使用分层摘要和检索条目，不塞全文。

验收：

- 新建不同题材作品时不加载旧作品规则。
- 未发布草稿不进入长期记忆或风格学习。
- 风格规则按作品隔离、版本化、可回滚。
- 生成后期章节时能命中相关人物、伏笔、设定和最近章节摘要。

## 6. P2：改善使用与交付

P2 目标是降低普通作者的安装、启动、配置和日常操作成本。

实施项：

- 作者首页：继续写作、待处理 proposal、待审草稿、最近章节和风险提醒。
- 首次使用向导：选择或创建作品工作区，扫描并解释识别结果。
- 设置页区分普通状态和高级排错，隐藏 raw JSON、hash、provider 细节。
- 阶段 A 浏览器访问型安装包落地：launcher、端口检测、后端启动、前端托管、用户数据目录和错误提示。
- 阶段 B 桌面窗口型安装包预研：Electron 或 Tauri、窗口生命周期、日志导出、更新机制和崩溃恢复。
- Docker 支持作为开发和自部署辅助路径，不替代本地优先安装包。

验收：

- 普通作者无需命令行即可启动阶段 A 包。
- 安装包不要求用户安装 Python、Node.js 或手动迁移数据库。
- 用户数据目录、作品工作区和应用安装目录相互隔离。
- 升级不覆盖用户作品、运行态和审计链路。

## 7. 测试矩阵

常规提交前：

```powershell
python -m compileall -q .\backend .\tests
python -m pytest -q
cd .\frontend
npm run build
```

前端交互变化：

```powershell
cd .\frontend
npm run e2e
```

前端可见文案变化还应运行 Vitest，确保中文优先防回退检查通过。

前端主题变化还应检查三套主题的首页、写作页和 AI 工作台：正文纸面文字必须清晰，顶部工具栏和发布门按钮位置稳定，窄屏无横向滚动，主题切换后不丢失当前工作流状态。

破坏性 E2E 重点：

- 快速切换正文草稿、章节标签和布局控制。
- 在未检查、未查看 diff、hash 变化或草稿不匹配时尝试写回。
- 输入无效模型配置、删除已分配模型档案、切换角色分配。
- 创建、暂停、恢复、推进、停止和删除 1-10 章 dry-run 流水线。

发布门或流水线变化：

```powershell
python -m backend.tools.sandbox_publish_smoke
python -m backend.tools.sandbox_pipeline_smoke --workspace runtime/sandbox_pipeline_workspace --chapters 3 --reset
```

模型治理变化：

```powershell
python -m backend.tools.probe_roles --roles writer reviewer fixer quick_fix memory long_context outliner structural_fix arbiter --key-file <local-key-file> --force
python -m backend.tools.model_usage_report --out runtime\logs\model_usage_report.md
```

CI 规则：

- push 或 pull request 到 `main` 时运行后端编译、pytest、前端构建和 Playwright E2E。
- CI 只使用沙盒工作区。
- CI 不依赖个人密钥、本机配置、真实小说目录或运行态产物。

## 8. 打包边界

系统包只包含：

- `backend/`
- `frontend/`
- `config/`
- `content/` 空模板占位
- `skills/` 通用规则
- `tests/`
- `docs/`
- 项目文档和依赖文件

系统包不包含：

- 真实小说正文、设定、大纲、章纲。
- 工作区运行态。
- 作品级 `skills/`。
- 个人密钥、本机配置、缓存和构建产物。

打包检查：

```powershell
python -m backend.tools.package_system --dry-run
python -m backend.tools.package_system --out <packages-dir>\novel_editor_system.zip
```

## 9. 后续实施顺序

建议顺序：

1. 修复 pipeline report 编码输出并补回归。
2. 做复制工作区单章显式发布门验收。
3. 完成作品档案模板和补全 proposal。
4. 完成单章写作卡确认和 writer 上下文接入。
5. 让 context report 稳定记录写作卡、skill、memory 和 generation mode。
6. 将 reviewer findings 和 fixer 输入结构化。
7. 补发布后章节摘要和短记忆 proposal。
8. 再扩展到对标/拆文资产、角色状态、伏笔、时间线和风格差异学习。

## 10. 开发决策准则

任何新功能合入前必须检查：

- 是否会绕过 proposal、artifact 或 publish gate。
- 是否把单一作品规则写入系统仓库。
- 是否能在模型不可用时保持人工编辑主流程可用。
- 是否有对应测试、沙盒验证或明确未运行原因。
- 是否会把个人配置、密钥、真实作品或运行态内容带入公开仓库。

如果答案不清楚，先补文档、测试或沙盒验证，不直接改真实作品。
