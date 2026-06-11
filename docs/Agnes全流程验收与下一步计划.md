# Agnes 全流程验收与下一步计划

本文记录当前 `ai-novel` 工作树的 Agnes 全流程验证结论、已修复问题和下一步工程计划。它只保存可公开的工程摘要，不包含 API key 明文，不复制测试小说正文。

## 验收环境

- 项目路径：`D:\2917\ai-novel`
- 复制测试工作区：`D:\chat\novel-workspaces\_test-ai-novel-destructive-20260611-221838`
- 原始作品工作区：`D:\chat\novel-workspaces\机制怪？我是数值怪`
- 后端：`http://127.0.0.1:8000`
- 前端：`http://127.0.0.1:15173`
- 详细测试报告：`D:\chat\novel-workspaces\_test-ai-novel-destructive-20260611-221838\runtime\reports\destructive_1_10_agnes_test_report.md`

## 当前结论

- Agnes 全角色探针通过：`writer`、`reviewer`、`fixer`、`quick_fix`、`memory`、`long_context`、`outliner`、`structural_fix`、`arbiter` 均为 `agnes-2.0-flash`。
- 主测试库累计真实 Agnes 调用 `82` 次，全部 `succeeded`，未 fallback 到其它供应商。
- 1-10 章 `full_auto` dry-run 修复后以 `manual_required` 收束；失败复审会阻断 publish/summary。
- 原始作品 hash 复核为 0 变更。
- E2E 使用独立 sandbox，与 Agnes 真实副本测试分开记录。

## 已修复问题

1. Windows 非法路径组件未拦截。
   - 修复：新增路径组件校验，覆盖非法字符、保留设备名、末尾空格和末尾点。
   - 覆盖：`tests/test_workspace_api.py`。

2. 子任务异常后父流水线状态可能不刷新。
   - 修复：`PipelineTaskExecutor` 异常路径也刷新父任务。
   - 覆盖：`tests/test_pipeline_api.py`。

3. 最终复审 writer-only 问题可能继续进入发布链。
   - 修复：只有存在依赖 fixer 时才继续，否则进入 `manual_required`。
   - 覆盖：`tests/test_pipeline_api.py`。

4. 新增素材弹窗旧错误提示残留。
   - 修复：切换类型、编辑字段、取消关闭时清空 inline error。
   - 覆盖：`frontend/e2e/novel-editor.spec.ts`。

5. 写作卡不能识别 Markdown 表格章纲行。
   - 修复：章纲提取支持表格行。
   - 覆盖：`tests/test_source_proposals.py`。

## 沙盒内容写回

本机示例内容已从 `runtime/sandbox_workspace` 同步到：

```text
content/settings/
content/outlines/
content/chapters/
```

这些内容用于本机手测。`.gitignore` 仍忽略 `content/` 下真实素材和 `content/runtime/`，代码提交不包含小说正文、设定、章纲或运行态产物。

作品级 skill 已与系统仓库拆分：`numeric_xianxia_style.md` 和 `numeric_xianxia_review_checklist.md` 已迁到 `D:\chat\novel-workspaces\机制怪？我是数值怪\skills\`，仓库默认 `skills/` 只保留通用规则。

## 验证命令

当前通过的验证：

```powershell
python -m compileall -q .\backend .\tests
python -m pytest -q
cd D:\2917\ai-novel\frontend
npm run build
npm run e2e
```

结果：

- Python 单元/集成测试：`191 passed`
- Playwright E2E：`25 passed`
- 前端构建：通过

## 剩余风险

- 1-10 章当前为 dry-run，主测试库没有真实 `publish_decision`；需要独立执行“一章复制副本显式确认发布”验收。
- `runtime/reports/pipeline_run_62.json` 轻量报告曾出现编码损坏，应修复报告写出并增加 UTF-8 JSON parse 回归。
- `production_validation` 历史目录包含旧供应商调用，不纳入 Agnes-only 统计。
- 自动流水线目前仍是章节候选生产和安全门验证，不应描述为无人值守全书发布。

## 下一步计划

1. 修复轻量 pipeline report 编码输出，增加 UTF-8 JSON parse 回归。
2. 增加复制工作区“一章显式确认发布”测试，必须生成 publish decision、diff、backup，并复核原始作品 hash 不变。
3. 把 1-10 `manual_required` 原因聚合成章节级报告，再扩到 1-20 dry-run。
4. 明确 memory/summary 在 dry-run 与 post-publish 的边界，让 Agnes 的 `memory` 角色进入可观测链路。
5. 增加 UI 破坏性用例：超长文件名、Windows 保留名、并发保存/发布、外部修改导致 hash stale、AI 超时重试。
6. 固化发布前检查表：sandbox E2E、Agnes role probe、Agnes dry-run pipeline、复制副本发布门四类结果分开记录。
