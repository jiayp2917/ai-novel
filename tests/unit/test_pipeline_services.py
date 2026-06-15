import json
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Chapter, MemoryItem, Review
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.model_client import ChatMessage
from backend.app.services.pipeline.fixer import FixerService
from backend.app.services.pipeline.local_rules import count_chinese_chars, run_local_rules
from backend.app.services.pipeline.reviewer import ReviewerService
from backend.app.services.pipeline.summarizer import SummarizerService
from backend.app.services.pipeline.writer import WriterService


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed_project(root: Path) -> str:
    original = "# 第001章 起步\n许满站在操场边，听见试炼钟声响起。"
    write(root / "settings" / "world.md", "# 设定\n许满的天赋是劲大，不得新增其它天赋。")
    write(root / "outlines" / "outline.md", "# 第001章 起步\n许满进入试炼前完成基础选择，展示劲大天赋。")
    write(root / "chapters" / "book.md", original)
    return original


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


class FakeModelClient:
    def __init__(self, content: str) -> None:
        self.content = content
        self.messages: list[ChatMessage] = []
        self.calls: list[dict] = []

    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs) -> FakeResponse:
        self.messages = messages
        self.calls.append({"role": role, "messages": messages, "kwargs": kwargs})
        return FakeResponse(self.content, model_call_id=len(self.calls), route=FakeRoute(role=role))


def setup_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Session, Path, Path, str, Chapter]:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    original = seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    monkeypatch.setenv("MAX_INPUT_CHARS_PER_CALL", "20000")
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    MemoryService(session, content_root).rebuild()
    chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == 1))
    assert chapter is not None
    return session, content_root, runtime_root, original, chapter


def test_local_rules_detect_heading_count_and_repetition() -> None:
    text = "# 第002章 错章\n" + ("这是一句反复出现的长句用于测试重复检测。" * 3)

    issues = run_local_rules(1, text)

    rule_ids = {issue["rule_id"] for issue in issues}
    assert "chapter_number_mismatch" in rule_ids
    assert "word_count_min" in rule_ids
    assert count_chinese_chars(text) > 0


def test_writer_creates_candidate_artifact_without_writing_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, content_root, runtime_root, original, chapter = setup_project(tmp_path, monkeypatch)
    draft = "# 第001章 起步\n" + "许满握紧拳头，沿着章纲推进。" * 100

    result = WriterService(session, model_client=FakeModelClient(draft)).generate_chapter_draft(chapter.id)

    artifact = session.get(Artifact, result["artifact_id"])
    assert artifact is not None
    assert artifact.kind == "candidate"
    assert artifact.base_chapter_id == chapter.id
    assert (runtime_root / artifact.path).read_text(encoding="utf-8") == draft
    assert (content_root / "chapters" / "book.md").read_text(encoding="utf-8") == original
    metadata = json.loads(artifact.metadata_json)
    assert metadata["task_type"] == "generate_chapter_draft"
    assert metadata["generation_mode"] == "stable"
    assert metadata["role"] == "writer"
    get_settings.cache_clear()


