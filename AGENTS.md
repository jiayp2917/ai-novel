# AGENTS.md

This file gives Codex project-level instructions for this repository.

## Project Identity

This repository is the source code for a local Chinese novel editor named `小说编辑器`.

The product is a general-purpose long-form Chinese novel workspace. It is not tied to any single book. Short-term workflows should support complete 200k-300k word novels across multiple genres; long-term architecture should support million-word projects through layered memory, outline discipline, review records, and publish-gate writes.

Before substantial work, read the relevant parts of:

- `CLAUDE.md`: local engineering constraints.
- `PRD.md`: intended product workflows and publish gate semantics.
- `README.md`: startup, workspace structures, model roles, and validation commands.
- `docs/ai-novel使用手册.md`: user startup, workspace, and publish-gate usage.
- `docs/ai-novel设计方案.md`: current product direction and safety boundaries.
- `docs/ai-novel开发计划.md`: implementation priorities, engineering boundaries, and test matrix.

Specific book context belongs in the active novel workspace or external planning files. Do not promote a specific book's setting, characters, chapter status, or style into repository-wide rules unless the user explicitly asks for a generic template.

## Non-Negotiable Safety Rules

- Do not read, print, copy, commit, or include contents from `key.txt`, `.env`, or API keys in reports.
- Do not directly edit real novel source files. Source writes are allowed only when the user explicitly asks for publish/writeback and the project publish flow is used.
- AI/model outputs must be saved as artifacts or proposals first. They must not directly modify source files.
- Chapter source writes must go through review, diff, explicit human confirmation, backup, and the publish gate.
- Settings, outlines, chapter outlines, long-term memory supplements, and style rules are proposal-first. Do not add ordinary direct-overwrite paths for them.
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

Repository `skills/` must stay generic. Book-specific style rules, review checklists, and long-lived preferences belong in the active novel workspace's `skills/` directory and must not be committed to the system repository.

Novel workspace-owned areas:

- legacy structure: `00-系统/`, `01-设定/`, `02-正文/`, `03-章纲/`
- current project structure: `00-设定/`, `01-大纲/`, `02-正文/`, `03-章纲/`
- new content structure: `content/settings/`, `content/outlines/`, `content/chapters/`
- workspace `skills/` for book-specific style/review/memory rules
- workspace `runtime/`

Prefer external novel workspaces outside the code repository. Avoid inspecting or quoting full real chapter prose unless the user asks for content review or writing work. Metadata checks, path checks, database state checks, and publish-gate verification are acceptable when needed.

## Product Direction

The product has two primary modes:

- AI-led production flow: idea intake, settings proposal, outline proposal, chapter-outline proposal, chapter writing card, chapter draft artifact, review, fix, diff, human confirmation, publish, memory/style proposal.
- Human-led editor flow: document editing, chapter version save, annotations, search, copy/delete/recover, AI-assisted expansion/polish/checking, diff, and manual publish.

Core product rules:

- The smallest real prose production unit is one chapter.
- Batch workflows may queue many single-chapter jobs, but must not merge cross-chapter artifacts or batch-publish real prose by default.
- Writer prompts should prefer confirmed chapter writing cards, concise setting summaries, recent memory, and short production skills over dumping full outlines or long style samples.
- Generation mode should be explicit when implemented: stable/cost-saving by default, quality-first for stricter review, speed-first for more manual review.
- Style learning should be derived from differences between AI drafts and user-confirmed revisions. It must produce a style proposal first and only affect the current work after user confirmation.
- Long-form and million-word support should rely on layered summaries, character state, clue lifecycle, timeline, and retrieval, not full-book prompt stuffing.

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

- `writer` / `reviewer` / `fixer` / `quick_fix` / `memory` / `long_context` / `outliner` / `structural_fix` / `arbiter`: Agnes AI `agnes-2.0-flash`

DeepSeek、Kimi、Qwen、GLM remain configurable fallback providers. These routes can be overridden by runtime config. Confirm via settings, runtime config, or `model_calls` when the exact model matters.

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

If a task intentionally writes to a real novel workspace, report:

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
- Chinese-first visible UI copy（中文优先）. All ordinary user-facing frontend text must be Chinese by default, with explicit success/failure/progress feedback.
- English is allowed only for product/package names, providers/models, technical terms, code identifiers, env vars, commands, paths, API/JSON/debug fields, user-imported text, raw model/error output, and third-party browser/system text.
- Safe defaults: AI records, raw model details, provider/token fields, task IDs, and JSON should stay in advanced/debug areas.

Avoid decorative UI or engineering-heavy controls that slow daily writing.

## Current Priority

Current priority order:

1. Keep product rules generic and keep book-specific context in workspaces or planning files.
2. Preserve source/artifact/proposal/review/diff/backup/publish decision boundaries.
3. Validate publish and pipeline changes in sandbox before real workspace use.
4. Add AI-led production flow pieces incrementally: work profile, writing card, generation mode, style proposal.
5. Strengthen the human-led editor without making daily writing depend on model availability.
6. Keep documentation and tests synchronized with actual behavior.

Do not do broad legacy cleanup, model-router redesign, new major features, or novel outline expansion unless the user asks.

## Reporting Rules

When giving findings:

- Lead with the decision, current state, or risk.
- Include concrete file paths, IDs, or command results.
- Distinguish facts from assumptions.
- If evidence is missing, say so.
- Keep reports concise enough to be actionable.
