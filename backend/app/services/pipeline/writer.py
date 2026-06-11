from typing import Protocol

from sqlalchemy.orm import Session

from backend.app.db.models import Chapter
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.app.services.writing_cards import normalize_generation_mode


class ChatRunner(Protocol):
    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs):
        ...


class WriterService:
    def __init__(self, session: Session, *, model_client: ChatRunner | None = None) -> None:
        self.session = session
        self.model_client = model_client or ModelClient(session)

    def generate_chapter_draft(self, chapter_id: int, *, force: bool = False, generation_mode: str = "stable") -> dict:
        mode = normalize_generation_mode(generation_mode)
        chapter = self._chapter(chapter_id)
        context = ContextBuilder(self.session).build(
            chapter_id=chapter.id,
            annotation_ids=[],
            task_type="generate_chapter_draft",
        )
        response = self.model_client.chat(
            role="writer",
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "你是长篇网文正文写作模型。只输出当前单章完整 Markdown 正文。"
                        "必须保留原章节标题，不新增设定，不跨章。"
                    ),
                ),
                ChatMessage(role="user", content=context.context),
            ],
            force=force,
            require_json=False,
            temperature=self._temperature(mode),
        )
        artifact = ArtifactStore(self.session).save_text(
            kind="candidate",
            text=response.content,
            metadata={
                "task_type": "generate_chapter_draft",
                "generation_mode": mode,
                "context_report": context.report,
                "context_report_artifact_id": context.report_artifact_id,
                "model_call_id": response.model_call_id,
                "role": response.route.role,
                "provider": response.route.provider,
                "model": response.route.model,
            },
            base_chapter=chapter,
        )
        self.session.commit()
        return {
            "artifact_id": artifact.id,
            "artifact_path": artifact.path,
            "artifact_sha256": artifact.sha256,
            "chapter_id": chapter.id,
            "chapter_no": chapter.chapter_no,
            "model_call_id": response.model_call_id,
            "generation_mode": mode,
        }

    def _chapter(self, chapter_id: int) -> Chapter:
        chapter = self.session.get(Chapter, chapter_id)
        if chapter is None or not chapter.active:
            raise NotFoundError("Chapter not found")
        if chapter.current_version is None:
            raise InvalidRequestError("Chapter has no current version")
        return chapter

    def _temperature(self, generation_mode: str) -> float:
        if generation_mode == "stable":
            return 0.35
        if generation_mode == "quality":
            return 0.45
        return 0.6
