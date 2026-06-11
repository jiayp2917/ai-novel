# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 通用编码准则

**权衡：** 这些准则偏向谨慎而非速度。对于简单任务，请使用判断力。

### 1. 编码前思考

**不要假设。不要隐藏困惑。主动暴露权衡。**

实现前：
- 明确陈述你的假设。不确定时提问。
- 存在多种解释时，提出它们，不要默默选择。
- 存在更简单方案时说出来。有理由时要反驳。
- 有不清楚的地方停下来，指出困惑点并提问。

### 2. 简洁优先

**解决问题的最少代码。不要投机。**

- 不添加超出需求的功能。
- 不为单用途代码创建抽象。
- 不添加未请求的"灵活性"或"可配置性"。
- 不为不可能的场景添加错误处理。
- 如果200行能写成50行，就重写。

自问："高级工程师会说这太复杂吗？"如果是，简化。

### 3. 精准改动

**只触碰必须改动的。只清理自己的烂摊子。**

编辑现有代码时：
- 不要"改进"相邻代码、注释或格式。
- 不要重构没坏的东西。
- 匹配现有风格，即使你会用不同方式。
- 注意到无关的死代码时，提出它，不要删除。

当改动产生孤立代码时：
- 移除你的改动导致未使用的 import/变量/函数。
- 不要删除预先存在的死代码，除非被要求。

验证标准：每一行改动都可追溯到用户请求。

### 4. 目标驱动执行

**定义成功标准，循环验证直到完成。**

将任务转化为可验证的目标：
- "添加验证" → "为无效输入写测试，然后让测试通过"
- "修复 bug" → "写一个复现 bug 的测试，然后让测试通过"
- "重构 X" → "确保重构前后测试都通过"

对于多步骤任务，陈述简要计划：
```
1. [步骤] → 验证: [检查]
2. [步骤] → 验证: [检查]
3. [步骤] → 验证: [检查]
```

强成功标准让你能独立循环。弱标准（"让它工作"）需要持续澄清。

---

## 项目概述

这是一个**本地小说编辑器**，用于长篇小说的创作和管理。系统包含：
- **FastAPI 后端**：处理 AI 模型调用、数据库操作、文件管理
- **React 前端**：交互式编辑器界面（CodeMirror）
- **Pipeline 系统**：AI 驱动的创作流程（写作 → 候选 → 审核 → 发布）

## 启动命令

### 后端启动
```powershell
cd D:\2917\ai-novel
pip install -r .\requirements.txt
python -m alembic upgrade head
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# 带 API Key 启动
python -m backend.tools.run_backend_with_keys
```

### 前端启动
```powershell
cd frontend
npm install
npm run dev  # http://127.0.0.1:5173
```

### 测试命令
```powershell
# Python 测试
python -m pytest -q

# 前端构建
cd frontend && npm run build

# E2E 测试
cd frontend && npm run e2e
```

## 架构要点

### 后端结构 (`backend/app/`)
```
├── api/           # FastAPI 路由
│   ├── annotations.py    # 批注管理
│   ├── artifacts.py      # 候选稿管理
│   ├── pipeline.py       # Pipeline 控制
│   ├── workspace.py      # 工作区扫描
│   └── ...
├── services/      # 业务逻辑
│   ├── pipeline/          # Pipeline 核心
│   │   ├── executor.py    # 执行器
│   │   ├── reviewer.py    # 审核器
│   │   ├── writer.py      # 写作者
│   │   ├── fixer.py       # 修复器
│   │   └── state_machine.py  # 状态机
│   ├── model_*.py        # 模型相关
│   └── memory.py          # 短记忆
├── core/config.py        # 配置管理
└── db/                   # 数据库模型
```

### 前端结构 (`frontend/src/`)
```
├── App.tsx         # 主应用
├── store.ts        # Zustand 状态
├── api.ts          # API 调用
├── hooks.ts        # React hooks
└── components/     # UI 组件
```

### 关键数据流
1. 前端扫描工作区 → 后端读取文件系统
2. 用户创建批注 → 后端存储数据库
3. AI 生成候选 → 写入 `runtime/artifacts/`
4. 人工审核 → 通过发布门写回正文

### 工作区目录结构
```
content/           # 源文件（设定、章纲、正文）
runtime/           # 运行时数据
├── artifacts/     # AI 生成的候选稿
├── diffs/         # 差异对比
├── backups/       # 发布前备份
└── app.db         # SQLite 数据库
```

## 模型岗位配置

| 岗位 | 默认模型 |
|------|----------|
| writer / reviewer / fixer / quick_fix / memory / long_context / outliner / structural_fix / arbiter | agnes-2.0-flash |

覆盖示例：`FIXER_PROVIDER=glm` 或 `FIXER_MODEL=glm-5.1`。DeepSeek、Kimi、Qwen、GLM 保留为可配置后备供应商。

## 配置

配置通过 `backend/app/core/config.py` 管理，支持环境变量：
- `CONTENT_ROOT`：小说内容目录
- `RUNTIME_ROOT`：运行时目录
- `LOW_COST_MODE`：低成本模式
- `AGNES_API_KEY` / `AGNES_BASE_URL`：Agnes AI 默认路径
- `KIMI_THINKING_MODE=disabled` / `GLM_THINKING_MODE=disabled`：禁用思考模式
- `DAILY_MAX_MODEL_CALLS` / `DAILY_MAX_ESTIMATED_COST`：成本控制

## 调试工具

沙盒验证：
```powershell
python -m backend.tools.sandbox_publish_smoke
```

模型探测：
```powershell
python -m backend.tools.probe_roles --roles writer reviewer fixer quick_fix memory long_context outliner structural_fix arbiter --key-file key.txt --force
```

模型使用报告：
```powershell
python -m backend.tools.model_usage_report --out runtime\logs\report.md
```
