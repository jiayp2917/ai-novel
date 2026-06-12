个人虽是软件专业毕业但是没有进行过实际代码开发,日常工作为软件项目实施交付,本项目全部由ai进行编写,作为分享.
# 小说编辑器

本项目是本地运行的通用长篇小说生产工作台，用于管理多题材、多作品的设定、章纲、正文、批注、候选稿、审核、差异对比、发布门写回、短记忆、模型调用和自动流水线。

短期目标是支撑 20-30 万字小说跑通完整生产流程；长期目标是支撑百万字级别小说，通过分层记忆、伏笔、人物状态和发布审计降低长篇创作风险。项目不绑定单一小说，具体作品设定应留在对应工作区或计划文件中。

## 文档

- [用户手册](docs/用户手册.md)：写作者日常使用流程。
- [运维手册](docs/运维手册.md)：启动、key、工作区、沙盒、打包。
- [开发手册](docs/开发手册.md)：模块边界、发布门规则、测试矩阵。
- [通用长篇小说编辑器产品方案](docs/通用长篇小说编辑器产品方案.md)：通用产品定位、AI 生产流、人工编辑流、写作卡、风格学习和百万字扩展方向。
- [通用长篇小说编辑器理想蓝图方案](docs/通用长篇小说编辑器理想蓝图方案.md)：产品终局、模块边界、数据流、安全链路和分阶段落地路线。
- [Agnes 全流程验收与下一步计划](docs/Agnes全流程验收与下一步计划.md)：Agnes 全角色、破坏性测试、1-10 dry-run、修复清单和后续计划。
- [PRD](PRD.md)：产品需求。
- [AGENTS](AGENTS.md)：Codex 进入项目时必须遵守的规则。

## 支持的素材目录

Web 版同时支持三种工作区结构。

旧目录：

```text
00-系统/
01-设定/
02-正文/
03-章纲/
```

当前作品目录：

```text
00-设定/
01-大纲/
02-正文/
03-章纲/
```

新目录：

```text
content/settings/
content/outlines/
content/chapters/
```

源文件不迁移、不删除。模型输出和候选稿统一进入当前工作区的 `runtime/`；正文写回只能通过发布门执行。设定和章纲默认只生成提案，不通过普通发布接口覆盖源文件。

## 启动后端

普通启动：

```powershell
cd <repo-root>
pip install -r .\requirements.txt
python -m alembic upgrade head
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

带本机 `key.txt` 启动：

```powershell
cd <repo-root>
python -m backend.tools.run_backend_with_keys
```

`key.txt` 已被 `.gitignore` 忽略。不要把真实 key 写入文档、报告或提交。

健康检查：

```text
http://127.0.0.1:8000/health
```

手动启动沙盒或测试环境时，如果更换了 `APP_DB_PATH`，必须先执行迁移再启动后端；否则扫描、版本或批注接口可能因为数据库表未创建而返回 500：

```powershell
$env:CONTENT_ROOT='runtime/sandbox_workspace'
$env:APP_DB_PATH='runtime/e2e_runtime/e2e_app.db'
$env:RUNTIME_ROOT='runtime/e2e_runtime'
$env:ENABLE_TEST_SUPPORT='true'
python -m alembic upgrade head
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 18080
```

日常手测可直接使用 `python -m backend.tools.run_e2e_backend`，该脚本会创建沙盒工作区并先运行迁移。

## 启动前端

```powershell
cd <repo-root>\frontend
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

## 基本使用流程

### AI 主导生产流

1. 在工作区中准备作品档案、设定、总纲或卷纲；缺失信息可由 AI 生成 proposal，用户确认后才成为正式资料。
2. 基于正式设定和章纲生成逐章章纲，再生成单章写作卡。
3. 每章正文按“写作卡 -> 正文候选 artifact -> AI 审核/修复 -> 查看 diff -> 人工确认发布”的顺序推进。
4. 发布成功后，系统重新扫描并更新短记忆；风格学习只从 AI 初稿与用户确认稿的差异中生成 proposal。

### 人工主导编辑流

1. 打开前端，确认当前工作区是小说项目根目录。
2. 点击“重新扫描”，左侧应显示系统设定、小说设定、章纲和正文。
3. 进入“写作”，打开章节，直接编辑正文草稿或用右键菜单创建批注。
4. 点击“保存正文版本”。正文版本不会直接覆盖正式正文，发布前仍会做 diff、hash 和备份校验。
5. 人工正文版本不强制 AI 审核；确认改动后，可在“版本”里确认发布。
6. AI 生成或 AI 修订的草稿必须先进入“AI 工作台”执行检查，通过后才能确认写回。
7. “自动流水线”只作为辅助入口，用于批量生成、检查和修订草稿，默认以 dry-run 和人工确认优先，不干扰日常手写。

