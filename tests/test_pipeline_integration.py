import json
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Event, Job, PublishDecision, Review
from backend.app.db.session import get_engine, reset_engine
from backend.app.repositories import Repository
from backend.app.services.library import LibraryScanner
from backend.app.services.model_client import ChatMessage
from backend.app.services.pipeline.executor import PipelineTaskExecutor
from backend.app.services.pipeline.runs import PipelineRunService


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@dataclass
class FakeRoute:
    role: str
    provider: str = "fake"
    model: str = "fake-model"


@dataclass
class FakeResponse:
    content: str
    model_call_id: int
    route: FakeRoute = field(default_factory=lambda: FakeRoute(role="writer"))


class PipelineFakeModel:
    calls: list[dict] = []
    draft = "# 第001章 起步\n" + "".join(
        f"许满沿着章纲推进试炼，保持劲大天赋设定，并完成第{i}步选择。\n"
        for i in range(1, 96)
    )

    def __init__(self, session: Session) -> None:
        self.session = session

    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs) -> FakeResponse:
        self.calls.append({"role": role, "messages": messages, "kwargs": kwargs})
        if role == "reviewer":
            content = json.dumps({"passed": True, "issues": []}, ensure_ascii=False)
        elif role in {"writer", "quick_fix", "fixer"}:
            content = self.draft
        else:
            content = json.dumps({"summary": "许满完成试炼推进。"}, ensure_ascii=False)
        return FakeResponse(content=content, model_call_id=len(self.calls), route=FakeRoute(role=role))


def test_pipeline_integration_generate_review_publish_updates_chapter(
    tmp_path: Path,
    monkeypatch,
) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    monkeypatch.setenv("MAX_INPUT_CHARS_PER_CALL", "20000")
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    write(content_root / "settings" / "world.md", "# 设定\n许满的天赋是劲大。")
    write(content_root / "outlines" / "outline.md", "# 第001章 起步\n许满按章纲进入试炼。")
    original = "# 第001章 起步\n许满站在试炼入口。"
    write(content_root / "chapters" / "book.md", original)

    with Session(get_engine()) as session:
        LibraryScanner(session, content_root).scan()
        PipelineFakeModel.calls.clear()
        monkeypatch.setattr("backend.app.services.pipeline.writer.ModelClient", PipelineFakeModel)
        monkeypatch.setattr("backend.app.services.pipeline.reviewer.ModelClient", PipelineFakeModel)
        monkeypatch.setattr("backend.app.services.review_publish.ModelClient", PipelineFakeModel)

        run = PipelineRunService(session).create_run(
            start_chapter=1,
            end_chapter=1,
            mode="full_auto",
            dry_run=False,
            max_fix_rounds=0,
        )
        task_ids = [task["id"] for task in run["child_tasks"][:5]]
        PipelineTaskExecutor(session).run_job(_mark_running(session, run["id"]))

        for task_id in task_ids:
            job = session.get(Job, task_id)
            assert job is not None
            if job.status == "planned":
                continue
            _run_pipeline_task_until_stable(session, task_id)

        run_job = session.get(Job, run["id"])
        assert run_job is not None
        assert run_job.status in {"context_built", "done"}
        writer_task = session.get(Job, task_ids[0])
        review_task = session.get(Job, task_ids[1])
        publish_task = session.get(Job, task_ids[4])
        assert writer_task is not None and writer_task.status == "done"
        assert review_task is not None and review_task.status == "approved"
        assert publish_task is not None and publish_task.status == "published"
        assert session.scalar(select(Artifact).where(Artifact.kind == "candidate")) is not None
        assert session.scalar(select(Review)) is not None
        assert session.scalar(select(PublishDecision)) is not None
        assert session.scalar(select(Event).where(Event.event_type == "artifact_published")) is not None

    assert (content_root / "chapters" / "book.md").read_text(encoding="utf-8") == PipelineFakeModel.draft
    get_settings.cache_clear()
    reset_engine()


def _mark_running(session: Session, job_id: int) -> int:
    job = session.get(Job, job_id)
    assert job is not None
    job.status = "running"
    session.commit()
    return job_id


def _run_pipeline_task_until_stable(session: Session, job_id: int) -> None:
    for _ in range(4):
        job = session.get(Job, job_id)
        assert job is not None
        if job.status != "queued":
            return
        try:
            PipelineTaskExecutor(session).run_job(_mark_running(session, job_id))
        except RuntimeError as exc:
            if "Candidate artifact prepared" not in str(exc):
                raise
            session.commit()
    job = session.get(Job, job_id)
    assert job is not None
    assert job.status != "queued"
