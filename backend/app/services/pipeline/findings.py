import hashlib
import json
from typing import Any


MISSING_EVIDENCE_PREFIX = "Unable to verify: missing evidence"


def normalize_review_findings(issues: Any) -> list[dict[str, Any]]:
    if not isinstance(issues, list):
        issues = [
            {
                "chapter": None,
                "severity": "blocking",
                "type": "invalid_review",
                "description": "Review issues field is not a list.",
                "evidence": "",
                "owner": "admin",
                "fix_instruction": "Regenerate review with the required schema.",
            }
        ]
    normalized: list[dict[str, Any]] = []
    for raw in issues:
        if not isinstance(raw, dict):
            continue
        evidence = str(raw.get("evidence", "")).strip()
        fix_instruction = str(raw.get("fix_instruction", "")).strip()
        owner = _owner(str(raw.get("owner", "writer")))
        severity = _severity(str(raw.get("severity", "medium")))
        if not evidence:
            owner = "admin"
            severity = "blocking"
            evidence = MISSING_EVIDENCE_PREFIX
        item = {
            "chapter": raw.get("chapter"),
            "severity": severity,
            "type": str(raw.get("type", "unknown")),
            "description": str(raw.get("description", "")),
            "evidence": evidence,
            "owner": owner,
            "fix_instruction": fix_instruction,
            "source": str(raw.get("source", "model_review")),
        }
        if "rule_id" in raw:
            item["rule_id"] = str(raw.get("rule_id"))
        item["authorized_for_fixer"] = _authorized_for_fixer(item)
        item["finding_id"] = str(raw.get("finding_id") or _finding_id(item))
        normalized.append(item)
    return normalized


def has_blocking_finding(issues: list[dict[str, Any]]) -> bool:
    return any(issue.get("severity") in {"blocking", "high", "medium"} for issue in issues)


def authorized_writer_findings(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        issue
        for issue in issues
        if isinstance(issue, dict) and issue.get("owner") == "writer" and issue.get("authorized_for_fixer") is True
    ]


def unauthorized_findings(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [issue for issue in issues if isinstance(issue, dict) and issue.get("authorized_for_fixer") is not True]


def _authorized_for_fixer(issue: dict[str, Any]) -> bool:
    return (
        issue.get("owner") == "writer"
        and bool(str(issue.get("evidence", "")).strip())
        and str(issue.get("evidence", "")).strip() != MISSING_EVIDENCE_PREFIX
        and bool(str(issue.get("fix_instruction", "")).strip())
    )


def _severity(value: str) -> str:
    return value if value in {"blocking", "high", "medium", "low"} else "medium"


def _owner(value: str) -> str:
    return value if value in {"writer", "outliner", "state", "admin"} else "admin"


def _finding_id(issue: dict[str, Any]) -> str:
    payload = {
        "chapter": issue.get("chapter"),
        "severity": issue.get("severity"),
        "type": issue.get("type"),
        "description": issue.get("description"),
        "evidence": issue.get("evidence"),
        "owner": issue.get("owner"),
        "fix_instruction": issue.get("fix_instruction"),
        "source": issue.get("source"),
        "rule_id": issue.get("rule_id"),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]