AI 辅助编辑结果应先生成候选；应用到当前编辑稿后仍只是未发布版本，正式写回仍需查看 diff 并人工确认。

## 前端六个入口

- 首页：查看当前作品、最近章节、待处理事项和快捷入口，不直接执行发布或模型调用。
- 写作：处理目录、正文编辑、批注、版本、记忆、保存正文版本和确认发布。
- AI 素材库：只读查看系统设定、小说设定和章纲，支持生成提案与查看对比；不展示正文，也不提供正文写回入口。
- AI 工作台：处理草稿检查、按批注修订、查看改动、确认写回和上下文预览。
- 自动流水线：批量生成、检查和修订的任务看板，优先用于 dry-run 验证和运行状态观察。
- 设置/模型：管理工作区、AI 写作/检查/修订等模型配置、连接测试、质量趋势、AI 用量、skills 和高级日志；密钥只显示保存状态，不回显明文。

后续 AI 主导生产流会围绕作品档案、单章写作卡、生成模式和风格差异学习逐步增强；这些长期资料均采用 proposal 后确认。

## 模型岗位与约束

默认路由：

- `writer` / `reviewer` / `fixer` / `quick_fix` / `memory` / `long_context` / `outliner` / `structural_fix` / `arbiter`：Agnes AI `agnes-2.0-flash`

`config/model_registry.yaml` 仍保留 DeepSeek、Kimi、Qwen、GLM 作为可配置后备供应商；当前默认优先级和真实 Agnes 验收均以 Agnes 为主路径。

约束：

- reviewer 只审核，不修文、不写文。
- writer 不决定审核是否通过。
- fixer 只修复审核授权的 writer 问题。
- 无证据问题必须转 `admin` 或人工处理。
- 本地日志 token/usage 是可见下限，真实消耗以供应商控制台为准。

AI 工作台会展示按分工统计、质量趋势、上下文裁剪提示和 skills 最近使用状态。没有足够样本时界面显示“数据不足”，不要把空数据当作 0% 结论。

仓库内 `skills/` 只保留通用生产规则。特定作品的风格、审核清单和长期偏好应放在外部小说工作区的 `skills/` 目录，不随系统代码提交。

模型探测：

```powershell
python -m backend.tools.probe_roles --roles writer reviewer fixer quick_fix memory long_context outliner structural_fix arbiter --key-file key.txt --force
```

模型统计报告：

```powershell
python -m backend.tools.model_usage_report --out runtime\logs\model_usage_report.md
```

## 验证命令

```powershell
python -m compileall -q .\backend .\tests
python -m pytest -q
cd .\frontend
npm run build
npm run e2e
```

当前 Agnes 全流程验收数据：

- Python 单元/集成测试：191 passed
- Playwright E2E：25 passed
- 前端构建：通过，已拆出 vendor/codemirror chunk
- Agnes 真实角色探针：9/9 通过，均为 `agnes-2.0-flash`
- 1-10 章 `full_auto` dry-run：最终 `manual_required`，失败复审阻断 publish/summary
- 原始作品 hash 复核：0 变更

## Agnes 1-10 dry-run 验证

最近一次复制工作区第 1-10 章 Agnes dry-run 报告保存在测试副本的 `runtime/reports/` 下。该报告属于本机验收材料，不随系统仓库提交。

结果摘要：
- 主测试库真实 Agnes 调用 82 次，全部成功。
- 1-10 章 dry-run 不真实写回，`publish_decisions=0`。
- Run 130 修复后 `done=20`、`manual_required=40`，发布链被失败复审正确阻断。
- 破坏性 UI 测试覆盖 Windows 非法路径、章节版本保存、设定/章纲 proposal 隔离。
- 原始作品工作区 hash 未变化。

## 沙盒验证

发布门沙盒：

```powershell
python -m backend.tools.sandbox_publish_smoke
```

流水线沙盒：

```powershell
python -m backend.tools.sandbox_pipeline_smoke --workspace runtime/sandbox_pipeline_workspace --chapters 3 --reset
```

沙盒命令不应触碰真实小说正文。

当前项目本地示例内容已从 `runtime/sandbox_workspace` 写回到 `content/settings`、`content/outlines`、`content/chapters`，用于本机手测。`content/` 下真实素材仍被 `.gitignore` 忽略，不随系统代码提交。

作品级 skill、正文、设定、章纲和运行态报告仍属于小说工作区；系统打包和代码提交不包含这些作品素材。

## 系统打包

打包只包含系统代码、`content/` 空模板占位和文档，不包含小说正文、设定、章纲、runtime、key 或 `.env`。

先看清单：

```powershell
python -m backend.tools.package_system --dry-run
```

生成压缩包：

```powershell
python -m backend.tools.package_system --out <packages-dir>\novel_editor_system.zip
```
