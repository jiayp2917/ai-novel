import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text, safe_write_text
from backend.app.core.config import get_settings
from backend.app.db.models import Artifact, Chapter, Job, ModelCall, Review, SourceFile
from backend.app.db.session import get_db, reset_engine
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.pipeline.runs import PipelineRunService
from backend.app.services.pipeline.state_machine import PipelineState, PipelineStateMachine, job_payload
from backend.app.services.skills import SkillLoader, skill_summary
from backend.app.services.workspace import WorkspaceResolver, get_active_workspace_info
from backend.tools.create_e2e_workspace import main as reset_e2e_workspace


router = APIRouter(prefix="/api/test", tags=["test-support"])


class SeedCandidateRequest(BaseModel):
    chapter_id: int
    text: str


class SeedAiCandidateRequest(SeedCandidateRequest):
    task_type: str = "generate_chapter_draft"


class SeedReviewedCandidateRequest(SeedCandidateRequest):
    passed: bool = True
    manual_required: bool = False
    issues: list[dict] = []


class SeedProposalRequest(BaseModel):
    source_file_id: int
    text: str


class SeedReviewRequest(BaseModel):
    artifact_id: int
    passed: bool = True
    manual_required: bool = False
    issues: list[dict] = []


class MutateChapterSourceRequest(BaseModel):
    chapter_id: int
    marker: str = "\n\n测试：模拟正文已被外部修改。"


