import re
from typing import Any


TARGET_CHARS_MIN = 2000
TARGET_CHARS_MAX = 2600
TARGET_CHARS_HARD_MIN = 1900
TARGET_CHARS_HARD_MAX = 2700

CHINESE_CHAR_RE = re.compile(r"[\u4e00-\u9fff]")
CHAPTER_HEADING_RE = re.compile(r"^\s*#{1,6}\s*第\s*0*(\d+)\s*章")


def count_chinese_chars(text: str) -> int:
    return len(CHINESE_CHAR_RE.findall(text))


def make_rule_issue(
    *,
    chapter_no: int,
    rule_id: str,
    severity: str,
    issue_type: str,
    description: str,
    evidence: str,
    fix_instruction: str,
) -> dict[str, Any]:
    return {
        "chapter": chapter_no,
        "severity": severity,
        "type": issue_type,
        "description": description,
        "evidence": evidence,
        "owner": "writer",
        "fix_instruction": fix_instruction,
        "source": "local_rule",
        "rule_id": rule_id,
    }


def run_local_rules(chapter_no: int, text: str) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    issues.extend(audit_heading(chapter_no, text))
    issues.extend(audit_word_count(chapter_no, text))
    issues.extend(audit_repeated_clauses(chapter_no, text))
    issues.extend(audit_markdown_shape(chapter_no, text))
    return issues


def audit_heading(chapter_no: int, text: str) -> list[dict[str, Any]]:
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    match = CHAPTER_HEADING_RE.match(first_line)
    if not match:
        return [
            make_rule_issue(
                chapter_no=chapter_no,
                rule_id="chapter_heading_missing",
                severity="blocking",
                issue_type="format",
                description="章节候选必须以 Markdown 章节标题开头。",
                evidence=first_line[:120],
                fix_instruction="保留且只保留当前章节标题，正文从标题下一行开始。",
            )
        ]
    found = int(match.group(1))
    if found != chapter_no:
        return [
            make_rule_issue(
                chapter_no=chapter_no,
                rule_id="chapter_number_mismatch",
                severity="blocking",
                issue_type="format",
                description=f"章节编号不匹配，应为第{chapter_no:03d}章，实际为第{found:03d}章。",
                evidence=first_line[:120],
                fix_instruction="恢复当前章节编号，不要改章名和章节归属。",
            )
        ]
    return []


def audit_word_count(chapter_no: int, text: str) -> list[dict[str, Any]]:
    count = count_chinese_chars(text)
    if TARGET_CHARS_HARD_MIN <= count <= TARGET_CHARS_HARD_MAX:
        return []
    if count < TARGET_CHARS_HARD_MIN:
        return [
            make_rule_issue(
                chapter_no=chapter_no,
                rule_id="word_count_min",
                severity="medium",
                issue_type="length",
                description=(
                    f"中文字符数不足，当前{count}字，目标{TARGET_CHARS_MIN}-{TARGET_CHARS_MAX}字，"
                    f"硬容忍范围{TARGET_CHARS_HARD_MIN}-{TARGET_CHARS_HARD_MAX}字。"
                ),
                evidence=f"当前中文字符数：{count}",
                fix_instruction="在不新增设定和新支线的前提下，按章纲补足场景、动作、对话和人物反应。",
            )
        ]
    return [
        make_rule_issue(
            chapter_no=chapter_no,
            rule_id="word_count_max",
            severity="medium",
            issue_type="length",
            description=(
                f"中文字符数超出，当前{count}字，目标{TARGET_CHARS_MIN}-{TARGET_CHARS_MAX}字，"
                f"硬容忍范围{TARGET_CHARS_HARD_MIN}-{TARGET_CHARS_HARD_MAX}字。"
            ),
            evidence=f"当前中文字符数：{count}",
            fix_instruction="删除重复解释、低信息密度反应和空转描写，保留剧情推进。",
        )
    ]


def audit_markdown_shape(chapter_no: int, text: str) -> list[dict[str, Any]]:
    heading_lines = [line.strip() for line in text.splitlines() if CHAPTER_HEADING_RE.match(line)]
    if len(heading_lines) <= 1:
        return []
    return [
        make_rule_issue(
            chapter_no=chapter_no,
            rule_id="multiple_chapter_headings",
            severity="blocking",
            issue_type="format",
            description="单章候选中出现多个章节标题。",
            evidence=" | ".join(heading_lines[:3]),
            fix_instruction="输出必须是单章正文，删除其他章节标题和跨章内容。",
        )
    ]


def audit_repeated_clauses(chapter_no: int, text: str) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for part in re.split(r"[。！？!?；;\n]+", text):
        clause = normalize_clause(part)
        if len(CHINESE_CHAR_RE.findall(clause)) < 16:
            continue
        if CHAPTER_HEADING_RE.match(clause):
            continue
        counts[clause] = counts.get(clause, 0) + 1
    repeated = [(clause, count) for clause, count in counts.items() if count >= 3]
    if not repeated:
        return []
    clause, count = max(repeated, key=lambda item: (item[1], len(item[0])))
    return [
        make_rule_issue(
            chapter_no=chapter_no,
            rule_id="repeated_clause",
            severity="medium",
            issue_type="style",
            description=f"同一长句或近似段落重复出现{count}次。",
            evidence=clause[:160],
            fix_instruction="删减重复句，改为新的动作、反应或信息推进。",
        )
    ]


def normalize_clause(clause: str) -> str:
    clause = re.sub(r"\s+", "", clause)
    clause = re.sub(r"^[#>*-]+", "", clause)
    return clause.strip()

