# ai-novel 小说编辑器

个人虽是软件专业毕业但是没有进行过实际代码开发，日常工作为软件项目实施交付，本项目全部由 AI 进行编写，作为分享。

`ai-novel` 是本地运行的通用长篇小说 AI 辅助创作工作台，用于管理多题材、多作品的设定、章纲、正文、批注、候选稿、审核、差异对比、发布门写回、短记忆、模型调用和自动流水线。

项目短期目标是支撑 20-30 万字小说跑通完整生产流程；长期目标是支撑百万字级别小说，通过分层记忆、伏笔、人物状态和发布审计降低长篇创作风险。项目不绑定单一小说，具体作品设定应保存在对应工作区中。

## 文档

- [ai-novel 使用手册](docs/ai-novel使用手册.md)：启动、配置、工作区、页面入口、作者流程、发布门和常见问题。
- [ai-novel 设计方案](docs/ai-novel设计方案.md)：产品定位、信息架构、AI 写作流程、安全边界、交付形态和长期蓝图。
- [ai-novel 开发计划](docs/ai-novel开发计划.md)：当前状态、Agnes 验收结论、迭代路线、开源治理和测试矩阵。

## 快速启动

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

打开：

```text
http://127.0.0.1:5173
```

如果需要使用 Agnes AI，在本机环境中配置 `AGNES_BASE_URL` 和 `AGNES_API_KEY`。默认模型路径以 Agnes AI 为主，其他供应商保留为可配置后备。

默认后端按本机工具设计，所有会改变状态、触发 AI 调用或写回正文的接口只允许本机访问。若要通过局域网、容器或反向代理访问，请同时配置 `ADMIN_API_TOKEN` 和前端构建环境变量 `VITE_ADMIN_API_TOKEN`。

## 工作区

推荐把系统代码和小说工作区分开：`<repo-root>` 只放系统代码，`<workspace-root>\作品名` 放小说正文、设定、章纲、作品级 skill 和运行态。运行时使用 `content/settings`、`content/outlines`、`content/chapters` 结构；历史目录迁移说明见 [ai-novel 使用手册](docs/ai-novel使用手册.md)。

模型输出和候选稿统一进入工作区运行态目录；正文写回只能通过发布门执行。设定、大纲、章纲、作品档案、长期记忆和风格规则默认先生成 proposal，用户确认后才成为正式资料。

## 基本流程

AI 主导生产：

```text
作品档案
-> 设定/大纲/章纲 proposal
-> 单章写作卡
-> 正文候选 artifact
-> reviewer 审核
-> fixer 修订
-> diff
-> 人工确认发布
-> 短记忆和风格 proposal
```

人工主导编辑：

```text
打开工作区
-> 扫描素材
-> 写作页编辑章节
-> 保存正文版本
-> 查看 diff
-> 人工确认发布
```

自动流水线定位为章节候选生产和安全门验证，默认 dry-run，不是无人值守全书发布器。

## 验证

最小检查：

```powershell
python -m compileall -q .\backend .\tests
python -m pytest -q
cd .\frontend
npm run build
```

前端交互、发布门、流水线或模型治理变化的完整测试矩阵见 [ai-novel 开发计划](docs/ai-novel开发计划.md)。
