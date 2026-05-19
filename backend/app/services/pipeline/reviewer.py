import json
from typing import Any, Protocol

from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.models import Artifact, Chapter, Review
from backend.app.repositories import Repository
from backend.app.services.annotations import NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.app.services.pipeline.local_rules import run_local_rules
from backend.app.services.workspace import workspace_runtime_root
from backend.app.utils.hashing import sha256_file


class PipelineReviewError(ValueError):
    pass


class ChatRunner(Protocol):
    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs):
        ...


class ReviewerService:
    def __init__(self, session: Session, *, model_client: ChatRunner | None = None) -> None:
        self.session = session
        self.settings = get_settings()
        self.model_client = model_client or ModelClient(session)
        self.reviews = Repository(session, Review)
        self.runtime_root = workspace_runtime_root()

    def review_candidate(self, artifact_id: int, *, force: bool = False) -> dict:
        artifact = self._artifact(artifact_id)
        self._validate_artifact_file(artifact)
        chapter = self._base_chapter(artifact)
        candidate = self._artifact_text(artifact)
        local_issues = run_local_rules(chapter.chapter_no, candidate)
        response = self.model_client.chat(
            role="reviewer",
            force=force,
            require_json=True,
            temperature=0.0,
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "你是小说一致性审核模型。你只能依据用户提供的设定、章纲、短记忆、候选正文判断。"
                        "禁止补充、猜测、扩写任何未提供的信息。只输出严格 JSON。"
                    ),
                ),
                ChatMessage(role="user", content=self._prompt(artifact, chapter, candidate, local_issues)),
            ],
        )
        payload = self._parse_review(response.content, artifact)
        issues = self._normalize_issues(payload.get("issues", []))
        issues = self._merge_local_issues(issues, local_issues)
        passed = bool(payload.get("passed", False)) and not self._has_blocking_issue(issues)
        manual_required = any(issue.get("owner") == "admin" for issue in issues)
        review = self.reviews.create(
            {
                "artifact_id": artifact.id,
                "passed": passed,
                "issues_json": json.dumps(issues, ensure_ascii=False),
                "evidence_count": sum(1 for issue in issues if issue.get("evidence")),
                "manual_required": manual_required,
                "candidate_hash": artifact.sha256,
                "base_source_file_hash": artifact.base_source_file_hash,
                "base_chapter_version_id": artifact.base_chapter_version_id,
            }
        )
        self.session.commit()
        return {
            "review_id": review.id,
            "artifact_id": artifact.id,
            "passed": review.passed,
            "manual_required": review.manual_required,
            "issues": issues,
            "model_call_id": response.model_call_id,
        }

    def _prompt(self, artifact: Artifact, chapter: Chapter, candidate: str, local_issues: list[dict[str, Any]]) -> str:
        return json.dumps(
            {
                "artifact_id": artifact.id,
                "chapter_no": chapter.chapter_no,
                "chapter_title": chapter.title,
                "local_rule_issues": local_issues,
                "candidate": candidate,
                "required_schema": {
                    "passed": False,
                    "overall": "简短结论",
                    "issues": [
                        {
                            "chapter": chapter.chapter_no,
                            "severity": "blocking/high/medium/low",
                            "type": "setting_conflict/timeline/motivation/clue/style/format/length",
                            "description": "具体问题",
                            "evidence": "必须引用具体材料或原文片段；无证据写：无法确认：缺少证据",
                            "owner": "writer/outliner/state/admin",
                            "fix_instruction": "只给方向，不重写正文",
                        }
                    ],
                },
                "owner_rules": [
                    "正文、字数、文风、对话、场景、节奏问题归 writer。",
                    "设定、总纲、章纲、伏笔设计问题归 outliner。",
                    "记忆与已发布状态不同步归 state。",
                    "无证据、需人工判断或无法归因的问题归 admin。",
                ],
            },
            ensure_ascii=False,
        )

    def _parse_review(self, content: str, artifact: Artifact) -> dict[str, Any]:
        try:
            payload = json.loads(content)
        except json.JSONDecodeError as exc:
            raw = ArtifactStore(self.session).save_text(
                kind="review",
                text=content,
                metadata={"parse_failed": True, "candidate_artifact_id": artifact.id},
                base_chapter=self._base_chapter(artifact),
                suffix=".txt",
            )
            self.session.commit()
            raise PipelineReviewError(f"Review JSON parse failed; raw_artifact_id={raw.id}") from exc
        if not isinstance(payload, dict):
            return {
                "passed": False,
                "issues": [
                    {
                        "chapter": None,
                        "severity": "blocking",
                        "type": "invalid_review",
                        "description": "审核输出不是 JSON 对象。",
                        "evidence": "无法确认：缺少证据",
                        "owner": "admin",
                        "fix_instruction": "重新生成审核结果。",
                    }
                ],
            }
        return payload

    def _normalize_issues(self, issues: Any) -> list[dict[str, Any]]:
        if not isinstance(issues, list):
            issues = []
        normalized: list[dict[str, Any]] = []
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            item = {
                "chapter": issue.get("chapter"),
                "severity": self._severity(str(issue.get("severity", "medium"))),
                "type": str(issue.get("type", "unknown")),
                "description": str(issue.get("description", "")),
                "evidence": str(issue.get("evidence", "")).strip(),
                "owner": self._owner(str(issue.get("owner", "writer"))),
                "fix_instruction": str(issue.get("fix_instruction", "")),
                "source": str(issue.get("source", "model_review")),
            }
            if not item["evidence"] or item["evidence"] == "无法确认：缺少证据":
                item["owner"] = "admin"
                item["severity"] = "blocking"
            normalized.append(item)
        return normalized

    def _merge_local_issues(self, issues: list[dict[str, Any]], local_issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
        keys = {(issue.get("source"), issue.get("rule_id"), issue.get("description")) for issue in issues}
        for issue in local_issues:
            key = (issue.get("source"), issue.get("rule_id"), issue.get("description"))
            if key not in keys:
                issues.append(issue)
        return issues

    def _severity(self, value: str) -> str:
        return value if value in {"blocking", "high", "medium", "low"} else "medium"

    def _owner(self, value: str) -> str:
        return value if value in {"writer", "outliner", "state", "admin"} else "admin"

    def _has_blocking_issue(self, issues: list[dict[str, Any]]) -> bool:
        return any(issue.get("severity") in {"blocking", "high", "medium"} for issue in issues)

    def _artifact(self, artifact_id: int) -> Artifact:
        artifact = self.session.get(Artifact, artifact_id)
        if artifact is None:
            raise NotFoundError("Artifact not found")
        return artifact

    def _base_chapter(self, artifact: Artifact) -> Chapter:
        if artifact.base_chapter_id is None:
            raise PipelineReviewError("Candidate artifact is not bound to a chapter")
        chapter = self.session.get(Chapter, artifact.base_chapter_id)
        if chapter is None:
            raise PipelineReviewError("Base chapter not found")
        return chapter

    def _artifact_text(self, artifact: Artifact) -> str:
        return self._runtime_safe_path(artifact.path).read_text(encoding="utf-8")

    def _validate_artifact_file(self, artifact: Artifact) -> None:
        path = self._runtime_safe_path(artifact.path)
        if not path.exists():
            raise PipelineReviewError("Artifact file is missing")
        if sha256_file(path) != artifact.sha256:
            raise PipelineReviewError("Artifact file hash mismatch")

    def _runtime_safe_path(self, relative_path: str):
        root = self.runtime_root.resolve()
        path = (root / relative_path).resolve()
        if path != root and root not in path.parents:
            raise PipelineReviewError("Artifact path escapes runtime root")
        return path
