import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiRequest } from '../api';
import {
  useAnnotationInsights,
  useAnnotations,
  useChapterContent,
  useSourceAnnotations,
  useSourceFileContent,
} from '../hooks';
import { useWorkbenchStore } from '../store';
import type { Annotation, AnnotationPayload, SelectionRange } from '../types';
import {
  ANNOTATION_TYPES,
  SEVERITIES,
  annotationStatusLabel,
  annotationTypeLabel,
  severityLabel,
  utf16ToCodePointOffset,
} from '../utils';
import { ArtifactGate } from './ArtifactGate';
import { VersionHistory } from './VersionHistory';

export function AnnotationComposer({
  chapterId,
  sourceFileId,
  selection,
  contentText,
  onCreated,
}: {
  chapterId: number | null;
  sourceFileId: number | null;
  selection: SelectionRange | null;
  contentText: string;
  onCreated: () => void;
}) {
  const [type, setType] = useState<(typeof ANNOTATION_TYPES)[number]>('logic');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('medium');
  const [manualQuote, setManualQuote] = useState('');
  const [comment, setComment] = useState('');
  const [exampleRewrite, setExampleRewrite] = useState('');
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const setSelectedAnnotationId = useWorkbenchStore((state) => state.setSelectedAnnotationId);
  const selectAnnotationForRevision = useWorkbenchStore((state) => state.selectAnnotationForRevision);

  const mutation = useMutation({
    mutationFn: (payload: AnnotationPayload) =>
      apiRequest<Annotation>(chapterId ? `/api/chapters/${chapterId}/annotations` : `/api/source-files/${sourceFileId}/annotations`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onMutate: () => pushTask({ label: '创建批注', status: 'running', detail: '正在保存选中文本范围。' }),
    onSuccess: (annotation) => {
      void queryClient.invalidateQueries({ queryKey: ['annotations', chapterId] });
      void queryClient.invalidateQueries({ queryKey: ['source-annotations', sourceFileId] });
      setManualQuote('');
      setComment('');
      setExampleRewrite('');
      onCreated();
      setSelectedAnnotationId(annotation.id);
      selectAnnotationForRevision(annotation.id);
      pushTask({ label: '创建批注', status: 'succeeded', detail: `批注 #${annotation.id} 已保存。` });
    },
    onError: (error: Error) => pushTask({ label: '创建批注', status: 'failed', detail: error.message }),
  });

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
  const canSubmit = Boolean((chapterId || sourceFileId) && resolvedSelection && comment.trim()) && !mutation.isPending;

  return (
    <form
      className="annotation-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!resolvedSelection || !canSubmit) {
          return;
        }
        mutation.mutate({
          range_start: resolvedSelection.range_start,
          range_end: resolvedSelection.range_end,
          type,
          severity,
          comment: comment.trim(),
          example_rewrite: exampleRewrite.trim() || null,
        });
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

export function AnnotationSidebar({
  embedded = false,
  showArtifactGate = true,
}: {
  embedded?: boolean;
  showArtifactGate?: boolean;
} = {}) {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const selectedAnnotationId = useWorkbenchStore((state) => state.selectedAnnotationId);
  const selectedAnnotationIds = useWorkbenchStore((state) => state.selectedAnnotationIds);
  const draftAnnotationSelection = useWorkbenchStore((state) => state.draftAnnotationSelection);
  const activeArtifactId = useWorkbenchStore((state) => state.activeArtifactId);
  const inspectorTab = useWorkbenchStore((state) => state.inspectorTab);
  const setInspectorTab = useWorkbenchStore((state) => state.setInspectorTab);
  const setSelectedAnnotationId = useWorkbenchStore((state) => state.setSelectedAnnotationId);
  const toggleAnnotationSelection = useWorkbenchStore((state) => state.toggleAnnotationSelection);
  const setDraftAnnotationSelection = useWorkbenchStore((state) => state.setDraftAnnotationSelection);
  const setActiveArtifactId = useWorkbenchStore((state) => state.setActiveArtifactId);
  const annotations = useAnnotations(selectedChapterId);
  const sourceAnnotations = useSourceAnnotations(selectedSourceFileId);
  const chapterContent = useChapterContent(selectedChapterId);
  const sourceContent = useSourceFileContent(selectedSourceFileId);
  const activeAnnotations = selectedChapterId ? annotations.data ?? [] : sourceAnnotations.data ?? [];
  const activeContentText = chapterContent.data?.text ?? sourceContent.data?.text ?? '';
  const activeArtifactKind = selectedChapterId ? 'candidate' : selectedSourceFileId ? 'proposal' : null;
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const [diffText, setDiffText] = useState('');

  const relocateMutation = useMutation({
    mutationFn: (annotationId: number) => apiRequest<Annotation>(`/api/annotations/${annotationId}/relocate`, { method: 'POST' }),
    onMutate: (annotationId) => pushTask({ label: '重定位批注', status: 'running', detail: `正在检查批注 #${annotationId}。` }),
    onSuccess: (annotation) => {
      void queryClient.invalidateQueries({ queryKey: ['annotations', selectedChapterId] });
      void queryClient.invalidateQueries({ queryKey: ['source-annotations', selectedSourceFileId] });
      pushTask({
        label: '重定位批注',
        status: annotation.status === 'needs_relocate' ? 'failed' : 'succeeded',
        detail: annotation.status === 'needs_relocate' ? `批注 #${annotation.id} 仍需人工定位。` : `批注 #${annotation.id} 已重定位。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '重定位批注', status: 'failed', detail: error.message }),
  });

  const sidebarContent = (
    <>
      <div className="panel-header">
        <div>
          <p className="eyebrow">检查器</p>
          <h2>右侧工作栏</h2>
        </div>
        <span className="count-badge">{activeAnnotations.length}</span>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="右侧工作栏">
        {[
          ['annotations', '批注'],
          ['candidates', selectedChapterId ? '候选' : '提案'],
          ['history', '版本'],
          ['review', '审核'],
          ['memory', '记忆'],
        ].map(([tab, label]) => (
          <button
            className={inspectorTab === tab ? 'inspector-tab inspector-tab--active' : 'inspector-tab'}
            key={tab}
            type="button"
            onClick={() => setInspectorTab(tab as typeof inspectorTab)}
          >
            {label}
          </button>
        ))}
      </div>
      {inspectorTab === 'annotations' && (
        <>
          <div className="annotation-compose-slot">
            {draftAnnotationSelection !== undefined ? (
              <>
                <div className="compact-title">
                  <div>
                    <p className="eyebrow">右键批注</p>
                    <h3>给选中文本添加批注</h3>
                  </div>
                  <button type="button" className="icon-button" onClick={() => setDraftAnnotationSelection(undefined)}>
                    关闭
                  </button>
                </div>
                <AnnotationComposer
                  chapterId={selectedChapterId}
                  sourceFileId={selectedSourceFileId}
                  selection={draftAnnotationSelection}
                  contentText={activeContentText}
                  onCreated={() => setDraftAnnotationSelection(undefined)}
                />
              </>
            ) : (
              <>
                <p className="form-hint">选中文本后右键创建批注；如果选区识别失败，也可以手动粘贴引用文本。</p>
                {(selectedChapterId || selectedSourceFileId) && (
                  <button type="button" className="secondary-button" onClick={() => setDraftAnnotationSelection(null)}>
                    手动创建批注
                  </button>
                )}
              </>
            )}
          </div>
          <div className="annotation-list">
            {!selectedChapterId && !selectedSourceFileId && <p className="muted">选择设定、章纲或正文后查看批注。</p>}
            {(annotations.isLoading || sourceAnnotations.isLoading) && <p className="muted">正在加载批注...</p>}
            {activeAnnotations.map((annotation) => (
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
                    onChange={() => toggleAnnotationSelection(annotation.id)}
                  />
                  选入修订
                </label>
                <button type="button" className="annotation-card__main" onClick={() => setSelectedAnnotationId(annotation.id)}>
                  <span className="annotation-card__meta">
                    {annotationTypeLabel(annotation.type)} / {severityLabel(annotation.severity)} / {annotationStatusLabel(annotation.status)}
                  </span>
                  <strong>{annotation.quote_text || '无引用文本'}</strong>
                  <p>{annotation.comment}</p>
                </button>
                {annotation.status === 'needs_relocate' && (
                  <div className="annotation-actions">
                    <button type="button" className="secondary-button" onClick={() => relocateMutation.mutate(annotation.id)} disabled={relocateMutation.isPending}>
                      自动定位
                    </button>
                    <ManualRelocateButton annotation={annotation} chapterText={activeContentText} />
                  </div>
                )}
                <AnnotationCardActions annotation={annotation} />
              </article>
            ))}
            {(selectedChapterId || selectedSourceFileId) && !(annotations.isLoading || sourceAnnotations.isLoading) && activeAnnotations.length === 0 && (
              <p className="muted">暂无批注。</p>
            )}
          </div>
        </>
      )}
      {inspectorTab === 'candidates' && (
        <div className="inspector-section inspector-section--fill">
          <div className="compact-title">
            <div>
              <p className="eyebrow">候选与发布门</p>
              <h3>{selectedChapterId ? '当前正文候选' : '当前源文件提案'}</h3>
            </div>
          </div>
          {showArtifactGate && activeArtifactKind ? (
            <ArtifactGate
              artifactId={activeArtifactId}
              setArtifactId={setActiveArtifactId}
              diffText={diffText}
              setDiffText={setDiffText}
              baseChapterId={selectedChapterId ?? undefined}
              baseSourceFileId={selectedSourceFileId ?? undefined}
              artifactKind={activeArtifactKind}
              allowPublish={Boolean(selectedChapterId)}
            />
          ) : (
            <p className="muted">选择正文、设定或章纲后查看候选/提案。</p>
          )}
        </div>
      )}
      {inspectorTab === 'history' && (
        <div className="inspector-section inspector-section--fill inspector-section--history">
          <VersionHistory chapterId={selectedChapterId} />
        </div>
      )}
      {inspectorTab === 'review' && (
        <div className="inspector-section inspector-section--fill">
          <p className="eyebrow">审核视图</p>
          <h3>审核记录与阻断原因</h3>
          <p className="muted">审核中心负责证据约束 JSON 诊断。正文页只展示入口，不在此处直接调用模型。</p>
          <button type="button" className="secondary-button" onClick={() => setInspectorTab('candidates')}>
            先选择候选
          </button>
        </div>
      )}
      {inspectorTab === 'memory' && (
        <div className="inspector-section inspector-section--fill">
          <InsightPanel />
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="annotation-sidebar-embedded">{sidebarContent}</div>;
  }

  return (
    <aside className="panel annotations-panel">
      {sidebarContent}
    </aside>
  );
}

function AnnotationCardActions({ annotation }: { annotation: Annotation }) {
  const queryClient = useQueryClient();
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const removeAnnotationFromSelection = useWorkbenchStore((state) => state.removeAnnotationFromSelection);
  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState(annotation.type);
  const [editSeverity, setEditSeverity] = useState(annotation.severity);
  const [editComment, setEditComment] = useState(annotation.comment);
  const [editExampleRewrite, setEditExampleRewrite] = useState(annotation.example_rewrite ?? '');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['annotations', selectedChapterId] });
    void queryClient.invalidateQueries({ queryKey: ['source-annotations', selectedSourceFileId] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest<Annotation>(`/api/annotations/${annotation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (updated) => {
      invalidate();
      if (updated.status !== 'open' && updated.status !== 'needs_relocate') {
        removeAnnotationFromSelection(updated.id);
      }
      pushTask({ label: '更新批注', status: 'succeeded', detail: `批注 #${updated.id} 已更新为 ${annotationStatusLabel(updated.status)}。` });
    },
    onError: (error: Error) => pushTask({ label: '更新批注', status: 'failed', detail: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest<{ status: string }>(`/api/annotations/${annotation.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      removeAnnotationFromSelection(annotation.id);
      pushTask({ label: '删除批注', status: 'succeeded', detail: `批注 #${annotation.id} 已删除。` });
    },
    onError: (error: Error) => pushTask({ label: '删除批注', status: 'failed', detail: error.message }),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      apiRequest<Annotation>(`/api/annotations/${annotation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: editType,
          severity: editSeverity,
          comment: editComment.trim(),
          example_rewrite: editExampleRewrite.trim() || null,
        }),
      }),
    onSuccess: (updated) => {
      invalidate();
      setEditing(false);
      pushTask({ label: '编辑批注', status: 'succeeded', detail: `批注 #${updated.id} 已保存。` });
    },
    onError: (error: Error) => pushTask({ label: '编辑批注', status: 'failed', detail: error.message }),
  });

  return (
    <>
      {editing && (
        <form
          className="annotation-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (editComment.trim()) {
              editMutation.mutate();
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
            <button type="submit" className="secondary-button" disabled={!editComment.trim() || editMutation.isPending}>
              保存
            </button>
            <button type="button" className="secondary-button" onClick={() => setEditing(false)} disabled={editMutation.isPending}>
              取消
            </button>
          </div>
        </form>
      )}
      <div className="annotation-actions">
        <button type="button" className="secondary-button" onClick={() => setEditing((value) => !value)}>
          编辑
        </button>
        <button type="button" className="secondary-button" onClick={() => statusMutation.mutate('resolved')} disabled={statusMutation.isPending}>
          标为已处理
        </button>
        <button type="button" className="secondary-button" onClick={() => statusMutation.mutate('ignored')} disabled={statusMutation.isPending}>
          忽略
        </button>
        {annotation.status !== 'open' && annotation.status !== 'needs_relocate' && (
          <button type="button" className="secondary-button" onClick={() => statusMutation.mutate('open')} disabled={statusMutation.isPending}>
            恢复待处理
          </button>
        )}
        <button type="button" className="secondary-button danger-button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
          删除
        </button>
      </div>
    </>
  );
}

export function InsightPanel() {
  const insights = useAnnotationInsights();
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);

  const learnMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ created: number; insight_ids: number[] }>('/api/annotations/learn', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onMutate: () => pushTask({ label: '学习批注', status: 'running', detail: '正在提取可复用规则。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['annotation-insights'] });
      pushTask({ label: '学习批注', status: 'succeeded', detail: `已生成 ${result.created} 条规则。` });
    },
    onError: (error: Error) => pushTask({ label: '学习批注', status: 'failed', detail: error.message }),
  });

  return (
    <section className="insight-panel">
      <div className="insight-header">
        <div>
          <p className="eyebrow">已学习规则</p>
          <h3>批注洞察</h3>
        </div>
        <button className="secondary-button" type="button" onClick={() => learnMutation.mutate()} disabled={learnMutation.isPending}>
          学习
        </button>
      </div>
      <div className="insight-list">
        {insights.isLoading && <p className="muted">正在加载规则...</p>}
        {(insights.data ?? []).map((insight) => (
          <article className={insight.enabled ? 'insight-card' : 'insight-card insight-card--disabled'} key={insight.id}>
            <div className="insight-card__top">
              <strong>{insight.kind}</strong>
              <span>置信度 {insight.confidence.toFixed(2)}</span>
            </div>
            <p>{insight.content}</p>
          </article>
        ))}
        {!insights.isLoading && (insights.data ?? []).length === 0 && <p className="muted">暂无已学习规则。</p>}
      </div>
    </section>
  );
}

function ManualRelocateButton({ annotation, chapterText }: { annotation: Annotation; chapterText: string }) {
  const queryClient = useQueryClient();
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const pushTask = useWorkbenchStore((state) => state.pushTask);

  const mutation = useMutation({
    mutationFn: (payload: Pick<AnnotationPayload, 'range_start' | 'range_end'> & { status: string }) =>
      apiRequest<Annotation>(`/api/annotations/${annotation.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onMutate: () => pushTask({ label: '人工定位', status: 'running', detail: `正在移动批注 #${annotation.id}。` }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['annotations', selectedChapterId] });
      void queryClient.invalidateQueries({ queryKey: ['source-annotations', selectedSourceFileId] });
      pushTask({ label: '人工定位', status: 'succeeded', detail: `批注 #${updated.id} 已移动到唯一匹配引用。` });
    },
    onError: (error: Error) => pushTask({ label: '人工定位', status: 'failed', detail: error.message }),
  });

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
    <button type="button" className="secondary-button" onClick={() => match && mutation.mutate(match)} disabled={!match || mutation.isPending}>
      使用引用匹配
    </button>
  );
}
