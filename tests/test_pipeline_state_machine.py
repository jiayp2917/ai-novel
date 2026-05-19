import json

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.db.base import Base
from backend.app.db.models import Event, Job
from backend.app.services.pipeline.planner import PipelinePlanError, PipelinePlanner, PipelineTaskType
from backend.app.services.pipeline.runner import PipelineRunner
from backend.app.services.pipeline.state_machine import (
    PipelineState,
    PipelineStateMachine,
    PipelineTransitionError,
    job_payload,
    job_result,
    tracking_complete,
)


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_pipeline_state_machine_allows_legal_transition_and_records_event() -> None:
    session = make_session()
    job = PipelinePlanner(session).create_task(
        task_type=PipelineTaskType.GENERATE_CHAPTER_DRAFT,
        payload={"chapter_no": 1},
        chapter_id=1,
    )

    PipelineStateMachine(session).transition(job, PipelineState.QUEUED)
    PipelineStateMachine(session).mark_context_built(job, context_report_artifact_id=17)

    assert job.status == "context_built"
    assert job_result(job)["context_report_artifact_id"] == 17
    events = list(session.scalars(select(Event).where(Event.entity_id == job.id)))
    assert [event.event_type for event in events] == ["pipeline_transition", "pipeline_transition"]
    assert json.loads(events[-1].payload_json)["to"] == "context_built"


def test_pipeline_state_machine_rejects_illegal_transition() -> None:
    session = make_session()
    job = PipelinePlanner(session).create_task(
        task_type=PipelineTaskType.GENERATE_CHAPTER_DRAFT,
        payload={"chapter_no": 1},
        chapter_id=1,
    )

    with pytest.raises(PipelineTransitionError, match="planned -> reviewed"):
        PipelineStateMachine(session).transition(job, PipelineState.REVIEWED)

    assert job.status == "planned"


def test_pipeline_runner_records_output_tracking_fields() -> None:
    session = make_session()
    planner = PipelinePlanner(session)
    job = planner.create_task(
        task_type=PipelineTaskType.GENERATE_CHAPTER_DRAFT,
        payload={"chapter_no": 2},
        chapter_id=2,
        status=PipelineState.QUEUED,
    )

    runner = PipelineRunner(session)
    runner.mark_context_built(job.id, context_report_artifact_id=4)
    runner.mark_draft_generated(job.id, output_hash="a" * 64, artifact_id=5, model_call_id=6)

    stored = session.get(Job, job.id)
    assert stored is not None
    assert stored.status == "draft_generated"
    assert job_payload(stored)["input_hash"]
    assert job_result(stored)["output_hash"] == "a" * 64
    assert job_result(stored)["artifact_id"] == 5
    assert job_result(stored)["model_call_id"] == 6
    assert tracking_complete(stored) is True


def test_pipeline_planner_rejects_active_same_chapter_task() -> None:
    session = make_session()
    planner = PipelinePlanner(session)
    planner.create_task(
        task_type=PipelineTaskType.GENERATE_CHAPTER_DRAFT,
        payload={"chapter_no": 3},
        chapter_id=3,
    )

    with pytest.raises(PipelinePlanError, match="Chapter already has an active pipeline task"):
        planner.create_task(
            task_type=PipelineTaskType.REVIEW_CHAPTER_CANDIDATE,
            payload={"chapter_no": 3, "artifact_id": 9},
            chapter_id=3,
        )


def test_pipeline_planner_allows_same_chapter_after_terminal_state() -> None:
    session = make_session()
    planner = PipelinePlanner(session)
    first = planner.create_task(
        task_type=PipelineTaskType.GENERATE_CHAPTER_DRAFT,
        payload={"chapter_no": 4},
        chapter_id=4,
        status=PipelineState.QUEUED,
    )
    PipelineStateMachine(session).transition(first, PipelineState.MANUAL_REQUIRED)

    second = planner.create_task(
        task_type=PipelineTaskType.REVIEW_CHAPTER_CANDIDATE,
        payload={"chapter_no": 4, "artifact_id": 9},
        chapter_id=4,
    )

    assert second.id != first.id
    assert second.locked_chapter_id == 4


def test_pipeline_planner_rejects_active_serial_source_task() -> None:
    session = make_session()
    planner = PipelinePlanner(session)
    planner.create_task(
        task_type=PipelineTaskType.SUMMARIZE_PUBLISHED_CHAPTER,
        payload={"chapter_no": 5},
        chapter_id=5,
        source_file_id=50,
        serial_source=True,
    )

    with pytest.raises(PipelinePlanError, match="Source file already has an active serial task"):
        planner.create_task(
            task_type=PipelineTaskType.SUMMARIZE_PUBLISHED_CHAPTER,
            payload={"chapter_no": 6},
            chapter_id=6,
            source_file_id=50,
            serial_source=True,
        )


def test_pipeline_failure_can_retry_from_retryable_and_budget_states() -> None:
    session = make_session()
    planner = PipelinePlanner(session)
    first = planner.create_task(
        task_type=PipelineTaskType.REVIEW_CHAPTER_CANDIDATE,
        payload={"chapter_no": 7, "artifact_id": 1},
        chapter_id=7,
        status=PipelineState.QUEUED,
    )
    machine = PipelineStateMachine(session)
    machine.mark_retryable_failure(first, "temporary network error")
    machine.retry(first)

    assert first.status == "queued"
    assert first.error is None
    assert job_payload(first)["retry_count"] == 1

    machine.pause_for_budget(first, "budget limit")
    machine.retry(first)

    assert first.status == "queued"
    assert job_payload(first)["retry_count"] == 2


def test_pipeline_retry_rejects_terminal_failure() -> None:
    session = make_session()
    job = PipelinePlanner(session).create_task(
        task_type=PipelineTaskType.REVIEW_OUTLINE_PROPOSAL,
        payload={"source_file_id": 12},
        source_file_id=12,
        status=PipelineState.QUEUED,
    )
    machine = PipelineStateMachine(session)
    machine.mark_terminal_failure(job, "invalid outline")

    with pytest.raises(PipelineTransitionError, match="not retryable"):
        machine.retry(job)

