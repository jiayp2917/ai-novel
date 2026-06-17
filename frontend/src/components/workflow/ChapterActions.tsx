import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '../../api';
import { useWorkbenchStore } from '../../store';
import { useToast } from '../ui/Toast';
import type { ContextPreview } from '../../types';
import { ArtifactGate } from '../ArtifactGate';

export function ChapterActions({
  chapterId,
  mode = 'full',
}: {
  chapterId: number;
  mode?: 'full' | 'writing' | 'review' | 'publish';
}) {
  const [artifactId, setArtifactId] = useState<number | null>(null);
  const [diffText, setDiffText] = useState('');
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const selectedAnnotationIds = useWorkbenchStore((state) => state.selectedAnnotationIds);
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const reviseMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ job_id: number; status: string }>(`/api/chapters/${chapterId}/revise-from-annotations`, {
        method: 'POST',
        body: JSON.stringify({ annotation_ids: selectedAnnotationIds }),
      }),
    onMutate: () =>
      pushTask({
        label: '创建修订任务',
        status: 'running',
        detail: selectedAnnotationIds.length
          ? `按 ${selectedAnnotationIds.length} 条批注创建修订草稿。`
          : '未勾选批注，将使用当前章节全部可用批注创建修订草稿。',
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.refetchQueries({ queryKey: ['jobs'] });
      pushTask({ label: '创建修订任务', status: 'succeeded', detail: `任务 #${result.job_id} 已进入队列。` });
    },
    onError: (error: Error) => {
      pushTask({ label: '创建修订任务', status: 'failed', detail: error.message });
      showToast(`创建修订任务失败：${error.message}`, 'error');
    },
  });

  const runJobsMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ started: number; succeeded: number; failed: number; jobs: Array<{ id: number; status: string }> }>(
        '/api/jobs/run-once',
        { method: 'POST' },
      ),
    onMutate: () => pushTask({ label: '推进待处理任务', status: 'running', detail: '正在处理待办任务。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.refetchQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      pushTask({
        label: '推进待处理任务',
        status: result.failed ? 'failed' : 'succeeded',
        detail: `启动 ${result.started}，成功 ${result.succeeded}，失败 ${result.failed}。`,
      });
    },
    onError: (error: Error) => {
      pushTask({ label: '推进待处理任务', status: 'failed', detail: error.message });
      showToast(`推进待处理任务失败：${error.message}`, 'error');
    },
  });

  const contextMutation = useMutation({
    mutationFn: () => apiRequest<ContextPreview>(`/api/memory/context-preview?chapter_id=${chapterId}`),
    onSuccess: (result) => {
      setPreview(result);
      pushTask({
        label: '上下文预览',
        status: 'succeeded',
        detail: `核心事实 ${result.core_facts.length} 条，批注规则 ${result.annotation_insights.length} 条。`,
      });
    },
    onError: (error: Error) => {
      pushTask({ label: '上下文预览', status: 'failed', detail: error.message });
      showToast(`上下文预览失败：${error.message}`, 'error');
    },
  });

  const snapshotMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ artifact_id: number; artifact_path: string; artifact_sha256: string; chapter_no: number }>(
        `/api/chapters/${chapterId}/snapshot-candidate`,
        { method: 'POST' },
      ),
    onMutate: () =>
      pushTask({
        label: '创建待检查副本',
        status: 'running',
        detail: '正在创建一份待检查副本，不写回源文件。',
      }),
    onSuccess: (result) => {
      setArtifactId(result.artifact_id);
      setDiffText('');
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      pushTask({
        label: '创建待检查副本',
        status: 'succeeded',
        detail: `第 ${result.chapter_no} 章待检查副本已创建。`,
      });
    },
    onError: (error: Error) => {
      pushTask({ label: '创建待检查副本', status: 'failed', detail: error.message });
      showToast(`创建待检查副本失败：${error.message}`, 'error');
    },
  });

  const showGeneration = mode !== 'publish';
  const showGate = mode !== 'writing';
  const showSnapshotAdvanced = mode === 'full';
  const title =
    mode === 'writing'
      ? '正文版本保存提示'
      : artifactId
        ? '已选择待检查草稿'
        : '选择或创建草稿后再检查和写回';

  return (
    <section className="workflow-card">
      <div className="section-title">
        <div>
          <p className="eyebrow">正文工作流</p>
          <h2>{title}</h2>
        </div>
      </div>
      {showGeneration && (
        <div className="action-row">
          <button type="button" className="secondary-button" onClick={() => reviseMutation.mutate()} disabled={reviseMutation.isPending}>
            按批注创建修订
          </button>
        </div>
      )}
      {showGeneration && mode !== 'writing' && (
        <details className="advanced-details">
          <summary>辅助操作</summary>
          <p className="form-hint">这些操作用于补充上下文或推进后台任务；日常写回只需要选择草稿、检查、查看改动、确认写回。</p>
          <div className="action-row">
            <button type="button" className="secondary-button" onClick={() => contextMutation.mutate()} disabled={contextMutation.isPending}>
              上下文预览
            </button>
            <button type="button" className="secondary-button" onClick={() => runJobsMutation.mutate()} disabled={runJobsMutation.isPending}>
              推进待处理任务
            </button>
          </div>
        </details>
      )}
      {showSnapshotAdvanced && (
        <details className="advanced-details">
          <summary>排错操作：创建待检查副本</summary>
          <p className="form-hint">用于把当前正文复制成待检查草稿，不写回源文件；普通手写保存请回到写作页保存正文版本。</p>
          <div className="action-row">
            <button type="button" className="secondary-button" onClick={() => snapshotMutation.mutate()} disabled={snapshotMutation.isPending}>
              创建待检查副本
            </button>
          </div>
        </details>
      )}
      {preview && mode !== 'publish' && (
        <details className="advanced-details">
          <summary>查看上下文详情</summary>
          <pre className="json-preview">{JSON.stringify(preview, null, 2)}</pre>
        </details>
      )}
      {showGate ? (
        <ArtifactGate
          artifactId={artifactId}
          setArtifactId={setArtifactId}
          diffText={diffText}
          setDiffText={setDiffText}
          baseChapterId={chapterId}
          artifactKind="candidate"
        />
      ) : (
        <p className="form-hint">
          写作界面只负责正文、批注和草稿保存。草稿检查、差异与写回请进入“AI 工作台”。
          {artifactId ? ' 待检查草稿已创建。' : ''}
        </p>
      )}
    </section>
  );
}