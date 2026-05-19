import { useMemo, useState } from 'react';
import type { AnnotationPayload, SelectionRange } from '../types';
import {
  ANNOTATION_TYPES,
  SEVERITIES,
  annotationTypeLabel,
  severityLabel,
  utf16ToCodePointOffset,
} from '../utils';

export function AnnotationComposer({
  selection,
  contentText,
  disabled = false,
  onSubmit,
}: {
  selection: SelectionRange | null;
  contentText: string;
  disabled?: boolean;
  onSubmit: (payload: AnnotationPayload) => void;
}) {
  const [type, setType] = useState<(typeof ANNOTATION_TYPES)[number]>('logic');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('medium');
  const [manualQuote, setManualQuote] = useState('');
  const [comment, setComment] = useState('');
  const [exampleRewrite, setExampleRewrite] = useState('');

  const manualRange = useMemo(() => {
    const quote = manualQuote.trim();
    if (!quote || !contentText) {
      return null;
    }
    const first = contentText.indexOf(quote);
    if (first < 0) {
      return { status: 'missing' as const };
    }
    const second = contentText.indexOf(quote, first + quote.length);
    if (second >= 0) {
      return { status: 'duplicate' as const };
    }
    return {
      status: 'ok' as const,
      range_start: utf16ToCodePointOffset(contentText, first),
      range_end: utf16ToCodePointOffset(contentText, first + quote.length),
      text: quote,
    };
  }, [contentText, manualQuote]);

  const resolvedSelection = selection
    ? { range_start: selection.fromCodePoint, range_end: selection.toCodePoint, text: selection.text }
    : manualRange?.status === 'ok'
      ? manualRange
      : null;
  const canSubmit = Boolean(resolvedSelection && comment.trim()) && !disabled;

  const reset = () => {
    setManualQuote('');
    setComment('');
    setExampleRewrite('');
  };

  return (
    <form
      className="annotation-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!resolvedSelection || !canSubmit) {
          return;
        }
        onSubmit({
          range_start: resolvedSelection.range_start,
          range_end: resolvedSelection.range_end,
          type,
          severity,
          comment: comment.trim(),
          example_rewrite: exampleRewrite.trim() || null,
        });
        reset();
      }}
    >
      <div className="quote-source">
        {selection ? (
          <span>已使用拖选文本：{selection.text.slice(0, 80)}</span>
        ) : (
          <label>
            引用文本
            <input
              value={manualQuote}
              onChange={(event) => setManualQuote(event.target.value)}
              placeholder="没有拖选时，可粘贴一段原文；系统会自动定位唯一匹配。"
            />
          </label>
        )}
        {!selection && manualRange?.status === 'missing' && <p className="form-hint form-hint--error">当前文档中没有找到这段引用。</p>}
        {!selection && manualRange?.status === 'duplicate' && <p className="form-hint form-hint--error">这段引用出现多次，请粘贴更长的唯一片段。</p>}
        {!selection && manualRange?.status === 'ok' && <p className="form-hint">已定位唯一引用，可保存批注。</p>}
      </div>
      <div className="composer-grid">
        <label>
          类型
          <select value={type} onChange={(event) => setType(event.target.value as (typeof ANNOTATION_TYPES)[number])}>
            {ANNOTATION_TYPES.map((item) => (
              <option key={item} value={item}>{annotationTypeLabel(item)}</option>
            ))}
          </select>
        </label>
        <label>
          程度
          <select value={severity} onChange={(event) => setSeverity(event.target.value as (typeof SEVERITIES)[number])}>
            {SEVERITIES.map((item) => (
              <option key={item} value={item}>{severityLabel(item)}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        批注意见
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="记录问题、判断或人工决策。" />
      </label>
      <label>
        示例改写
        <textarea value={exampleRewrite} onChange={(event) => setExampleRewrite(event.target.value)} placeholder="可选：写一段已确认风格的改写示例。" />
      </label>
      <button type="submit" disabled={!canSubmit}>添加批注</button>
    </form>
  );
}
