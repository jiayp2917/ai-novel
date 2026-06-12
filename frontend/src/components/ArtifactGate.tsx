import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiRequest } from '../api';
import { useArtifact, useArtifactText, useArtifacts, useJobs, usePublishDecisions } from '../hooks';
import { useWorkbenchStore } from '../store';
import { ArtifactTrace, CandidateSelector, PublishGateChecklist } from './ArtifactGatePanels';
import { operationBlockReason, publishBlockReason, validateArtifactContext } from './artifactGateUtils';
import { Button } from './ui/Button';

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
  const artifactText = useArtifactText(artifactId);
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
  const manualChecked = Boolean(selectedArtifact.data?.latest_review?.passed);

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

  useEffect(() => {
    setDiffText('');
  }, [artifactId, setDiffText]);

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

  const manualCheckMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ passed: boolean; review_id: number }>(`/api/artifacts/${artifactId}/manual-check`, {
        method: 'POST',
      }),
    onMutate: () => pushTask({ label: '检查完成', status: 'running', detail: `正在记录草稿 #${artifactId} 的人工检查结果。` }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['artifact', artifactId] });
      pushTask({ label: '检查完成', status: 'succeeded', detail: `人工检查 #${result.review_id} 已记录。` });
    },
    onError: (error: Error) => pushTask({ label: '检查完成', status: 'failed', detail: error.message }),
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
      <div className="manual-publish-flow" aria-label={allowPublish ? '人工写回流程' : '提案检查流程'}>
        <div className={artifactId ? 'manual-step manual-step--done' : 'manual-step'}>
          <strong>1 选择草稿</strong>
          <span>{artifactId ? `已选择 #${artifactId}` : '先从下方草稿列表选择一份。'}</span>
        </div>
        <div className={artifactText.data ? 'manual-step manual-step--done' : 'manual-step'}>
          <strong>2 查看内容</strong>
          <span>{artifactText.data ? '草稿内容已显示，可人工检查。' : '选择后会显示草稿正文。'}</span>
        </div>
        <div className={manualChecked ? 'manual-step manual-step--done' : 'manual-step'}>
          <strong>3 检查完成</strong>
          <span>{manualChecked ? '已由人工确认可进入写回。' : '确认内容无误后点击检查完成。'}</span>
        </div>
        <div className={selectedPublishDecision ? 'manual-step manual-step--done' : 'manual-step'}>
          <strong>{allowPublish ? '4 正式写回' : '4 人工采纳'}</strong>
          <span>{allowPublish ? '查看改动后确认写回正文。' : '提案只供人工采纳，不直接覆盖。'}</span>
        </div>
      </div>
      <CandidateSelector
        artifactId={artifactId}
        setArtifactId={setArtifactId}
        candidates={artifacts.data ?? []}
        artifactKind={artifactKind}
        allowPublish={allowPublish}
        baseChapterId={baseChapterId}
      />
      {artifactId && (
        <section className="artifact-preview-panel">
          <div className="compact-title">
            <div>
              <p className="eyebrow">草稿内容</p>
              <h3>{artifactText.isLoading ? '正在读取草稿' : '人工检查这份草稿'}</h3>
            </div>
            <Button
              variant={manualChecked ? 'primary' : 'secondary'}
              onClick={() => manualCheckMutation.mutate()}
              disabled={!artifactText.data || manualChecked || manualCheckMutation.isPending || !canOperate}
              loading={manualCheckMutation.isPending}
            >
              {manualChecked ? '检查已完成' : '检查完成'}
            </Button>
          </div>
          {artifactText.isLoading && <p className="muted">正在读取草稿内容...</p>}
          {artifactText.isError && <p className="form-hint form-hint--error">草稿内容读取失败，请确认草稿文件仍存在。</p>}
          {artifactText.data && <pre className="document-preview artifact-preview-text">{artifactText.data.text}</pre>}
        </section>
      )}
      <PublishGateChecklist
        artifact={selectedArtifact.data}
        allowPublish={allowPublish}
        diffReady={Boolean(diffText)}
        contextValid={validation.valid}
        artifactSelected={Boolean(artifactId)}
      />
      <div className="action-row artifact-main-actions">
        <Button
          variant="secondary"
          onClick={() => diffMutation.mutate()}
          disabled={!canOperate || !manualChecked || diffMutation.isPending}
          title={!manualChecked ? '请先查看草稿并点击“检查完成”。' : operationBlockedReason ?? undefined}
          loading={diffMutation.isPending}
        >
          查看改动
        </Button>
        {allowPublish ? (
          <Button
            variant="danger"
            onClick={() => publishMutation.mutate()}
            disabled={!canPublish || publishMutation.isPending}
            title={publishBlockedReason ?? undefined}
            loading={publishMutation.isPending}
          >
            确认写回正文
          </Button>
        ) : (
          <Button variant="secondary" disabled title="设定和章纲只生成提案，不在这里覆盖源文件。">
            提案不直接写回
          </Button>
        )}
      </div>
      {allowPublish && (
        <details className="advanced-details">
          <summary>AI 辅助检查</summary>
          <p className="form-hint">人工写回不强制 AI 检查；如果这是 AI 草稿或你不确定内容质量，可先让 AI 检查。</p>
          <Button
            variant="secondary"
            onClick={() => reviewMutation.mutate()}
            disabled={!canOperate || reviewMutation.isPending}
            title={operationBlockedReason ?? undefined}
            loading={reviewMutation.isPending}
          >
            AI 检查草稿
          </Button>
        </details>
      )}
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
