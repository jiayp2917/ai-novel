# backend.tools 工具边界

`backend.tools` 存放本地启动、沙盒验证、迁移和发布前审计工具。这里的脚本不是普通业务 API，但有一部分仍被 Playwright、测试支持路由或后端 API 复用，因此暂不整体移动。

## 可用于日常本地开发

- `run_backend_with_keys.py`：本地后端启动入口，会读取本机 key 文件并只打印已加载变量名。
- `run_e2e_backend.py` / `create_e2e_workspace.py`：Playwright E2E 专用，生成 `content/settings`、`content/outlines`、`content/chapters` 新结构沙盒。
- `sandbox_publish_smoke.py` / `sandbox_pipeline_smoke.py`：沙盒发布门与流水线 smoke 验证，只应指向 sandbox 工作区。
- `probe_roles.py` / `probe_model.py`：本机模型连通性探针，不提交密钥、不写真实作品。

## 迁移、审计和打包

- `workspace_migrate.py`：把历史 `00/01/02/03` 作品目录迁移到新 `content/*` 结构。主应用不再自动扫描旧布局。
- `workspace_boundary_report.py`：盘点工作区边界，帮助确认真实作品、runtime 和系统代码没有混在一起。
- `package_system.py`：打包系统代码时排除真实作品目录、runtime、密钥和缓存。
- `production_pipeline_validate.py`：受控验收工具，默认 dry-run；涉及真实模型或真实工作区前必须先确认。
- `real_chapter_batch_publish.py`：高风险批量写回工具，必须显式传入发布参数，只能在用户明确授权的测试副本或目标工作区使用。

## 稳定导入约定

- `model_usage_report.py` 的统计函数当前被 `/api/jobs/model-usage-report` 和测试引用，属于稳定导入路径。
- `key_env.py` 是本机密钥加载辅助，只能报告变量名与状态，不能打印密钥内容。
