import type { Annotation } from '../types';
import { annotationStatusLabel, annotationTypeLabel, severityLabel } from '../utils';
import { AnnotationDetail, type AnnotationUpdatePayload } from './AnnotationDetail';
import { Button } from './ui/Button';

export function AnnotationList({
  annotations,
  loading,
  hasScope,
  selectedAnnotationId,
  selectedAnnotationIds,
  chapterText,
  updatingAnnotationId,
  deletingAnnotationId,
  relocatingAnnotationId,
  onSelect,
  onToggleForRevision,
  onRelocate,
  onUpdate,
  onDelete,
}: {
  annotations: Annotation[];
  loading: boolean;
  hasScope: boolean;
  selectedAnnotationId: number | null;
  selectedAnnotationIds: number[];
  chapterText: string;
  updatingAnnotationId: number | null;
  deletingAnnotationId: number | null;
  relocatingAnnotationId: number | null;
  onSelect: (annotationId: number) => void;
  onToggleForRevision: (annotationId: number) => void;
  onRelocate: (annotationId: number) => void;
  onUpdate: (annotation: Annotation, payload: AnnotationUpdatePayload) => void;
  onDelete: (annotation: Annotation) => void;
}) {
  return (
    <div className="annotation-list">
      {!hasScope && <p className="muted">选择设定、章纲或正文后查看批注。</p>}
      {loading && <p className="muted">正在加载批注...</p>}
      {annotations.map((annotation) => (
        <article
          className={[
            'annotation-card',
            annotation.id === selectedAnnotationId ? 'annotation-card--active' : '',
            annotation.status === 'needs_relocate' ? 'annotation-card--relocate' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          key={annotation.id}
        >
          <label className="annotation-check">
            <input
              type="checkbox"
              checked={selectedAnnotationIds.includes(annotation.id)}
              onChange={() => onToggleForRevision(annotation.id)}
            />
            选入修订
          </label>
          <button type="button" className="annotation-card__main" onClick={() => onSelect(annotation.id)}>
            <span className="annotation-card__meta">
              {annotationTypeLabel(annotation.type)} / {severityLabel(annotation.severity)} / {annotationStatusLabel(annotation.status)}
            </span>
            <strong>{annotation.quote_text || '无引用文本'}</strong>
            <p>{annotation.comment}</p>
          </button>
          {annotation.status === 'needs_relocate' && (
            <div className="annotation-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onRelocate(annotation.id)}
                disabled={relocatingAnnotationId === annotation.id}
              >
                自动定位
              </Button>
            </div>
          )}
          <AnnotationDetail
            annotation={annotation}
            chapterText={chapterText}
            updating={updatingAnnotationId === annotation.id}
            deleting={deletingAnnotationId === annotation.id}
            onUpdate={(payload) => onUpdate(annotation, payload)}
            onDelete={() => onDelete(annotation)}
          />
        </article>
      ))}
      {hasScope && !loading && annotations.length === 0 && <p className="muted">暂无批注。</p>}
    </div>
  );
}
