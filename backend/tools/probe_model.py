import argparse
import json

from backend.app.db.session import get_session_local
from backend.app.services.model_client import ChatMessage, ModelClient


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe the configured model route for a role.")
    parser.add_argument("--role", default="reviewer")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    with get_session_local()() as session:
        response = ModelClient(session).chat(
            role=args.role,
            force=args.force,
            require_json=True,
            temperature=0.0,
            max_tokens=256,
            messages=[
                ChatMessage(role="system", content="Return strict JSON only."),
                ChatMessage(role="user", content=f'Return {{"ok": true, "role": "{args.role}"}}.'),
            ],
        )
        print(
            json.dumps(
                {
                    "role": args.role,
                    "provider": response.route.provider,
                    "model": response.route.model,
                    "cache_hit": response.cache_hit,
                    "model_call_id": response.model_call_id,
                    "content": response.content,
                    "usage": response.usage,
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
