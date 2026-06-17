"""
3.5 Phase migration (ALREADY RUN before v0.8 — kept for archive, no future callers): strip dead CSS rules targeting only old theme aliases (bright/anime/dark).
Strategy:
  - Tokenize CSS into selector-block pairs (ignore string/comment)
  - For each rule:
      * If ALL selectors are old-theme (`:root[data-theme="bright|anime|dark"]`),
        drop the entire rule
      * If only SOME selectors are old-theme, remove just those from the list,
        keeping the remaining selectors
"""
import re
import sys

OLD = re.compile(r':root\[data-theme="(?:bright|anime|dark)"\]\s*')

def strip_selectors(selector_text):
    parts = [p.strip() for p in selector_text.split(',')]
    kept = [p for p in parts if not OLD.match(p + ' ')]
    return kept

def strip_old_theme(text):
    out = []
    i = 0
    n = len(text)
    while i < n:
        # find next '{' (start of declaration block)
        brace = text.find('{', i)
        if brace == -1:
            out.append(text[i:])
            break
        selector = text[i:brace]
        # find matching '}' (respect strings + nested braces in @media)
        depth = 1
        j = brace + 1
        in_str = None
        while j < n and depth > 0:
            c = text[j]
            if in_str:
                if c == '\\':
                    j += 2
                    continue
                if c == in_str:
                    in_str = None
            else:
                if c in ('"', "'"):
                    in_str = c
                elif c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        break
            j += 1
        block = text[brace + 1:j]
        after = text[j:j+1]
        # Decide what to do with this rule
        selectors_in_rule = [p.strip() for p in selector.split(',')]
        kept = strip_selectors(selector)
        if not kept:
            # entire rule targets only old themes → drop
            i = j + 1
            continue
        elif len(kept) < len(selectors_in_rule):
            # some selectors removed, keep rule with remaining
            new_selector = ', '.join(kept)
            out.append(new_selector)
            out.append(' {')
            out.append(block)
            out.append('}')
            i = j + 1
        else:
            # rule untouched
            out.append(text[i:j+1])
            i = j + 1
    return ''.join(out)

if __name__ == '__main__':
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        css = f.read()
    new_css = strip_old_theme(css)
    # Counters
    print(f"original size: {len(css)} chars / {css.count(chr(10))+1} lines")
    print(f"new size: {len(new_css)} chars / {new_css.count(chr(10))+1} lines")
    remaining_pat = r':root\[data-theme="(?:bright|anime|dark)"\]'
    print(f"old-theme selectors remaining: {len(re.findall(remaining_pat, new_css))}")
    with open(sys.argv[1], 'w', encoding='utf-8') as f:
        f.write(new_css)
