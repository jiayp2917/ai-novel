import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.models import Annotation, AnnotationInsight, PublishDecision
from backend.app.repositories import Repository
from backend.app.schemas import AnnotationInsightUpdate
from backend.app.services.annotations import InvalidRequestError, NotFoundError


INSIGHT_KINDS = {
    "style_preference",
    "negative_pattern",
    "logic_rule",
    "consistency_rule",
    "rewrite_example",
}


class AnnotationLearner:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.insights = Repository(session, AnnotationInsight)

    def learn(self, annotation_ids: list[int] | None = None) -> dict:
        annotations = self._source_annotations(annotation_ids)
        created: list[AnnotationInsight] = []
        learnable_count = 0
        for annotation in annotations:
            payloads = self._insights_from_annotation(annotation)
            if payloads:
                learnable_count += 1
            for payload in payloads:
                if self._exists(payload["kind"], payload["content"]):
                    continue
                created.append(self.insights.create(payload))
            if payloads:
                annotation.status = "learned"
        self.session.commit()
        return {
            "created": len(created),
            "insight_ids": [insight.id for insight in created],
            "learnable_annotations": learnable_count,
            "message": self._learn_message(created_count=len(created), annotation_count=len(annotations), learnable_count=learnable_count),
        }

    def list_insights(self) -> list[AnnotationInsight]:
        return list(self.session.scalars(select(AnnotationInsight).order_by(AnnotationInsight.id.desc())))

    def update_insight(self, insight_id: int, payload: AnnotationInsightUpdate) -> AnnotationInsight:
        insight = self.session.get(AnnotationInsight, insight_id)
        if insight is None:
            raise NotFoundError("Annotation insight not found")
        data = payload.model_dump(exclude_unset=True)
        if "kind" in data and data["kind"] not in INSIGHT_KINDS:
            raise InvalidRequestError("Invalid insight kind")
        self.insights.update(insight, data)
        self.session.commit()
        self.session.refresh(insight)
        return insight

    def _source_annotations(self, annotation_ids: list[int] | None) -> list[Annotation]:
        statement = select(Annotation).where(Annotation.status == "resolved")
        if annotation_ids:
            statement = statement.where(Annotation.id.in_(annotation_ids))
        annotations = list(self.session.scalars(statement.order_by(Annotation.id)))
        if annotation_ids and len(annotations) != len(set(annotation_ids)):
            raise InvalidRequestError("Some annotations are not resolved or do not exist")
        return annotations

    def _insights_from_annotation(self, annotation: Annotation) -> list[dict]:
        source_ids = json.dumps([annotation.id])
        payloads: list[dict] = []
        normalized_comment = " ".join(annotation.comment.split())
        if annotation.example_rewrite:
            payloads.append(
                {
                    "kind": "rewrite_example",
                    "content": self._shorten(
                        f"When revising {annotation.type}, prefer: {annotation.example_rewrite.strip()}"
                    ),
                    "source_annotation_ids_json": source_ids,
                    "enabled": True,
                    "confidence": 0.8,
                }
            )
        if annotation.type in {"ai_tone", "style", "pacing"}:
            payloads.append(
                {
                    "kind": "style_preference",
                    "content": self._shorten(normalized_comment),
                    "source_annotation_ids_json": source_ids,
                    "enabled": True,
                    "confidence": 0.7,
                }
            )
        elif annotation.type in {"logic", "consistency", "setting_conflict", "outline_drift", "character"}:
            payloads.append(
                {
                    "kind": "logic_rule" if annotation.type == "logic" else "consistency_rule",
                    "content": self._shorten(normalized_comment),
                    "source_annotation_ids_json": source_ids,
                    "enabled": True,
                    "confidence": 0.7,
                }
            )
        elif annotation.type == "typo":
            payloads.append(
                {
                    "kind": "negative_pattern",
                    "content": self._shorten(normalized_comment),
                    "source_annotation_ids_json": source_ids,
                    "enabled": True,
                    "confidence": 0.65,
                }
            )
        return [payload for payload in payloads if payload["content"]]

    def _exists(self, kind: str, content: str) -> bool:
        return (
            self.session.scalar(
                select(AnnotationInsight).where(AnnotationInsight.kind == kind, AnnotationInsight.content == content)
            )
            is not None
        )

    def _shorten(self, text: str) -> str:
        return text.strip()[:300]

    def _learn_message(self, *, created_count: int, annotation_count: int, learnable_count: int) -> str:
        if annotation_count == 0:
            return "没有可学习的已解决批注，请先在批注中标记为已解决。"
        if learnable_count == 0:
            return "已解决批注中没有可沉淀的规则，请补充类型、说明或示例改写后再学习。"
        if created_count == 0:
            return "可学习批注已处理过，本次没有新增规则。"
        return f"已新增 {created_count} 条记忆规则。"


def publish_decision_ids(session: Session) -> list[int]:
    return [item.id for item in session.scalars(select(PublishDecision).order_by(PublishDecision.id))]
