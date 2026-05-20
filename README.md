# 小说编辑器

本项目是本地运行的长篇小说生产工作台，用于管理设定、章纲、正文、批注、候选稿、审核、差异对比、发布门写回、短记忆、模型调用和自动流水线。

## 文档

- [用户手册](docs/用户手册.md)：写作者日常使用流程。
- [运维手册](docs/运维手册.md)：启动、key、工作区、沙盒、打包。
- [开发手册](docs/开发手册.md)：模块边界、发布门规则、测试矩阵。
- [PRD](PRD.md)：产品需求。
- [AGENTS](AGENTS.md)：Codex 进入项目时必须遵守的规则。

## 支持的素材目录

Web 版同时支持两种工作区结构。

旧目录：

```text
00-系统/
01-设定/
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
cd D:\2917\numeric-monster
pip install -r .\requirements.txt
python -m alembic upgrade head
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

带本机 `key.txt` 启动：

```powershell
cd D:\2917\numeric-monster
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
cd D:\2917\numeric-monster\frontend
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

## 基本使用流程

1. 打开前端，确认当前工作区是小说项目根目录。
2. 点击“重新扫描”，左侧应显示系统设定、小说设定、章纲和正文。
3. 进入“写作”，打开章节，直接编辑正文草稿或用右键菜单创建批注。
4. 点击“保存正文版本”。正文版本不会直接覆盖正式正文，发布前仍会做 diff、hash 和备份校验。
5. 人工正文版本不强制 AI 审核；确认改动后，可在“版本”里确认发布。
6. AI 生成或 AI 修订的草稿必须先进入“AI 工作台”执行检查，通过后才能确认写回。
7. “自动流水线”只作为辅助入口，用于批量生成、检查和修订草稿，默认以 dry-run 和人工确认优先，不干扰日常手写。

## 前端六个入口

- 首页：查看当前作品、最近章节、待处理事项和快捷入口，不直接执行发布或模型调用。
- 写作：处理目录、正文编辑、批注、版本、记忆、保存正文版本和确认发布。
- AI 素材库：只读查看系统设定、小说设定和章纲，支持生成提案与查看对比；不展示正文，也不提供正文写回入口。
- AI 工作台：处理草稿检查、按批注修订、查看改动、确认写回和上下文预览。
- 自动流水线：批量生成、检查和修订的任务看板，优先用于 dry-run 验证和运行状态观察。
- 设置/模型：管理工作区、模型连通测试、质量趋势、调用用量、skills 和高级日志。

## 模型岗位与约束

默认路由：

- `reviewer`：DeepSeek `deepseek-v4-pro`
- `quick_fix` / `writer` / `fixer`：Kimi `kimi-k2.6`
- `long_context` / `memory`：Qwen `qwen3.6-plus`
- `structural_fix`：GLM `glm-5.1`
- `arbiter` / `outliner`：Qwen `qwen3.6-max-preview`

约束：

- reviewer 只审核，不修文、不写文。
- writer 不决定审核是否通过。
- fixer 只修复审核授权的 writer 问题。
- 无证据问题必须转 `admin` 或人工处理。
- 本地日志 token/usage 是可见下限，真实消耗以供应商控制台为准。

AI 工作台会展示按分工统计、质量趋势、上下文裁剪提示和 skills 最近使用状态。没有足够样本时界面显示“数据不足”，不要把空数据当作 0% 结论。

模型探测：

```powershell
python -m backend.tools.probe_roles --roles reviewer quick_fix long_context structural_fix --force
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

当前 remake1.0 阶段验收数据：

- Python 单元/集成测试：163 passed
- Playwright E2E：19 passed
- 前端构建：通过，已拆出 vendor/codemirror chunk

## 生产级 dry-run 验证

最近一次真实工作区第 1-10 章 dry-run 报告：

```text
D:\2917\novel-workspaces\作品名\runtime\production_validation\reports\production_pipeline_validate_20260519134440.md
```

结果摘要：
- 状态：completed，正文源文件 hash 未变化，真实发布写回 0 次。
- 章节通过率：80.00%，第 8、10 章进入 manual_required。
- 模型调用失败率：writer、reviewer、quick_fix 均为 0。
- 日志可见 token 下限：writer 204205，reviewer 58814，quick_fix 22899。
- 当前样本未显示某模型明显优于默认岗位模型，模型路由保持不变。

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

## 系统打包

打包只包含系统代码、`content/` 空模板占位和文档，不包含小说正文、设定、章纲、runtime、key 或 `.env`。

先看清单：

```powershell
python -m backend.tools.package_system --dry-run
```

生成压缩包：

```powershell
python -m backend.tools.package_system --out D:\2917\packages\novel_editor_system.zip
```
