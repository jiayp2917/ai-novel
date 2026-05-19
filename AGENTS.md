# AGENTS.md

This file gives Codex project-level instructions for this repository.

## Project Identity

This repository is the source code for a local Chinese novel editor named `小说编辑器`.

The system is intended for long-form web novel production. It manages workspaces, settings, outlines, chapters, annotations, AI-generated candidates, reviews, diffs, publish-gate writes, memory, model calls, and pipeline jobs.

Read these files before substantial work:

- `CLAUDE.md`: coding rules and local engineering constraints.
- `PRD.md`: product requirements and intended user workflows.
- `README.md`: current startup and usage instructions.
- `D:\2917\plan\remake1.0.md`: current refactor roadmap.

## Non-Negotiable Safety Rules

- Do not read, print, copy, commit, or include contents from `key.txt`, `.env`, or API keys in reports.
- Do not overwrite real novel source files unless the user explicitly asks for a publish/write operation.
- AI/model outputs must be saved as artifacts first. They must not directly modify source files.
- Chapter source writes must go through the publish gate.
- Settings and outlines are proposal-only by default. Do not add ordinary direct-publish paths for them.
- Preserve backups, diffs, model-call logs, review records, and publish decisions unless the user explicitly asks for cleanup and the cleanup is safe.
- Never use destructive Git or filesystem commands such as `git reset --hard`, recursive delete, or broad move operations without a precise target and explicit user approval.

## Architecture Boundaries

The code repository and novel workspaces must remain conceptually separate.

Repository-owned areas:

- `backend/`
- `frontend/`
- `config/`
- `skills/`
- `tests/`
- `docs/` if present
- root project docs and dependency files

Novel workspace-owned areas:

- `00-系统/`
- `01-设定/`
- `02-正文/`
- `03-章纲/`
- workspace `runtime/`

The current repository still contains a legacy in-repo novel workspace. Keep compatibility, but prefer new or migrated novel projects under an external workspace root such as `D:\2917\novel-workspaces\作品名`.

## Model Role Rules

Logical model roles must stay isolated:

- `reviewer`: reviews only; must not rewrite or create prose.
- `writer`: creates prose candidates only; must not decide whether content passes review.
- `fixer` / `quick_fix`: fixes only review-authorized writer issues; must not add new settings.
- `memory` / `long_context`: compresses or compiles context only; must not create story content.
- `outliner` / `structural_fix`: handles outlines and structure proposals; source writes still require user confirmation.
- `arbiter`: manual/high-risk decision support, not an automatic publish bypass.

Review outputs must be evidence constrained. Issues without concrete evidence must be routed to `admin` or manual handling, not automatic fixing.

## Development Workflow

Prefer small, verifiable changes.

Before edits:

- Read the relevant files first.
- State assumptions when the request is ambiguous.
- Keep unrelated refactors out of the change.

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
```

## Frontend Product Expectations

The target user is a writer with basic computer skills, not an engineer.

Prioritize:

- Large, unobstructed writing area.
- Right-click actions for annotation and draft operations.
- Clear catalog tree.
- Hideable side panels.
- Separate writing UI from model/task UI.
- Chinese UI text.
- Explicit success/failure/progress feedback for every action.

Avoid adding decorative UI that makes daily writing slower.

## Current Refactor Priority

Current priority order:

1. Separate repository code, novel content, runtime state, and test artifacts.
2. Stabilize core frontend writing, selection, annotation, search, candidate, review, and sandbox publish flows.
3. Split large frontend components and reduce global state coupling.
4. Improve job/model/publish observability and recovery.
5. Validate the automated novel pipeline in sandbox before real use.
6. Keep documentation and tests synchronized with actual behavior.

## Reporting Rules

When giving findings:

- Lead with the decision or risk.
- Include concrete file paths or command results.
- Distinguish facts from assumptions.
- If evidence is missing, say so.
- Keep reports concise enough to be actionable.