def test_writer_records_generation_mode_and_temperature(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, _, _, _, chapter = setup_project(tmp_path, monkeypatch)
    draft = "# 第001章 起步\n" + "许满握紧拳头，沿着章纲推进。" * 100
    model = FakeModelClient(draft)

    result = WriterService(session, model_client=model).generate_chapter_draft(chapter.id, generation_mode="quality")

    artifact = session.get(Artifact, result["artifact_id"])
    assert artifact is not None
    metadata = json.loads(artifact.metadata_json)
    assert metadata["generation_mode"] == "quality"
    assert result["generation_mode"] == "quality"
    assert model.calls[0]["kwargs"]["temperature"] == 0.45
    get_settings.cache_clear()


def test_writer_records_confirmed_card_sources_in_metadata(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, _, _, _, chapter = setup_project(tmp_path, monkeypatch)
    session.add(
        MemoryItem(
            kind="chapter_card",
            scope="1",
            content_json=json.dumps(
                {
                    "source": "confirmed_writing_card",
                    "chapter_no": 1,
                    "card_markdown": "confirmed card",
                    "artifact_id": 42,
                    "artifact_sha256": "a" * 64,
                    "generation_mode": "stable",
                },
                ensure_ascii=False,
            ),
            source_hash="a" * 64,
            stale=False,
        )
    )
    session.commit()
    draft = "# 第001章 起步\n" + "许满握紧拳头，沿着章纲推进。" * 100

    result = WriterService(session, model_client=FakeModelClient(draft)).generate_chapter_draft(chapter.id)

    artifact = session.get(Artifact, result["artifact_id"])
    assert artifact is not None
    metadata = json.loads(artifact.metadata_json)
    assert metadata["writing_card"]["artifact_id"] == 42
    assert any(source["artifact_id"] == 42 for source in metadata["memory_sources"])
    assert metadata["skills"]
    get_settings.cache_clear()


def test_reviewer_merges_local_rules_and_enforces_evidence_guard(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, _, _, _, chapter = setup_project(tmp_path, monkeypatch)
    short_candidate = "# 第001章 起步\n许满走进试炼。"
    artifact = ArtifactStore(session).save_text(kind="candidate", text=short_candidate, metadata={}, base_chapter=chapter)
    reviewer_payload = json.dumps(
        {
            "passed": True,
            "issues": [
                {
                    "chapter": 1,
                    "severity": "low",
                    "type": "logic",
                    "description": "这里可能有问题",
                    "evidence": "",
                    "owner": "writer",
                    "fix_instruction": "检查即可",
                }
            ],
        },
        ensure_ascii=False,
    )

    result = ReviewerService(session, model_client=FakeModelClient(reviewer_payload)).review_candidate(artifact.id)

    assert result["passed"] is False
    assert result["manual_required"] is True
    owners = {issue["owner"] for issue in result["issues"]}
    assert "admin" in owners
    assert any(issue.get("rule_id") == "word_count_min" for issue in result["issues"])
    assert all("finding_id" in issue for issue in result["issues"])
    review = session.get(Review, result["review_id"])
    assert review is not None
    assert review.candidate_hash == artifact.sha256
    get_settings.cache_clear()


def test_fixer_repairs_only_writer_issues_and_creates_new_candidate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, content_root, runtime_root, original, chapter = setup_project(tmp_path, monkeypatch)
    candidate = "# 第001章 起步\n许满走进试炼。"
    artifact = ArtifactStore(session).save_text(kind="candidate", text=candidate, metadata={}, base_chapter=chapter)
    session.add(
        Review(
            artifact_id=artifact.id,
            passed=False,
            issues_json=json.dumps(
                [
                    {
                        "chapter": 1,
                        "severity": "medium",
                        "type": "length",
                        "description": "字数不足",
                        "evidence": "当前中文字符数：8",
                        "owner": "writer",
                        "fix_instruction": "扩写正文",
                    }
                ],
                ensure_ascii=False,
            ),
            evidence_count=1,
            manual_required=False,
            candidate_hash=artifact.sha256,
            base_source_file_hash=artifact.base_source_file_hash,
            base_chapter_version_id=artifact.base_chapter_version_id,
        )
    )
    session.commit()
    fixed_text = "# 第001章 起步\n" + "许满按照章纲完成试炼前选择。" * 90

    result = FixerService(session, model_client=FakeModelClient(fixed_text)).fix_candidate(artifact.id)

    assert result["status"] == "fixed"
    fixed = session.get(Artifact, result["artifact_id"])
    assert fixed is not None
    assert fixed.id != artifact.id
    assert (runtime_root / fixed.path).read_text(encoding="utf-8") == fixed_text
    assert (content_root / "chapters" / "book.md").read_text(encoding="utf-8") == original
    metadata = json.loads(fixed.metadata_json)
    assert metadata["parent_artifact_id"] == artifact.id
    assert metadata["role"] == "quick_fix"
    assert metadata["consumed_review_id"] == result["review_id"]
    assert metadata["consumed_finding_ids"]
    get_settings.cache_clear()


def test_fixer_routes_non_writer_issues_to_manual_required(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, _, _, _, chapter = setup_project(tmp_path, monkeypatch)
    artifact = ArtifactStore(session).save_text(kind="candidate", text="# 第001章 起步\n正文。", metadata={}, base_chapter=chapter)
    session.add(
        Review(
            artifact_id=artifact.id,
            passed=False,
            issues_json=json.dumps(
                [
                    {
                        "chapter": 1,
                        "severity": "high",
                        "type": "outline",
                        "description": "章纲冲突",
                        "evidence": "章纲 A / 正文 B",
                        "owner": "outliner",
                        "fix_instruction": "人工确认章纲",
                    }
                ],
                ensure_ascii=False,
            ),
            evidence_count=1,
            manual_required=True,
            candidate_hash=artifact.sha256,
            base_source_file_hash=artifact.base_source_file_hash,
            base_chapter_version_id=artifact.base_chapter_version_id,
        )
    )
    session.commit()

    result = FixerService(session, model_client=FakeModelClient("should not be used")).fix_candidate(artifact.id)

    assert result["status"] == "manual_required"
    assert session.query(Artifact).count() == 1
    get_settings.cache_clear()


def test_fixer_rejects_stale_review_binding(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, _, _, _, chapter = setup_project(tmp_path, monkeypatch)
    artifact = ArtifactStore(session).save_text(kind="candidate", text="# 第001章 起步\n正文。", metadata={}, base_chapter=chapter)
    review = Review(
        artifact_id=artifact.id,
        passed=False,
        issues_json=json.dumps(
            [
                {
                    "chapter": 1,
                    "severity": "medium",
                    "type": "length",
                    "description": "字数不足",
                    "evidence": "当前中文字符数：8",
                    "owner": "writer",
                    "fix_instruction": "扩写正文",
                }
            ],
            ensure_ascii=False,
        ),
        evidence_count=1,
        manual_required=False,
        candidate_hash="0" * 64,
        base_source_file_hash=artifact.base_source_file_hash,
        base_chapter_version_id=artifact.base_chapter_version_id,
    )
    session.add(review)
    session.commit()

    with pytest.raises(Exception, match="Review candidate hash does not match artifact"):
        FixerService(session, model_client=FakeModelClient("unused")).fix_candidate(artifact.id, review_id=review.id)

    get_settings.cache_clear()


def test_summarizer_creates_summary_artifact_without_writing_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, content_root, runtime_root, original, chapter = setup_project(tmp_path, monkeypatch)
    summary = json.dumps(
        {
            "summary": "许满进入试炼前展示劲大天赋。",
            "character_state_delta": {"许满": "完成选择"},
            "plot_state_delta": {},
            "unresolved_hooks": [],
        },
        ensure_ascii=False,
    )

    result = SummarizerService(session, model_client=FakeModelClient(summary)).summarize_chapter(chapter.id)

    artifact = session.get(Artifact, result["artifact_id"])
    assert artifact is not None
    assert artifact.kind == "proposal"
    metadata = json.loads(artifact.metadata_json)
    assert metadata["purpose"] == "chapter_memory_proposal"
    assert metadata["canonical"] is False
    payload = json.loads((runtime_root / artifact.path).read_text(encoding="utf-8"))
    assert payload["summary"] == "许满进入试炼前展示劲大天赋。"
    assert (content_root / "chapters" / "book.md").read_text(encoding="utf-8") == original
    get_settings.cache_clear()
