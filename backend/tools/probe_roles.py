from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime

from backend.app.db.session import get_session_local
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.tools.key_env import loaded_key_names


DEFAULT_ROLES = ["reviewer", "quick_fix", "long_context", "structural_fix"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe configured model roles with real provider calls.")
    parser.add_argument("--roles", nargs="*", default=DEFAULT_ROLES)
    parser.add_argument("--key-file", default="key.txt")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--json-out", default="runtime/logs/model_probe_report.json")
    args = parser.parse_args()

    loaded = loaded_key_names(args.key_file)
    results = []
    with get_session_local()() as session:
        client = ModelClient(session)
        for role in args.roles:
            try:
                response = client.chat(
                    role=role,
                    force=args.force,
                    require_json=True,
                    temperature=0.0,
                    max_tokens=256,
                    messages=[
                        ChatMessage(role="system", content="Return strict JSON only."),
                        ChatMessage(role="user", content=f'Return {{"ok": true, "role": "{role}"}}.'),
                    ],
                )
                results.append(
                    {
                        "role": role,
                        "success": True,
                        "provider": response.route.provider,
                        "model": response.route.model,
                        "cache_hit": response.cache_hit,
                        "model_call_id": response.model_call_id,
                        "usage": response.usage,
                        "output_chars": len(response.content),
                    }
                )
            except Exception as exc:
                results.append({"role": role, "success": False, "error": str(exc)})

    report = {
        "created_at": datetime.now(UTC).isoformat(),
        "loaded_key_env_names": loaded,
        "results": results,
    }
    from pathlib import Path

    out_path = Path(args.json_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if all(item.get("success") for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
