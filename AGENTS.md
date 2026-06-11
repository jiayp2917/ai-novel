# AGENTS.md

This file gives Codex project-level instructions for `D:\2917\numeric-monster`.

## Project Identity

This repository is the source code for a local Chinese novel editor named `小说编辑器`.

The system supports long-form web novel production: workspace scanning, settings and outline management, chapter editing, annotations, AI-generated candidates, reviews, diffs, publish-gate writes, memory, model calls, jobs, and dry-run pipeline validation.

Before substantial work, read the relevant parts of:

- `CLAUDE.md`: local engineering constraints.
- `PRD.md`: intended product workflows and publish gate semantics.
- `README.md`: startup, workspace structures, model roles, and validation commands.
- `docs/开发手册.md`: backend/frontend boundaries and test matrix.
- `D:\2917\plan\机制怪数值怪-小说与项目全流程工作计划.md`: current novel-production plan. Treat status facts in this file as potentially stale and re-check before acting.

## Non-Negotiable Safety Rules

- Do not read, print, copy, commit, or include contents from `key.txt`, `.env`, or API keys in reports.
- Do not directly edit real novel source files. Source writes are allowed only when the user explicitly asks for publish/writeback and the project publish flow is used.
- AI/model outputs must be saved as artifacts first. They must not directly modify source files.
- Chapter source writes must go through review, diff, explicit human confirmation, backup, and the publish gate.
- Settings, outlines, and chapter outlines are context/proposal inputs by default. Do not add ordinary direct-overwrite paths for them.
- Preserve artifacts, reviews, diffs, backups, model-call logs, events, publish decisions, and runtime reports unless the user explicitly asks for a safe cleanup.
- Automated pipeline work defaults to dry-run. Do not batch-publish real chapters unless the user explicitly authorizes that exact operation.
- Never use destructive Git or filesystem commands such as `git reset --hard`, broad recursive delete, or broad move operations without a precise target and explicit user approval.

## Repository And Workspace Boundaries

Keep the code repository, novel workspaces, runtime state, and test artifacts conceptually separate.

Repository-owned areas:

- `backend/`
- `frontend/`
- `config/`
- `skills/`
- `tests/`
- `docs/`
- root project docs and dependency files

Novel workspace-owned areas:

- legacy structure: `00-系统/`, `01-设定/`, `02-正文/`, `03-章纲/`
- current novel structure: `00-设定/`, `01-大纲/`, `02-正文/`, `03-章纲/`
- new content structure: `content/settings/`, `content/outlines/`, `content/chapters/`
- workspace `runtime/`

Prefer external novel workspaces under `D:\2917\novel-workspaces\作品名`. The current active novel workspace is:

```text
D:\2917\novel-workspaces\机制怪？我是数值怪
```

Avoid inspecting or quoting full real chapter prose unless the user asks for content review or writing work. Metadata checks, path checks, database state checks, and publish-gate verification are acceptable when needed.

## Current Novel Production Context

Current book direction:

- Modern 全民修仙.
- 主角许满：下品灵根表象，憨厚、实诚、迟钝。
- Core appeal: extreme body stats break the assumptions behind secret realms, arrays, exams, and tournament rules.
- Rules are not malicious. There is no system antagonist, no system patching, and no `禁止许满` style system ban.
- 林浅：天才阵修少女，负责专业解释和轻微暧昧。
- 王大雷：室友，负责吐槽和留影传播。
- 李燃：传统天才对照，前期嘴硬，后期偷偷研究许满的通关方式。

Current production checkpoint as of 2026-06-11; verify before relying on it:

