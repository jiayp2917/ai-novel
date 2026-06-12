from typing import Any


def child_task_ids(payload: dict[str, Any]) -> list[int]:
    return [item for item in payload.get("child_task_ids", []) if isinstance(item, int)]
