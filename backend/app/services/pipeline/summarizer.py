import json
from typing import Protocol

from sqlalchemy.orm import Session

from backend.app.db.models import Chapter
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.model_client import ChatMessage, ModelClient


class ChatRunner(Protocol):
    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs):
        ...


class SummarizerService:
    def __init__(self, session: Session, *, model_client: ChatRunner | None = None) -> None:
        self.session = session
        self.model_client = model_client or ModelClient(session)

    def summarize_chapter(self, chapter_id: int, *, force: bool = False) -> dict:
        chapter = self._chapter(chapter_id)
        context = ContextBuilder(self.session).build(
            chapter_id=chapter.id,
            annotation_ids=[],
            task_type="summarize_published_chapter",
        )
        response = self.model_client.chat(
            role="long_context",
            force=force,
            require_json=True,
            temperature=0.1,
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "你是小说短记忆压缩模型。只输出 JSON，不复述正文。"
                        "字段尽量短，用于后续低 token 上下文。"
                    ),
                ),
                ChatMessage(role="user", content=self._prompt(context.context)),
            ],
        )
        try:
            payload = json.loads(response.content)
        except json.JSONDecodeError:
            payload = {"summary": response.content[:500], "parse_failed": True}
        artifact = ArtifactStore(self.session).save_json(
            kind="summary",
            payload=payload,
            metadata={
                "task_type": "summarize_published_chapter",
                "chapter_no": chapter.chapter_no,
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
        }

    def _prompt(self, context: str) -> str:
        return json.dumps(
            {
                "context": context,
                "schema": {
                    "summary": "100字以内",
                    "character_state_delta": {},
                    "plot_state_delta": {},
                    "unresolved_hooks": [],
                    "items": [],
                    "locations": [],
                },
            },
            ensure_ascii=False,
        )

    def _chapter(self, chapter_id: int) -> Chapter:
        chapter = self.session.get(Chapter, chapter_id)
        if chapter is None or not chapter.active:
            raise NotFoundError("Chapter not found")
        if chapter.current_version is None:
            raise InvalidRequestError("Chapter has no current version")
        return chapter

