from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SANDBOX = ROOT / "runtime" / "sandbox_workspace"
E2E_RUNTIME = ROOT / "runtime" / "e2e_runtime"


def main() -> int:
    _safe_reset(SANDBOX)
    _safe_reset(E2E_RUNTIME)
    _write(SANDBOX / "00-系统" / "系统规则.md", "# 系统规则\n\n所有正文写回必须通过发布门。")
    _write(SANDBOX / "01-设定" / "小说设定.md", "# 小说设定\n\n主角在第一章获得异常能力。")
    _write(
        SANDBOX / "03-章纲" / "第001-002章.md",
        "## 第1章：开局觉醒\n主角完成觉醒并发现异常。\n\n## 第2章：首次测试\n主角面对第一次公开测试。",
    )
    _write(
        SANDBOX / "02-正文" / "第一卷" / "第001-002章.md",
        (
            "# 第001章 开局觉醒\n"
            "清晨的训练馆还没有完全亮起来，李燃站在队伍最后，听着测试仪的电流声一遍遍穿过大厅。"
            "他原本只想安静完成最低标准，却在指尖触碰晶片的瞬间看见一串陌生数字。"
            "老师以为仪器故障，让他重新测试。第二次，数字没有消失，反而像火线一样沿着视野铺开。"
            "李燃压住呼吸，没有立刻解释，因为他知道这不是普通成绩波动，而是某种没人记录过的能力。"
            "人群开始骚动，班长皱眉，记录员停下笔。李燃第一次意识到，自己也许不能继续躲在队伍最后。\n\n"
            "# 第002章 首次测试\n"
            "下午的公开测试换到了主馆。看台上坐满了学生，老师把李燃的名字放在最后，像是在给仪器留下缓冲时间。"
            "李燃走上测试台时，掌心仍能感觉到上午那串数字的余温。他没有炫耀，只按章程完成步伐、冲刺和反应判断。"
            "当成绩板亮起时，原本准备嘲笑的人忽然安静下来。数字不算夸张，却每一项都卡在最难解释的位置。"
            "老师没有宣布结论，只让他留下复查。李燃看向台下，发现已经有人开始记录他的每一个动作。"
            "他知道，真正的麻烦不是成绩，而是别人开始相信他藏着秘密。\n"
        ),
    )
    E2E_RUNTIME.mkdir(parents=True, exist_ok=True)
    return 0


def _safe_reset(path: Path) -> None:
    resolved = path.resolve()
    root = (ROOT / "runtime").resolve()
    if root not in resolved.parents:
        raise RuntimeError(f"Refuse to reset outside runtime: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
    resolved.mkdir(parents=True, exist_ok=True)


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
