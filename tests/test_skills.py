import json
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.db.models import Artifact
from backend.app.main import app
from backend.app.services.skills import SkillLoader, parse_enabled, skill_usage_from_artifacts


def write_skill(root: Path, relative: str, *, role: str, enabled: str = "true", body: str = "规则正文") -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "---",
                f"name: {path.stem}",
                "version: 1",
                f"role: {role}",
                "scope: test",
                f"enabled: {enabled}",
                "---",
                "",
                body,
            ]
        ),
        encoding="utf-8",
    )


def test_skill_loader_filters_by_task_and_role(tmp_path: Path) -> None:
    write_skill(tmp_path, "writing/fanqie_style.md", role="writer", body="写作规则")
    write_skill(tmp_path, "writing/chapter_body_rules.md", role="writer", body="章节正文规则")
    write_skill(tmp_path, "review/evidence_guard.md", role="reviewer", body="证据规则")
    write_skill(tmp_path, "review/hallucination_guard.md", role="reviewer", body="幻觉约束")

    writer_skills = SkillLoader(tmp_path).load_for_task("generate_chapter_draft")
    reviewer_skills = SkillLoader(tmp_path).load_for_task("review_chapter_candidate")

    assert [skill.path for skill in writer_skills] == ["writing/fanqie_style.md", "writing/chapter_body_rules.md"]
    assert [skill.path for skill in reviewer_skills] == ["review/evidence_guard.md", "review/hallucination_guard.md"]
    assert all(skill.sha256 for skill in writer_skills + reviewer_skills)


def test_skill_loader_includes_numeric_xianxia_style_when_present(tmp_path: Path) -> None:
    write_skill(tmp_path, "writing/fanqie_style.md", role="writer", body="style")
    write_skill(tmp_path, "writing/chapter_body_rules.md", role="writer", body="chapter rules")
    write_skill(tmp_path, "writing/numeric_xianxia_style.md", role="writer", body="numeric style")

    skills = SkillLoader(tmp_path).load_for_task("generate_chapter_draft")

    assert [skill.path for skill in skills] == [
        "writing/fanqie_style.md",
        "writing/chapter_body_rules.md",
        "writing/numeric_xianxia_style.md",
    ]
    assert skills[-1].name == "numeric_xianxia_style"
    assert skills[-1].role == "writer"
    assert skills[-1].scope == "test"
    assert skills[-1].enabled is True


def test_skill_loader_respects_disabled_front_matter(tmp_path: Path) -> None:
    write_skill(tmp_path, "fix/no_new_setting.md", role="fixer", enabled="false")
    write_skill(tmp_path, "fix/patch_rules.md", role="fixer", enabled="true")

    skills = SkillLoader(tmp_path).load_for_task("fix_chapter_candidate")

    assert [skill.path for skill in skills] == ["fix/patch_rules.md"]


def test_skill_loader_lists_enabled_skills_with_metadata(tmp_path: Path) -> None:
    write_skill(tmp_path, "memory/clue_extraction.md", role="memory", body="记忆规则")
    write_skill(tmp_path, "outline/webnovel_structure.md", role="outliner", enabled="off")

    payload = SkillLoader(tmp_path).list_enabled()

    assert len(payload) == 1
    assert payload[0]["name"] == "clue_extraction"
    assert payload[0]["role"] == "memory"
    assert payload[0]["path"] == "memory/clue_extraction.md"
    assert len(payload[0]["sha256"]) == 64
    assert payload[0]["last_used_at"] is None
    assert payload[0]["included_in_latest_context"] is False


def test_skill_loader_enriches_recent_usage_from_context_reports(tmp_path: Path) -> None:
    write_skill(tmp_path / "skills", "review/evidence_guard.md", role="reviewer", body="证据规则")
    enabled = SkillLoader(tmp_path / "skills").list_enabled()[0]
    runtime_root = tmp_path / "runtime"
    artifact = Artifact(
        id=7,
        kind="candidate",
        path="artifacts/candidate/a.md",
        sha256="a" * 64,
        base_chapter_id=3,
        created_at=datetime(2026, 5, 19, tzinfo=UTC),
        metadata_json=json.dumps(
            {
                "task_type": "review_chapter_candidate",
                "context_report": {
                    "chapter_id": 3,
                    "task_type": "review_chapter_candidate",
                    "skills": [
                        {
                            "name": enabled["name"],
                            "version": enabled["version"],
                            "role": enabled["role"],
                            "scope": enabled["scope"],
                            "enabled": True,
                            "path": enabled["path"],
                            "sha256": enabled["sha256"],
                        }
                    ],
                },
            },
            ensure_ascii=False,
        ),
    )

    payload = SkillLoader(tmp_path / "skills").list_enabled_with_usage([artifact], runtime_root)

    assert payload[0]["last_used_task_type"] == "review_chapter_candidate"
    assert payload[0]["last_used_artifact_id"] == 7
    assert payload[0]["last_used_chapter_id"] == 3
    assert payload[0]["included_in_latest_context"] is True


def test_skill_usage_from_artifacts_ignores_runtime_escape(tmp_path: Path) -> None:
    artifact = Artifact(
        id=1,
        kind="context_report",
        path="../outside.json",
        sha256="a" * 64,
        metadata_json=json.dumps({"context_degraded": True}),
    )

    usage = skill_usage_from_artifacts([artifact], tmp_path / "runtime")

    assert usage["by_path"] == {}


def test_parse_enabled_accepts_common_disabled_values() -> None:
    assert parse_enabled("true") is True
    assert parse_enabled("1") is True
    assert parse_enabled("disabled") is False
    assert parse_enabled("off") is False


def test_admin_skills_endpoint_returns_enabled_project_skills() -> None:
    response = TestClient(app).get("/api/admin/skills")

    assert response.status_code == 200
    skills = response.json()["skills"]
    paths = {skill["path"] for skill in skills}
    assert "writing/fanqie_style.md" in paths
    assert "writing/numeric_xianxia_style.md" in paths
    assert "review/evidence_guard.md" in paths
    assert "review/hallucination_guard.md" in paths
