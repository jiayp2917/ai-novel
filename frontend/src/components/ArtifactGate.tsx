import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiRequest } from '../api';
import { useArtifact, useArtifacts, useJobs, usePublishDecisions } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { Artifact } from '../types';

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
  const validation = validateArtifactContext(selectedArtifact.data, {
    baseChapterId,
    baseSourceFileId,
    artifactKind,
  });
  const canOperate = Boolean(artifactId && selectedArtifact.data && validation.valid && !selectedArtifact.isLoading);
  const publishBlockedReason = selectedArtifact.data
    ? publishBlockReason({
        artifact: selectedArtifact.data,
        allowPublish,
        diffReady: Boolean(diffText),
      })
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
    onMutate: () => pushTask({ label: '审核候选', status: 'running', detail: `正在审核候选 #${artifactId}。` }),
    onSuccess: (result) =>
      {
        void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
        void queryClient.invalidateQueries({ queryKey: ['model-calls'] });
        pushTask({
        label: '审核候选',
        status: result.passed ? 'succeeded' : 'failed',
        detail: `审核 #${result.review_id}：${result.passed ? '通过' : '未通过'}。`,
        });
      },
    onError: (error: Error) => pushTask({ label: '审核候选', status: 'failed', detail: error.message }),
  });

  const diffMutation = useMutation({
    mutationFn: () => apiRequest<{ diff: string }>(`/api/artifacts/${artifactId}/diff`),
    onMutate: () => pushTask({ label: '生成差异', status: 'running', detail: `正在生成候选 #${artifactId} 的 diff。` }),
    onSuccess: (result) => {
      setDiffText(result.diff);
      pushTask({ label: '生成差异', status: 'succeeded', detail: `候选 #${artifactId} 的差异已生成。` });
    },
    onError: (error: Error) => pushTask({ label: '生成差异', status: 'failed', detail: error.message }),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ published: boolean }>(`/api/artifacts/${artifactId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ approved_by_user: true }),
      }),
    onMutate: () => pushTask({ label: '发布候选', status: 'running', detail: `发布门正在写回候选 #${artifactId}。` }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['source-file-content'] });
      void queryClient.invalidateQueries({ queryKey: ['chapter-content'] });
      void queryClient.invalidateQueries({ queryKey: ['source-files'] });
      void queryClient.invalidateQueries({ queryKey: ['chapters'] });
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['publish-decisions'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      pushTask({ label: '发布候选', status: 'succeeded', detail: `候选 #${artifactId} 已通过发布门写回。` });
    },
    onError: (error: Error) => pushTask({ label: '发布候选', status: 'failed', detail: error.message }),
  });

  return (
    <div className="artifact-gate">
      <p className="form-hint">
        {artifactKind === 'candidate'
          ? '候选保存在 runtime/artifacts。下一步：选择候选 -> 审核 -> 查看差异 -> 人工确认发布。'
          : '提案保存在 runtime/artifacts。设定和章纲只审核与查看差异，不通过这里直接发布。'}
      </p>
      <CandidateSelector
        artifactId={artifactId}
        setArtifactId={setArtifactId}
        candidates={artifacts.data ?? []}
        artifactKind={artifactKind}
        allowPublish={allowPublish}
      />
      <PublishGateChecklist
        artifact={selectedArtifact.data}
        allowPublish={allowPublish}
        diffReady={Boolean(diffText)}
        contextValid={validation.valid}
        artifactSelected={Boolean(artifactId)}
      />
      <div className="action-row">
        <button type="button" className="secondary-button" onClick={() => reviewMutation.mutate()} disabled={!canOperate || reviewMutation.isPending}>
          审核候选
        </button>
        <button type="button" className="secondary-button" onClick={() => diffMutation.mutate()} disabled={!canOperate || diffMutation.isPending}>
          查看差异
        </button>
        {allowPublish ? (
          <button
            type="button"
            className="secondary-button danger-button"
            onClick={() => publishMutation.mutate()}
            disabled={!canPublish || publishMutation.isPending}
            title={publishBlockedReason ?? undefined}
          >
            人工确认发布
          </button>
        ) : (
          <button type="button" className="secondary-button" disabled title="设定和章纲目前只生成提案，不在前端直接覆盖源文件。">
            提案不直接发布
          </button>
        )}
      </div>
      {artifactId && selectedArtifact.isLoading && <p className="form-hint">正在校验候选归属...</p>}
      {artifactId && selectedArtifact.isError && <p className="form-hint form-hint--error">候选不存在，不能继续操作。</p>}
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

function ArtifactTrace({
  artifact,
  publishDecision,
  allowPublish,
  diffReady,
}: {
  artifact: Artifact;
  publishDecision:
    | {
        id: number;
        diff_path: string;
        backup_path: string;
        published_at: string | null;
        force: boolean;
        force_reason: string | null;
      }
    | undefined;
  allowPublish: boolean;
  diffReady: boolean;
}) {
  const review = artifact.latest_review;
  const publishBlockedReason = publishBlockReason({ artifact, allowPublish, diffReady });

  return (
    <section className="artifact-trace" aria-label="候选追踪">
      <div className="artifact-trace-grid">
        <span><strong>artifact</strong>#{artifact.id} · {artifact.kind}</span>
        <span><strong>源 hash</strong>{shortHash(artifact.base_source_file_hash)}</span>
        <span><strong>候选 hash</strong>{shortHash(artifact.sha256)}</span>
        <span><strong>章节版本</strong>{artifact.base_chapter_version_id ?? '无'}</span>
        <span><strong>审核</strong>{review ? (review.passed ? '通过' : review.manual_required ? '需人工处理' : '未通过') : '未审核'}</span>
        <span><strong>diff</strong>{diffReady || publishDecision?.diff_path ? '已生成' : '未生成'}</span>
        <span><strong>备份</strong>{publishDecision?.backup_path ?? '发布后生成'}</span>
        <span><strong>发布决策</strong>{publishDecision ? `#${publishDecision.id}` : '暂无'}</span>
      </div>
      {publishBlockedReason && <p className="form-hint form-hint--error">不能发布：{publishBlockedReason}</p>}
      {review && !review.passed && review.issues.length > 0 && (
        <details className="artifact-review-detail">
          <summary>查看审核问题 JSON</summary>
          <pre>{JSON.stringify(review.issues, null, 2)}</pre>
        </details>
      )}
      {publishDecision && (
        <div className="artifact-publish-detail">
          <span>diff：{publishDecision.diff_path}</span>
          <span>backup：{publishDecision.backup_path}</span>
          {publishDecision.force && <span>强制发布原因：{publishDecision.force_reason || '未填写'}</span>}
        </div>
      )}
    </section>
  );
}

function publishBlockReason({
  artifact,
  allowPublish,
  diffReady,
}: {
  artifact: Artifact;
  allowPublish: boolean;
  diffReady: boolean;
}): string | null {
  if (!allowPublish || artifact.kind !== 'candidate') {
    return '设定/章纲提案只能人工采纳，不走普通正文发布门。';
  }
  if (!artifact.latest_review) {
    return '候选还没有审核记录。';
  }
  if (!artifact.latest_review.passed) {
    return artifact.latest_review.manual_required ? '审核要求人工处理。' : '审核未通过。';
  }
  if (!diffReady && !artifact.latest_publish) {
    return '尚未在前端查看 diff。';
  }
  if (artifact.latest_publish) {
    return '该候选已有发布记录，请重新生成候选后再发布。';
  }
  return null;
}

function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 10)}...` : '无';
}

function PublishGateChecklist({
  artifact,
  allowPublish,
  diffReady,
  contextValid,
  artifactSelected,
}: {
  artifact: Artifact | undefined;
  allowPublish: boolean;
  diffReady: boolean;
  contextValid: boolean;
  artifactSelected: boolean;
}) {
  const reviewPassed = Boolean(artifact?.latest_review?.passed);
  const published = Boolean(artifact?.latest_publish);
  const items = [
    { label: '已选择候选', done: artifactSelected && contextValid },
    { label: allowPublish ? '审核已通过' : '提案可审核，不直接发布', done: allowPublish ? reviewPassed : true },
    { label: '差异已生成', done: diffReady },
    { label: allowPublish ? '等待人工确认发布' : '设定/章纲保持人工采纳', done: allowPublish ? published : true },
  ];

  return (
    <div className="publish-checklist" aria-label="发布门校验清单">
      {items.map((item) => (
        <span className={item.done ? 'publish-check publish-check--done' : 'publish-check'} key={item.label}>
          {item.done ? '✓' : '·'} {item.label}
        </span>
      ))}
    </div>
  );
}

function validateArtifactContext(
  artifact: Artifact | undefined,
  expected: { baseChapterId?: number; baseSourceFileId?: number; artifactKind: string },
): { valid: boolean; message: string } {
  if (!artifact) {
    return { valid: true, message: '' };
  }
  if (artifact.kind !== expected.artifactKind) {
    return {
      valid: false,
      message: `候选类型不匹配：当前需要 ${expected.artifactKind}，实际是 ${artifact.kind}。`,
    };
  }
  if (expected.baseChapterId !== undefined && artifact.base_chapter_id !== expected.baseChapterId) {
    return {
      valid: false,
      message: '候选不属于当前章节，不能在此处审核、查看差异或发布。',
    };
  }
  if (expected.baseSourceFileId !== undefined && artifact.base_source_file_id !== expected.baseSourceFileId) {
    return {
      valid: false,
      message: '候选不属于当前源文件，不能在此处审核或查看差异。',
    };
  }
  return { valid: true, message: '' };
}

function CandidateSelector({
  artifactId,
  setArtifactId,
  candidates,
  artifactKind,
  allowPublish,
}: {
  artifactId: number | null;
  setArtifactId: (id: number | null) => void;
  candidates: Array<{
    id: number;
    kind: string;
    path: string;
    latest_review: { passed: boolean; manual_required: boolean } | null;
    latest_publish: { published_at: string } | null;
    created_at: string;
  }>;
  artifactKind: string;
  allowPublish: boolean;
}) {
  const [manualId, setManualId] = useState(artifactId ? String(artifactId) : '');

  useEffect(() => {
    if (artifactId) {
      setManualId(String(artifactId));
    }
  }, [artifactId]);

  return (
    <section className="candidate-panel">
      <div className="candidate-stepper">
        <span className={artifactId ? 'step step--done' : 'step'}>1 选择候选</span>
        <span className="step">2 审核</span>
        <span className="step">3 差异</span>
        <span className="step">4 发布</span>
      </div>
      <div className="manual-artifact">
        <input
          value={manualId}
          onChange={(event) => setManualId(event.target.value)}
          placeholder="手动输入 artifact_id"
        />
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            const parsed = Number.parseInt(manualId, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              setArtifactId(parsed);
            }
          }}
        >
          绑定候选
        </button>
      </div>
      <div className="candidate-list">
        {candidates.map((candidate) => (
          <button
            type="button"
            className={candidate.id === artifactId ? 'candidate-row candidate-row--active' : 'candidate-row'}
            key={candidate.id}
            onClick={() => setArtifactId(candidate.id)}
          >
            <strong>#{candidate.id}</strong>
            <span>{candidate.latest_review ? (candidate.latest_review.passed ? '审核通过' : '审核未过') : '未审核'}</span>
            <span>{publishStatusLabel(candidate.latest_publish, artifactKind, allowPublish)}</span>
          </button>
        ))}
        {candidates.length === 0 && <p className="muted">暂无当前对象候选。可以生成候选或手动绑定 artifact_id。</p>}
      </div>
    </section>
  );
}

function publishStatusLabel(
  latestPublish: { published_at: string } | null,
  artifactKind: string,
  allowPublish: boolean,
) {
  if (!allowPublish || artifactKind !== 'candidate') {
    return '不可直接发布';
  }
  return latestPublish ? '已发布' : '未发布';
}
