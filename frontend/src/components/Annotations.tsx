import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '../api';
import {
  useAnnotations,
  useChapterContent,
  useSourceAnnotations,
  useSourceFileContent,
} from '../hooks';
import { useWorkbenchStore } from '../store';
import type { Annotation, AnnotationPayload } from '../types';
import { annotationStatusLabel } from '../utils';
import type { AnnotationUpdatePayload } from './AnnotationDetail';
import { AnnotationComposer } from './AnnotationForm';
import { InsightPanel } from './AnnotationInsightPanel';
import { AnnotationList } from './AnnotationList';
import { ArtifactGate } from './ArtifactGate';
import { VersionHistory } from './VersionHistory';

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
  const selectAnnotationForRevision = useWorkbenchStore((state) => state.selectAnnotationForRevision);
  const removeAnnotationFromSelection = useWorkbenchStore((state) => state.removeAnnotationFromSelection);
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

  const invalidateAnnotations = () => {
    void queryClient.invalidateQueries({ queryKey: ['annotations', selectedChapterId] });
    void queryClient.invalidateQueries({ queryKey: ['source-annotations', selectedSourceFileId] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: AnnotationPayload) =>
      apiRequest<Annotation>(
        selectedChapterId ? `/api/chapters/${selectedChapterId}/annotations` : `/api/source-files/${selectedSourceFileId}/annotations`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      ),
    onMutate: () => pushTask({ label: '创建批注', status: 'running', detail: '正在保存选中文本范围。' }),
    onSuccess: (annotation) => {
      invalidateAnnotations();
      setDraftAnnotationSelection(undefined);
      setSelectedAnnotationId(annotation.id);
      selectAnnotationForRevision(annotation.id);
      pushTask({ label: '创建批注', status: 'succeeded', detail: `批注 #${annotation.id} 已保存。` });
    },
    onError: (error: Error) => pushTask({ label: '创建批注', status: 'failed', detail: error.message }),
  });

  const relocateMutation = useMutation({
    mutationFn: (annotationId: number) => apiRequest<Annotation>(`/api/annotations/${annotationId}/relocate`, { method: 'POST' }),
    onMutate: (annotationId) => pushTask({ label: '重定位批注', status: 'running', detail: `正在检查批注 #${annotationId}。` }),
    onSuccess: (annotation) => {
      invalidateAnnotations();
      pushTask({
        label: '重定位批注',
        status: annotation.status === 'needs_relocate' ? 'failed' : 'succeeded',
        detail: annotation.status === 'needs_relocate' ? `批注 #${annotation.id} 仍需人工定位。` : `批注 #${annotation.id} 已重定位。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '重定位批注', status: 'failed', detail: error.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ annotation, payload }: { annotation: Annotation; payload: AnnotationUpdatePayload }) =>
      apiRequest<Annotation>(`/api/annotations/${annotation.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (updated) => {
      invalidateAnnotations();
      if (updated.status !== 'open' && updated.status !== 'needs_relocate') {
        removeAnnotationFromSelection(updated.id);
      }
      pushTask({ label: '更新批注', status: 'succeeded', detail: `批注 #${updated.id} 已更新为 ${annotationStatusLabel(updated.status)}。` });
    },
    onError: (error: Error) => pushTask({ label: '更新批注', status: 'failed', detail: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (annotation: Annotation) => apiRequest<{ status: string }>(`/api/annotations/${annotation.id}`, { method: 'DELETE' }),
    onSuccess: (_, annotation) => {
      invalidateAnnotations();
      removeAnnotationFromSelection(annotation.id);
      pushTask({ label: '删除批注', status: 'succeeded', detail: `批注 #${annotation.id} 已删除。` });
    },
    onError: (error: Error) => pushTask({ label: '删除批注', status: 'failed', detail: error.message }),
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
                  selection={draftAnnotationSelection}
                  contentText={activeContentText}
                  disabled={(!selectedChapterId && !selectedSourceFileId) || createMutation.isPending}
                  onSubmit={(payload) => createMutation.mutate(payload)}
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
          <AnnotationList
            annotations={activeAnnotations}
            loading={annotations.isLoading || sourceAnnotations.isLoading}
            hasScope={Boolean(selectedChapterId || selectedSourceFileId)}
            selectedAnnotationId={selectedAnnotationId}
            selectedAnnotationIds={selectedAnnotationIds}
            chapterText={activeContentText}
            updatingAnnotationId={updateMutation.variables?.annotation.id ?? null}
            deletingAnnotationId={deleteMutation.variables?.id ?? null}
            relocatingAnnotationId={relocateMutation.variables ?? null}
            onSelect={setSelectedAnnotationId}
            onToggleForRevision={toggleAnnotationSelection}
            onRelocate={(annotationId) => relocateMutation.mutate(annotationId)}
            onUpdate={(annotation, payload) => updateMutation.mutate({ annotation, payload })}
            onDelete={(annotation) => deleteMutation.mutate(annotation)}
          />
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