- A1 three sample chapters under `D:\2917\plan\numeric-monster-a1-artifacts\` are `sample_only`; they are not publishable.
- A later real workflow created chapter source bindings for chapters 001-005 in the real workspace.
- Chapters 001-002 were written back through artifact, review, diff, backup, publish decision, and publish gate.
- Chapters 003-005 should be treated as not yet published unless current database and file checks prove otherwise.
- Any artifact missing `base_chapter_id`, `base_source_file_hash`, or `base_chapter_version_id` cannot enter publish.

The helper `backend/tools/real_chapter_batch_publish.py` may exist as an ad hoc, high-risk batch tool. Do not run, keep, commit, or extend it without first re-reviewing it and confirming the user explicitly wants that real publish operation. Prefer sandbox validation before real workspace writes.

## Model Role Rules

Logical model roles must stay isolated:

- `reviewer`: reviews only; must not rewrite or create prose.
- `writer`: creates prose candidates only; must not decide whether content passes review.
- `fixer` / `quick_fix`: fixes only reviewer-authorized writer issues with concrete evidence and clear fix instructions.
- `memory` / `long_context`: compresses or compiles context only; must not create story content.
- `outliner` / `structural_fix`: handles outlines and structure proposals; source writes still require user confirmation.
- `arbiter`: manual/high-risk decision support only; never an automatic publish bypass.

Review outputs must be evidence constrained. Issues without concrete evidence must be routed to `admin` or manual handling, not automatic fixing.

Known default role routes from the current docs and recent model-call records:

- `writer` / `quick_fix`: Kimi `kimi-k2.6`
- `reviewer`: DeepSeek `deepseek-v4-pro`
- `memory` / `long_context`: Qwen `qwen3.6-plus`
- `outliner` / `arbiter`: Qwen `qwen3.6-max-preview`
- `structural_fix`: GLM `glm-5.1`

These routes can be overridden by runtime config. Confirm via settings, runtime config, or `model_calls` when the exact model matters.

## Development Workflow

Prefer small, verifiable changes.

Before edits:

- Read the relevant files first.
- State assumptions when the request is ambiguous.
- Keep unrelated refactors out of the change.
- Check `git status --short --branch` and do not overwrite unrelated user changes.

After edits, run the narrowest relevant checks. Common checks:

```powershell
python -m compileall -q .\backend .\tests
python -m pytest -q
cd frontend
npm run build
```

For frontend interaction changes, add or update Playwright coverage when practical:

```powershell
cd frontend
npm run e2e
```

For publish/workflow changes, prefer sandbox validation before touching real content:

```powershell
python -m backend.tools.sandbox_publish_smoke
python -m backend.tools.sandbox_pipeline_smoke --workspace runtime/sandbox_pipeline_workspace --chapters 3 --reset
```

If a task intentionally writes to the real novel workspace, report:

- what was generated or modified
- artifact/review/diff/publish decision IDs when available
- backup path
- whether `02-正文`, `runtime`, `key.txt`, or `.env` were touched
- whether the next stage is safe to proceed

## Frontend Product Expectations

The target user is a writer with basic computer skills, not an engineer.

Prioritize:

- Large, unobstructed writing area.
- Clear six-entry navigation: 首页、写作、AI 素材库、AI 工作台、自动流水线、设置/模型。
- Right-click actions for annotation and draft operations.
- Clear catalog tree.
- Hideable side panels.
- Separate writing UI from model/task UI.
- Chinese UI text with explicit success/failure/progress feedback.
- Safe defaults: AI records, raw model details, provider/token fields, task IDs, and JSON should stay in advanced/debug areas.

Avoid decorative UI or engineering-heavy controls that slow daily writing.

## Current Priority

Current priority order:

1. Verify real chapter source binding and publish-gate state before continuing real writing.
2. Use sandbox flows to validate risky pipeline or publish changes.
3. Produce usable chapter candidates in small batches, with review and diff before any writeback.
4. Keep writer/reviewer skills synchronized with the modern 全民修仙 direction.
5. Improve observability only where it helps the author recover from failures.
6. Keep documentation and tests synchronized with actual behavior.

Do not do broad legacy cleanup, model-router redesign, new major features, or novel outline expansion unless the user asks.

## Reporting Rules

When giving findings:

- Lead with the decision, current state, or risk.
- Include concrete file paths, IDs, or command results.
- Distinguish facts from assumptions.
- If evidence is missing, say so.
- Keep reports concise enough to be actionable.
