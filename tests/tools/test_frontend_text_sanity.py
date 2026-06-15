from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND_SRC = ROOT / "frontend" / "src"
SUSPECT_TEXT = ("灏", "鍚", "姝", "璁", "妯", "瀹", "淇", "绔", "鈥", "涓", "�")


def test_frontend_user_text_has_no_common_mojibake() -> None:
    offenders: list[str] = []
    for path in FRONTEND_SRC.rglob("*"):
      if path.suffix not in {".ts", ".tsx", ".css"}:
          continue
      text = path.read_text(encoding="utf-8")
      if any(marker in text for marker in SUSPECT_TEXT):
          offenders.append(str(path.relative_to(ROOT)))

    assert offenders == []
