import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiRequest } from '../api';
import { useArtifact, useArtifacts, useJobs, usePublishDecisions } from '../hooks';
import { useWorkbenchStore } from '../store';
import { ArtifactTrace, CandidateSelector, PublishGateChecklist } from './ArtifactGatePanels';
import { operationBlockReason, publishBlockReason, validateArtifactContext } from './artifactGateUtils';

type ArtifactGateProps = {
  artifactId: number | null;
  setArtifactId: (id: number | null) => void;
  diffText: string;
  setDiffText: (text: string) => void;
  baseChapterId?: number;
  baseSourceFileId?: number;
  artifactKind?: string;
  allowPublish?: boolean;
  compact?: boolean;
};

export function ArtifactGate({
  artifactId,
  setArtifactId,
  diffText,
  setDiffText,
  baseChapterId,
  baseSourceFileId,
  artifactKind = 'candidate',
  allowPublish = true,
  compact = false,
}: ArtifactGateProps) {
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const queryClient = useQueryClient();
  const jobs = useJobs();
  const artifacts = useArtifacts({ baseChapterId, baseSourceFileId, kind: artifactKind });
  const selectedArtifact = useArtifact(artifactId);
  const publishDecisions = usePublishDecisions();
  const selectedPublishDecision = (publishDecisions.data ?? []).find((decision) => decision.artifact_id === artifactId);
  const validation = validateArtifactContext(selectedArtifact.data, { baseChapterId, baseSourceFileId, artifactKind });
  const canOperate = Boolean(artifactId && selectedArtifact.data && validation.valid && !selectedArtifact.isLoading);
  const operationBlockedReason = operationBlockReason({
    artifactId,
    artifact: selectedArtifact.data,
    validationValid: validation.valid,
    isLoading: selectedArtifact.isLoading,
  });
  const publishBlockedReason = selectedArtifact.data
    ? publishBlockReason({ artifact: selectedArtifact.data, allowPublish, diffReady: Boolean(diffText) })
    : null;
  const canPublish = canOperate && !publishBlockedReason;

  useEffect(() => {
    if (artifactId !== null || baseChapterId === undefined) {
      return;
    }
    const latest = (jobs.data ?? []).find(
      (job) =>
        job.status === 'succeeded' &&
        job.locked_chapter_id === baseChapterId &&
        typeof job.result?.artifact_id === 'number',
    );
    if (latest && typeof latest.result?.artifact_id === 'number') {
      setArtifactId(latest.result.artifact_id as number);
    }
  }, [artifactId, baseChapterId, jobs.data, setArtifactId]);

  const reviewMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ passed: boolean; review_id: number }>(`/api/artifacts/${artifactId}/review`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onMutate: () => pushTask({ label: '检查草稿', status: 'running', detail: `正在检查草稿 #${artifactId}。` }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['model-calls'] });
      pushTask({
        label: '检查草稿',
        status: result.passed ? 'succeeded' : 'failed',
        detail: `检查 #${result.review_id}：${result.passed ? '通过' : '需修改或人工判断'}。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '检查草稿', status: 'failed', detail: error.message }),
  });

  const diffMutation = useMutation({
    mutationFn: () => apiRequest<{ diff: string }>(`/api/artifacts/${artifactId}/diff`),
    onMutate: () => pushTask({ label: '查看改动', status: 'running', detail: `正在整理草稿 #${artifactId} 的改动对比。` }),
    onSuccess: (result) => {
      setDiffText(result.diff);
      pushTask({ label: '查看改动', status: 'succeeded', detail: `草稿 #${artifactId} 的改动对比已生成。` });
    },
    onError: (error: Error) => pushTask({ label: '查看改动', status: 'failed', detail: error.message }),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ published: boolean }>(`/api/artifacts/${artifactId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ approved_by_user: true }),
      }),
    onMutate: () => pushTask({ label: '确认写回', status: 'running', detail: `正在把草稿 #${artifactId} 写回正文。` }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['source-file-content'] });
      void queryClient.invalidateQueries({ queryKey: ['chapter-content'] });
      void queryClient.invalidateQueries({ queryKey: ['source-files'] });
      void queryClient.invalidateQueries({ queryKey: ['chapters'] });
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['publish-decisions'] });
      void queryClient.invalidateQueries({ queryKey: ['chapter-versions'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      pushTask({ label: '确认写回', status: 'succeeded', detail: `草稿 #${artifactId} 已写回正文，并已生成备份。` });
    },
    onError: (error: Error) => pushTask({ label: '确认写回', status: 'failed', detail: error.message }),
  });

  return (
    <div className="artifact-gate">
      <p className="form-hint">
        {artifactKind === 'candidate'
          ? '草稿会先保存在草稿箱。人工编辑草稿可直接查看改动并确认写回；AI 草稿需要先检查。'
          : '设定和章纲只保存为提案，可检查和查看改动，但不会在这里直接覆盖源文件。'}
      </p>
      <CandidateSelector
        artifactId={artifactId}
        setArtifactId={setArtifactId}
        candidates={artifacts.data ?? []}
        artifactKind={artifactKind}
        allowPublish={allowPublish}
        baseChapterId={baseChapterId}
      />
      <PublishGateChecklist
        artifact={selectedArtifact.data}
        allowPublish={allowPublish}
        diffReady={Boolean(diffText)}
        contextValid={validation.valid}
        artifactSelected={Boolean(artifactId)}
      />
      <div className="action-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => reviewMutation.mutate()}
          disabled={!canOperate || reviewMutation.isPending}
          title={operationBlockedReason ?? undefined}
        >
          检查草稿
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => diffMutation.mutate()}
          disabled={!canOperate || diffMutation.isPending}
          title={operationBlockedReason ?? undefined}
        >
          查看改动
        </button>
        {allowPublish ? (
          <button
            type="button"
            className="secondary-button danger-button"
            onClick={() => publishMutation.mutate()}
            disabled={!canPublish || publishMutation.isPending}
            title={publishBlockedReason ?? undefined}
          >
            确认写回正文
          </button>
        ) : (
          <button type="button" className="secondary-button" disabled title="设定和章纲只生成提案，不在这里覆盖源文件。">
            提案不直接写回
          </button>
        )}
      </div>
      {artifactId && selectedArtifact.isLoading && <p className="form-hint">正在校验草稿归属...</p>}
      {artifactId && selectedArtifact.isError && <p className="form-hint form-hint--error">草稿不存在，不能继续操作。</p>}
      {!artifactId && <p className="form-hint form-hint--error">请先选择草稿；如果没有草稿，请先在写作页保存正文版本，或在 AI 工作台生成修订草稿。</p>}
      {!validation.valid && <p className="form-hint form-hint--error">{validation.message}</p>}
      {selectedArtifact.data && (
        <ArtifactTrace
          artifact={selectedArtifact.data}
          publishDecision={selectedPublishDecision}
          allowPublish={allowPublish}
          diffReady={Boolean(diffText)}
        />
      )}
      {diffText && !compact && <pre className="diff-preview">{diffText}</pre>}
      {diffText && compact && <pre className="diff-preview diff-preview--compact">{diffText}</pre>}
    </div>
  );
}