@router.post("/seed-candidate")
def seed_candidate(payload: SeedCandidateRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    artifact = ArtifactStore(session).save_text(
        kind="candidate",
        text=payload.text,
        metadata={"purpose": "playwright_e2e_mismatch_seed"},
        base_chapter=chapter,
    )
    session.commit()
    return {"artifact_id": artifact.id, "chapter_id": chapter.id}


@router.post("/seed-ai-candidate")
def seed_ai_candidate(payload: SeedAiCandidateRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    artifact = ArtifactStore(session).save_text(
        kind="candidate",
        text=payload.text,
        metadata={
            "purpose": "playwright_e2e_unreviewed_ai_seed",
            "task_type": payload.task_type,
            "source": "ai_generated_draft",
            "requires_ai_review": True,
        },
        base_chapter=chapter,
    )
    session.commit()
    return {"artifact_id": artifact.id, "chapter_id": chapter.id}


@router.post("/reset-sandbox-workspace")
def reset_sandbox_workspace() -> dict:
    _assert_test_environment()
    reset_engine()
    reset_e2e_workspace()
    return {"status": "ok"}


@router.post("/seed-reviewed-candidate")
def seed_reviewed_candidate(payload: SeedReviewedCandidateRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    artifact = ArtifactStore(session).save_text(
        kind="candidate",
        text=payload.text,
        metadata={"purpose": "playwright_e2e_publish_seed"},
        base_chapter=chapter,
    )
    review = Review(
        artifact_id=artifact.id,
        passed=payload.passed,
        issues_json=json.dumps(payload.issues, ensure_ascii=False),
        evidence_count=sum(1 for issue in payload.issues if str(issue.get("evidence") or "").strip()),
        manual_required=payload.manual_required,
        candidate_hash=artifact.sha256,
        base_source_file_hash=artifact.base_source_file_hash,
        base_chapter_version_id=artifact.base_chapter_version_id,
    )
    session.add(review)
    session.commit()
    return {"artifact_id": artifact.id, "chapter_id": chapter.id, "review_id": review.id}


@router.post("/seed-review")
def seed_review(payload: SeedReviewRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    artifact = session.get(Artifact, payload.artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    review = Review(
        artifact_id=artifact.id,
        passed=payload.passed,
        issues_json=json.dumps(payload.issues, ensure_ascii=False),
        evidence_count=sum(1 for issue in payload.issues if str(issue.get("evidence") or "").strip()),
        manual_required=payload.manual_required,
        candidate_hash=artifact.sha256,
        base_source_file_hash=artifact.base_source_file_hash,
        base_chapter_version_id=artifact.base_chapter_version_id,
    )
    session.add(review)
    session.commit()
    return {"artifact_id": artifact.id, "review_id": review.id, "passed": review.passed}


@router.post("/mutate-chapter-source")
def mutate_chapter_source(payload: MutateChapterSourceRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    source_path = WorkspaceResolver().resolve_source_path(chapter.source_file.path)
    original = safe_read_text(source_path, encoding="utf-8-sig")
    updated = original + payload.marker
    safe_write_text(source_path, updated, encoding="utf-8")
    return {"chapter_id": chapter.id, "source_file_id": chapter.source_file_id, "chars_added": len(payload.marker)}


@router.post("/seed-budget-paused-job")
def seed_budget_paused_job(session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    job = Job(
        type="test_budget_resume",
        status="paused_budget",
        payload_json=json.dumps({"test_budget_pause": True}, ensure_ascii=False),
        error="今日调用额度已暂停",
    )
    session.add(job)
    session.commit()
    return {"job_id": job.id, "status": job.status}


@router.post("/seed-failed-pipeline-run")
def seed_failed_pipeline_run(session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    run = PipelineRunService(session).create_run(
        start_chapter=1,
        end_chapter=1,
        mode="review_only",
        chunk_size=1,
        max_fix_rounds=0,
        dry_run=True,
    )
    run_job = session.get(Job, run["id"])
    if run_job is None:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    child_ids = [int(item) for item in job_payload(run_job).get("child_task_ids", []) if isinstance(item, int)]
    if not child_ids:
        raise HTTPException(status_code=400, detail="Pipeline run has no child tasks")
    child = session.get(Job, child_ids[0])
    if child is None:
        raise HTTPException(status_code=404, detail="Pipeline child task not found")
    machine = PipelineStateMachine(session)
    machine.transition(child, PipelineState.QUEUED)
    machine.transition(child, PipelineState.FAILED_RETRYABLE, error="测试：模型返回格式错误")
    machine.transition(run_job, PipelineState.FAILED_RETRYABLE, error="测试：子任务失败")
    session.commit()
    return {"run_id": run_job.id, "child_task_id": child.id, "status": run_job.status}


@router.post("/seed-model-quality-report")
def seed_model_quality_report(session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    chapter = session.query(Chapter).filter(Chapter.active.is_(True)).order_by(Chapter.chapter_no).first()
    if chapter is None:
        raise HTTPException(status_code=404, detail="Chapter not found")
    writer = ArtifactStore(session).save_text(
        kind="candidate",
        text="# 第001章\n" + ("字" * 2000),
        metadata={
            "purpose": "playwright_model_quality_seed",
            "task_type": "generate_chapter_draft",
            "context_report": {
                "chapter_id": chapter.id,
                "task_type": "generate_chapter_draft",
                "budget": 1200,
                "input_chars": 1100,
                "context_degraded": True,
                "selected_sections": [{"name": "chapter_text", "chars": 800}],
                "dropped_sections": [{"name": "timeline", "chars": 500}],
                "skills": [skill_summary(skill) for skill in SkillLoader().load_for_task("generate_chapter_draft")],
            },
        },
        base_chapter=chapter,
    )
    fixed = ArtifactStore(session).save_text(
        kind="candidate",
        text="# 第001章\n" + ("字" * 2100),
        metadata={
            "purpose": "playwright_model_quality_seed",
            "task_type": "fix_chapter_candidate",
            "parent_artifact_id": writer.id,
        },
        base_chapter=chapter,
    )
    session.add_all(
        [
            Review(
                artifact_id=writer.id,
                passed=False,
                issues_json=json.dumps(
                    [
                        {"owner": "writer", "severity": "medium", "evidence": "原文证据", "source": "model_review"},
                        {"owner": "admin", "severity": "blocking", "evidence": "", "source": "model_review"},
                    ],
                    ensure_ascii=False,
                ),
                evidence_count=1,
                manual_required=True,
                candidate_hash=writer.sha256,
                base_source_file_hash=writer.base_source_file_hash,
                base_chapter_version_id=writer.base_chapter_version_id,
            ),
            Review(
                artifact_id=fixed.id,
                passed=True,
                issues_json="[]",
                evidence_count=0,
                manual_required=False,
                candidate_hash=fixed.sha256,
                base_source_file_hash=fixed.base_source_file_hash,
                base_chapter_version_id=fixed.base_chapter_version_id,
            ),
            ModelCall(
                role="reviewer",
                provider="deepseek",
                model="deepseek-v4-pro",
                prompt_hash="q" * 64,
                input_chars=100,
                output_chars=50,
                usage_json='{"usage_source": "provider", "total_tokens": 88, "elapsed_seconds": 1}',
                cache_hit=False,
                status="succeeded",
            ),
        ]
    )
    session.commit()
    return {"writer_artifact_id": writer.id, "fix_artifact_id": fixed.id}


@router.post("/seed-proposal")
def seed_proposal(payload: SeedProposalRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    source_file = session.get(SourceFile, payload.source_file_id)
    if source_file is None or not source_file.active:
        raise HTTPException(status_code=404, detail="Source file not found")
    artifact = ArtifactStore(session).save_text(
        kind="proposal",
        text=payload.text,
        metadata={"purpose": "playwright_e2e_proposal_seed"},
        base_source_file=source_file,
    )
    review = Review(
        artifact_id=artifact.id,
        passed=True,
        issues_json=json.dumps([], ensure_ascii=False),
        evidence_count=0,
        manual_required=False,
        candidate_hash=artifact.sha256,
        base_source_file_hash=artifact.base_source_file_hash,
        base_chapter_version_id=artifact.base_chapter_version_id,
    )
    session.add(review)
    session.commit()
    return {"artifact_id": artifact.id, "source_file_id": source_file.id, "review_id": review.id}


def _assert_test_environment() -> None:
    settings = get_settings()
    db_name = settings.app_db_path.name.lower()
    runtime_name = settings.runtime_root.name.lower()
    workspace = get_active_workspace_info().root
    workspace_parts = {part.lower() for part in workspace.parts}
    if "e2e" not in db_name and "test" not in db_name:
        raise HTTPException(status_code=403, detail="Test support requires an e2e/test database")
    if "e2e" not in runtime_name and "test" not in runtime_name:
        raise HTTPException(status_code=403, detail="Test support requires an e2e/test runtime")
    if "sandbox_workspace" not in workspace_parts:
        raise HTTPException(status_code=403, detail="Test support requires sandbox workspace")
