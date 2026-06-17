// 覆盖范围：useChapterEditorExtensions 模块导出的纯函数 findSearchMatches。
// 仅测纯函数边界（空白/无匹配/单次/多次/重叠步进），不涉及 CodeMirror ViewPlugin 或 React hook。
import { describe, it, expect } from 'vitest';
import { findSearchMatches } from '../components/reader/useChapterEditorExtensions';

describe('findSearchMatches', () => {
  it('空白 query（trim 后为空）返回空数组', () => {
    expect(findSearchMatches('abc', '')).toEqual([]);
    expect(findSearchMatches('abc', '   ')).toEqual([]);
    expect(findSearchMatches('abc', '\t\n')).toEqual([]);
  });

  it('无匹配返回空数组', () => {
    expect(findSearchMatches('abc', 'xyz')).toEqual([]);
  });

  it('单次匹配返回 [{from, to}]', () => {
    expect(findSearchMatches('hello world', 'world')).toEqual([{ from: 6, to: 11 }]);
  });

  it('多次匹配返回多元素数组', () => {
    expect(findSearchMatches('ab ab ab', 'ab')).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
      { from: 6, to: 8 },
    ]);
  });

  it('from/to 为 utf16 偏移（含中文/emoji 不影响 offset 计算）', () => {
    // "中" 在 JS 中占 1 个 utf16 unit
    expect(findSearchMatches('中文测试中', '中')).toEqual([{ from: 0, to: 1 }, { from: 4, to: 5 }]);
  });

  it('重叠 query 步进用 query.length：text="aaa" query="aa" 只匹配 1 次', () => {
    expect(findSearchMatches('aaa', 'aa')).toEqual([{ from: 0, to: 2 }]);
  });

  it('query 含前后空格时先 trim 再搜索（trim 后 query="ab"，长度 2）', () => {
    expect(findSearchMatches('x ab y', '  ab ')).toEqual([{ from: 2, to: 4 }]);
  });
});
