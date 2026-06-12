# ai-novel 使用手册

本文面向写作者、本机部署者和准备试用项目的用户，说明如何启动、配置、使用和避免误写回真实作品。

## 1. 使用前理解

`ai-novel` 是本地优先的长篇小说创作工作台。一个作品对应一个独立工作区，作品自己的设定、正文、章纲、运行态、记忆和风格规则都应保存在该工作区中。

核心安全原则：

- AI 输出先保存为 proposal、artifact 或正文版本，不直接覆盖源文件。
- 正文写回必须经过 diff、备份、人工确认和发布门。
- 设定、大纲、章纲、作品档案、长期记忆和风格规则默认先生成 proposal。
- 自动流水线默认 dry-run，用于批量候选生产和流程验证，不做无人值守全书发布。
- 模型不可用时，人工写作、保存版本、查看 diff 和发布手写版本仍应可用。
- 普通界面文案中文优先；英文主要保留在产品名、模型名、路径、命令、环境变量、API/JSON 字段、调试信息、用户原文和第三方系统提示中。

## 2. 启动

后端：

```powershell
cd <repo-root>
pip install -r .\requirements.txt
python -m alembic upgrade head
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

前端：

```powershell
cd <repo-root>\frontend
npm install
npm run dev
```

打开前端：

```text
http://127.0.0.1:5173
```

健康检查：

```text
http://127.0.0.1:8000/health
```

也可以使用项目自带的本机启动工具读取本机密钥配置并启动后端：

```powershell
python -m backend.tools.run_backend_with_keys
```

## 3. 模型配置

默认 AI 路径是 Agnes AI，主要角色使用 `agnes-2.0-flash`。本机需要配置：

- `AGNES_BASE_URL`
- `AGNES_API_KEY`

管理接口默认只允许本机使用。如果后端要暴露给局域网、容器或反向代理，必须配置：

- `ADMIN_API_TOKEN`
- `VITE_ADMIN_API_TOKEN`

这些变量都属于本机配置，不应写入公开文档、报告、日志或提交记录。界面只应显示“已配置/未配置”等状态，不回显密钥明文。

模型探测：

```powershell
python -m backend.tools.probe_roles --roles writer reviewer fixer quick_fix memory long_context outliner structural_fix arbiter --key-file <local-key-file> --force
```

模型统计报告：

```powershell
python -m backend.tools.model_usage_report --out runtime\logs\model_usage_report.md
```

本地 token 和 usage 记录只是应用可见下限，真实消耗以供应商控制台为准。

## 4. 工作区结构

推荐长期结构：

```text
<repo-root>\              # 系统代码
<workspace-root>\作品名\   # 小说工作区
```

支持三种素材目录结构。

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

content 目录：

```text
content/settings/
content/outlines/
content/chapters/
```

运行态建议留在作品工作区内部：

```text
runtime/
  artifacts/
  backups/
  diffs/
  logs/
  reports/
  app.db
```

作品级 skill 也应放在作品工作区中。系统仓库只保留通用规则，不提交某本书的专属风格、审核清单或长期偏好。

## 5. 页面入口

- 首页：当前作品状态、最近章节、待处理事项和快捷入口。
- 写作：目录、正文编辑、批注、搜索、保存正文版本、版本历史、diff 和发布确认。
- AI 素材库：只读查看设定、大纲、章纲和作品资料，生成 proposal 并查看差异。
- AI 工作台：处理正文候选、审核、修订、复审、查看 diff 和确认写回。
- 自动流水线：批量创建和推进章节任务，默认 dry-run，观察每章状态和失败原因。
- 设置/模型：工作区、模型连通、质量趋势、调用用量、上下文预算、skills 和高级日志。

## 6. 人工主导写作

适合把应用当作可靠的小说文档编辑器使用。

```text
打开或选择工作区
-> 重新扫描
-> 进入写作页
-> 打开章节
-> 编辑正文
-> 保存正文版本
-> 查看 diff
-> 人工确认发布
```

规则：

- 保存正文版本不会立刻覆盖正式正文。
- 人工正文版本可以不经过 AI 审核，但仍必须通过本地校验、diff、备份和人工确认。
- 模型不可用时，人工写作主流程仍应可用。
- AI 选区扩写、润色、校验和修订结果先成为候选；应用到编辑稿后也只是未发布版本。

## 7. AI 主导生产

适合从构思、设定、大纲、章纲推进到正文初稿。

```text
作品档案
-> 设定 proposal
-> 大纲 proposal
-> 逐章章纲 proposal
-> 单章写作卡
-> 正文 artifact
-> reviewer 审核
-> fixer 修订
-> 复审
-> diff
-> 人工确认发布
-> 短记忆和风格 proposal
```

用户只需要关注三件事：AI 结果先看再用，正文草稿先审再发，设定和章纲先生成 proposal 再确认。具体角色边界见 [ai-novel 设计方案](ai-novel设计方案.md)。

## 8. 发布门

正文发布门的用户含义是：先选择候选或正文版本，查看 diff，确认备份和风险，再人工确认写回。AI 草稿必须先审核通过；人工正文版本可以跳过 AI 审核，但不能跳过 diff、备份和确认。

强制发布只能放宽 AI review 结论，不能绕过候选绑定、hash 校验、diff、backup、人工确认、发布记录和事件审计。

## 9. 自动流水线

自动流水线用于批量生成、检查和修订章节候选，适合沙盒验证、小批量 dry-run 和运行状态观察。

典型流程：

```text
选择章节范围
-> 选择模式
-> 创建任务
-> 推进队列
-> 查看每章状态
-> 人工处理 manual_required
-> 需要写回时回到单章发布门
```

安全默认：流水线只生产草稿、审核结果、修订候选和报告；真实写回应回到单章 diff 和人工确认。

## 10. 沙盒验证

发布门沙盒：

```powershell
python -m backend.tools.sandbox_publish_smoke
```

流水线沙盒：

```powershell
python -m backend.tools.sandbox_pipeline_smoke --workspace runtime/sandbox_pipeline_workspace --chapters 3 --reset
```

沙盒命令只用于测试工作区，不应触碰真实小说正文。

## 11. 常见问题

### 看不到章节

确认工作区中存在受支持的素材目录，并点击重新扫描。正文文件需要可识别的章节标题；非标准 Markdown 会在写作页提示处理方式。

### 模型调用失败

检查 Agnes 相关环境变量是否存在、网络是否可用、供应商是否返回错误，以及预算或管理策略是否暂停。失败原因优先在 AI 工作台、设置/模型和后端日志中查看。

### 质量趋势显示“数据不足”

这表示当前样本太少，系统不能判断某个 AI 岗位是否稳定。继续执行 AI 写作、审核、修订和复审后，才会出现证据率、字数达标率、复审通过率等数据。

### 不想改真实正文

只生成 proposal、artifact 或正文版本，不点击发布确认。做破坏性测试时使用复制工作区或沙盒工作区。

### 能否把作品放在仓库里

开发调试可以使用仓库内示例内容，但长期真实作品建议放在仓库外部的独立工作区，避免把正文、设定、运行态、密钥状态或作品级规则混进系统代码。

## 12. 开发者验证

普通使用者不需要运行测试。开发者提交前的完整测试矩阵见 [ai-novel 开发计划](ai-novel开发计划.md)。
