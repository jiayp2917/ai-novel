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
3. 点击“重建短记忆”，生成核心事实、章卡、正文摘要和结构化状态。
4. 打开正文，编辑草稿或用右键菜单创建批注。
5. 保存候选。候选只写入 `runtime/artifacts/`，不会覆盖正文。
6. 对候选执行审核。
7. 查看 diff。
8. 人工确认发布。发布前会生成 backup 和 diff。

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

当前阶段验收数据：

- Python 单元/集成测试：127 passed
- Playwright E2E：4 passed
- 前端构建：通过，已拆出 vendor/codemirror chunk

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
