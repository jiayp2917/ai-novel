import json
from datetime import UTC, datetime

from backend.app.db.models import Artifact, Job, ModelCall, PublishDecision, Review
from backend.tools.model_usage_report import render_report


def test_model_usage_report_includes_quality_and_context_metrics() -> None:
    calls = [
        ModelCall(
            role="reviewer",
            provider="deepseek",
            model="deepseek-v4-pro",
            prompt_hash="a" * 64,
            input_chars=1200,
            output_chars=300,
            usage_json='{"usage_source": "provider", "total_tokens": 700, "elapsed_seconds": 1.5}',
            cost_estimate=0.0007,
            cache_hit=False,
            status="succeeded",
        ),
        ModelCall(
            role="writer",
            provider="kimi",
            model="kimi-k2.6",
            prompt_hash="b" * 64,
            input_chars=5000,
            output_chars=0,
            usage_json="null",
            cost_estimate=0.2,
            cache_hit=False,
            status="failed",
            error="timeout; call_id=2",
        ),
    ]
    artifacts = [
        Artifact(
            id=1,
            kind="candidate",
            path="artifacts/candidate/a.md",
            sha256="c" * 64,
            metadata_json=json.dumps(
                {
                    "task_type": "generate_chapter_draft",
                    "role": "writer",
                    "provider": "kimi",
                    "model": "kimi-k2.6",
                    "context_report": {
                        "input_chars": 18000,
                        "context_degraded": True,
                        "dropped_sections": [{"name": "timeline", "chars": 1200}],
                    },
                }
            ),
        ),
        Artifact(
            id=2,
            kind="review",
            path="artifacts/review/b.txt",
            sha256="d" * 64,
            metadata_json='{"parse_failed": true}',
        ),
    ]
    reviews = [
        Review(
            artifact_id=1,
            passed=False,
            evidence_count=1,
            manual_required=True,
            issues_json=json.dumps(
                [
                    {
                        "owner": "writer",
                        "severity": "medium",
                        "evidence": "原文证据",
                        "source": "model_review",
                    },
                    {
                        "owner": "admin",
                        "severity": "blocking",
                        "evidence": "无法确认：缺少证据",
                        "source": "model_review",
                    },
                    {
                        "owner": "writer",
                        "severity": "medium",
                        "evidence": "当前中文字符数：1200",
                        "source": "local_rule",
                    },
                ],
                ensure_ascii=False,
            ),
        )
    ]
    decisions = [
        PublishDecision(
            artifact_id=1,
            approved_by_user=True,
            force=False,
            source_hash_before="e" * 64,
            candidate_hash="f" * 64,
            diff_path="diffs/a.diff",
            backup_path="backups/a.md",
            published_at=datetime.now(UTC),
        )
    ]

    report = render_report(calls, [Job(type="x", status="done", payload_json="{}")], reviews=reviews, artifacts=artifacts, decisions=decisions)

    assert "日志可见 token/usage 下限" in report
    assert "| reviewer | deepseek | deepseek-v4-pro | 1 | 100.0%" in report
    assert "| writer | kimi | kimi-k2.6 | 1 | 0.0%" in report
    assert "Provider Tokens | Estimate(M tokens)" in report
    assert "| reviewer | deepseek | deepseek-v4-pro | 1 | 100.0% | 0 | 0 | 1200.0 | 300.0 | 700 | 0.000700 |" in report
    assert "| writer | kimi | kimi-k2.6 | 1 | 0.0% | 1 | 0 | 5000.0 | 0.0 | 0 | 0.200000 |" in report
    assert "| Evidence Issue Rate | 66.7% |" in report
    assert "| No Evidence Issues | 1 |" in report
    assert "| Local Rule Issues | 1 |" in report
    assert "| Review JSON Parse Failed | 1 |" in report
    assert "- Context degraded: 1" in report
    assert "| Publish Decisions | 1 |" in report
    assert "timeout" in report
