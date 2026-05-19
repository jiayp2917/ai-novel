from __future__ import annotations

import os
import re
from pathlib import Path


KEY_PATTERN = re.compile(
    r"""^\s*(?:\$env:)?(?P<name>[A-Z][A-Z0-9_]*API_KEY)\s*=\s*(?P<quote>["']?)(?P<value>.+?)(?P=quote)\s*$"""
)
PROVIDER_KEY_ENV = {
    "deepseek": "DEEPSEEK_API_KEY",
    "kimi": "KIMI_API_KEY",
    "moonshot": "KIMI_API_KEY",
    "qwen": "QWEN_API_KEY",
    "dashscope": "QWEN_API_KEY",
    "glm": "GLM_API_KEY",
    "zhipu": "GLM_API_KEY",
}


def load_key_file(path: Path | str = "key.txt", *, override: bool = False) -> dict[str, str]:
    key_path = Path(path)
    if not key_path.exists():
        return {}
    loaded: dict[str, str] = {}
    unlabeled_values: list[str] = []
    for raw_line in key_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = KEY_PATTERN.match(line)
        if match:
            name = match.group("name")
            value = _clean_value(match.group("value"))
        else:
            parsed = _parse_provider_line(line)
            if parsed is None:
                unlabeled = _parse_unlabeled_key(line)
                if unlabeled:
                    unlabeled_values.append(unlabeled)
                continue
            name, value = parsed
        if value:
            _set_key(name, value, loaded, override=override)
    if "KIMI_API_KEY" not in loaded and not os.getenv("KIMI_API_KEY") and len(unlabeled_values) == 1:
        _set_key("KIMI_API_KEY", unlabeled_values[0], loaded, override=override)
    return loaded


def loaded_key_names(path: Path | str = "key.txt") -> list[str]:
    return sorted(load_key_file(path).keys())


def _clean_value(value: str) -> str:
    value = value.strip()
    for marker in (" //", " #"):
        if marker in value:
            value = value.split(marker, 1)[0].strip()
    return value.strip("\"'")


def _parse_provider_line(line: str) -> tuple[str, str] | None:
    for separator in ("=", ":", "\uff1a", "锛?"):
        if separator not in line:
            continue
        label, value = line.split(separator, 1)
        normalized_label = label.strip()
        env_name = (
            normalized_label.upper()
            if normalized_label.upper() in set(PROVIDER_KEY_ENV.values())
            else PROVIDER_KEY_ENV.get(normalized_label.lower())
        )
        if env_name is None:
            continue
        cleaned = _clean_value(value)
        return (env_name, cleaned) if cleaned else None

    parts = line.split()
    if len(parts) < 2:
        return None
    first = parts[0].strip().lower()
    last = parts[-1].strip().lower()
    if first in PROVIDER_KEY_ENV:
        cleaned = _clean_value(" ".join(parts[1:]))
        return (PROVIDER_KEY_ENV[first], cleaned) if cleaned else None
    if last in PROVIDER_KEY_ENV:
        cleaned = _clean_value(" ".join(parts[:-1]))
        return (PROVIDER_KEY_ENV[last], cleaned) if cleaned else None
    return None


def _parse_unlabeled_key(line: str) -> str | None:
    value = _clean_value(line)
    if not value or any(char.isspace() for char in value):
        return None
    return value


def _set_key(name: str, value: str, loaded: dict[str, str], *, override: bool) -> None:
    if override or not os.getenv(name):
        os.environ[name] = value
    loaded[name] = value
