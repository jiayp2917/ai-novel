import { useMemo, useState } from 'react';
import type { Annotation, AnnotationPayload } from '../types';
import {
  ANNOTATION_TYPES,
  SEVERITIES,
  annotationStatusLabel,
  annotationTypeLabel,
  severityLabel,
  utf16ToCodePointOffset,
} from '../utils';
import { Button } from './ui/Button';

export type AnnotationUpdatePayload = Partial<Pick<AnnotationPayload, 'range_start' | 'range_end' | 'type' | 'severity' | 'comment' | 'example_rewrite'>> & {
  status?: string;
};

export function AnnotationDetail({
  annotation,
  chapterText,
  updating,
  deleting,
  onUpdate,
  onDelete,
}: {
  annotation: Annotation;
  chapterText: string;
  updating?: boolean;
  deleting?: boolean;
  onUpdate: (payload: AnnotationUpdatePayload) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState(annotation.type);
  const [editSeverity, setEditSeverity] = useState(annotation.severity);
  const [editComment, setEditComment] = useState(annotation.comment);
  const [editExampleRewrite, setEditExampleRewrite] = useState(annotation.example_rewrite ?? '');

  return (
    <>
      {editing && (
        <form
          className="annotation-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (editComment.trim()) {
              onUpdate({
                type: editType,
                severity: editSeverity,
                comment: editComment.trim(),
                example_rewrite: editExampleRewrite.trim() || null,
              });
              setEditing(false);
            }
          }}
        >
          <div className="composer-grid">
            <label>
              类型
              <select value={editType} onChange={(event) => setEditType(event.target.value)}>
                {ANNOTATION_TYPES.map((item) => (
                  <option key={item} value={item}>{annotationTypeLabel(item)}</option>
                ))}
              </select>
            </label>
            <label>
              程度
              <select value={editSeverity} onChange={(event) => setEditSeverity(event.target.value)}>
                {SEVERITIES.map((item) => (
                  <option key={item} value={item}>{severityLabel(item)}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            批注意见
            <textarea value={editComment} onChange={(event) => setEditComment(event.target.value)} />
          </label>
          <label>
            示例改写
            <textarea value={editExampleRewrite} onChange={(event) => setEditExampleRewrite(event.target.value)} />
          </label>
          <div className="annotation-actions annotation-actions--flush">
            <Button type="submit" variant="secondary" disabled={!editComment.trim() || updating} loading={updating}>
              保存
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={updating}>
              取消
            </Button>
          </div>
        </form>
      )}
      <div className="annotation-actions">
        {annotation.status === 'needs_relocate' && (
          <ManualRelocateButton annotation={annotation} chapterText={chapterText} onUpdate={onUpdate} updating={updating} />
        )}
        <Button type="button" variant="secondary" onClick={() => setEditing((value) => !value)}>
          编辑
        </Button>
        <Button type="button" variant="secondary" onClick={() => onUpdate({ status: 'resolved' })} disabled={updating}>
          标为已处理
        </Button>
        <Button type="button" variant="secondary" onClick={() => onUpdate({ status: 'ignored' })} disabled={updating}>
          忽略
        </Button>
        {annotation.status !== 'open' && annotation.status !== 'needs_relocate' && (
          <Button type="button" variant="secondary" onClick={() => onUpdate({ status: 'open' })} disabled={updating}>
            恢复待处理
          </Button>
        )}
        <Button type="button" variant="danger" onClick={onDelete} disabled={deleting}>
          删除
        </Button>
      </div>
    </>
  );
}

function ManualRelocateButton({
  annotation,
  chapterText,
  updating,
  onUpdate,
}: {
  annotation: Annotation;
  chapterText: string;
  updating?: boolean;
  onUpdate: (payload: AnnotationUpdatePayload) => void;
}) {
  const match = useMemo(() => {
    if (!chapterText || !annotation.quote_text) {
      return null;
    }
    const first = chapterText.indexOf(annotation.quote_text);
    if (first === -1) {
      return null;
    }
    const second = chapterText.indexOf(annotation.quote_text, first + annotation.quote_text.length);
    if (second !== -1) {
      return null;
    }
    return {
      range_start: utf16ToCodePointOffset(chapterText, first),
      range_end: utf16ToCodePointOffset(chapterText, first + annotation.quote_text.length),
      status: 'open',
    };
  }, [annotation.quote_text, chapterText]);

  return (
    <Button type="button" variant="secondary" onClick={() => match && onUpdate(match)} disabled={!match || updating}>
      使用引用匹配
    </Button>
  );
}
