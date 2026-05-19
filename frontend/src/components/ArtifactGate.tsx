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
  const validation = validateArtifactContext(selectedArtifact.data, { baseChapterId, baseSourceFileId, artifactKind });
  const canOperate = Boolean(artifactId && selectedArtifact.data && validation.valid && !selectedArtifact.isLoading);
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
          ? '草稿会先保存在草稿箱。建议顺序：选择草稿 -> 检查草稿 -> 查看改动 -> 确认写回正文。'
          : '设定和章纲只保存为提案，可检查和查看改动，但不会在这里直接覆盖源文件。'}
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
          检查草稿
        </button>
        <button type="button" className="secondary-button" onClick={() => diffMutation.mutate()} disabled={!canOperate || diffMutation.isPending}>
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
    <section className="artifact-trace" aria-label="草稿追踪">
      <div className="artifact-trace-grid">
        <span><strong>草稿</strong>#{artifact.id} · {artifact.kind}</span>
        <span><strong>源文件</strong>{shortHash(artifact.base_source_file_hash)}</span>
        <span><strong>草稿</strong>{shortHash(artifact.sha256)}</span>
        <span><strong>章节版本</strong>{artifact.base_chapter_version_id ?? '无'}</span>
        <span><strong>检查</strong>{review ? reviewLabel(review.passed, review.manual_required) : '未检查'}</span>
        <span><strong>改动</strong>{diffReady || publishDecision?.diff_path ? '已查看' : '未查看'}</span>
        <span><strong>备份</strong>{publishDecision?.backup_path ?? '写回后生成'}</span>
        <span><strong>写回</strong>{publishDecision ? `#${publishDecision.id}` : '暂无'}</span>
      </div>
      {publishBlockedReason && <p className="form-hint form-hint--error">暂不能写回：{publishBlockedReason}</p>}
      {review && !review.passed && review.issues.length > 0 && (
        <details className="artifact-review-detail">
          <summary>查看检查问题</summary>
          <pre>{JSON.stringify(review.issues, null, 2)}</pre>
        </details>
      )}
      {publishDecision && (
        <div className="artifact-publish-detail">
          <span>改动记录：{publishDecision.diff_path}</span>
          <span>备份：{publishDecision.backup_path}</span>
          {publishDecision.force && <span>强制写回原因：{publishDecision.force_reason || '未填写'}</span>}
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
    return '设定/章纲提案只能人工采纳，不在这里写回正文。';
  }
  if (!artifact.latest_review) {
    return '草稿还没有检查记录。';
  }
  if (!artifact.latest_review.passed) {
    return artifact.latest_review.manual_required ? '检查结果需要人工判断。' : '检查未通过。';
  }
  if (!diffReady && !artifact.latest_publish) {
    return '尚未查看改动对比。';
  }
  if (artifact.latest_publish) {
    return '这个草稿已经写回过，请保存新的草稿后再写回。';
  }
  return null;
}

function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 10)}...` : '无';
}

function reviewLabel(passed: boolean, manualRequired: boolean): string {
  if (passed) {
    return '检查通过';
  }
  return manualRequired ? '需人工判断' : '需修改';
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
    { label: '已选择草稿', done: artifactSelected && contextValid },
    { label: allowPublish ? '检查已通过' : '提案可检查，不直接写回', done: allowPublish ? reviewPassed : true },
    { label: '已查看改动', done: diffReady },
    { label: allowPublish ? '等待确认写回正文' : '设定/章纲保持人工采纳', done: allowPublish ? published : true },
  ];

  return (
    <div className="publish-checklist" aria-label="写回检查清单">
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
      message: `草稿类型不匹配：当前需要 ${expected.artifactKind}，实际是 ${artifact.kind}。`,
    };
  }
  if (expected.baseChapterId !== undefined && artifact.base_chapter_id !== expected.baseChapterId) {
    return {
      valid: false,
      message: '草稿不属于当前章节，不能在这里检查、查看改动或写回。',
    };
  }
  if (expected.baseSourceFileId !== undefined && artifact.base_source_file_id !== expected.baseSourceFileId) {
    return {
      valid: false,
      message: '提案不属于当前文件，不能在这里检查或查看改动。',
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
        <span className={artifactId ? 'step step--done' : 'step'}>1 选择草稿</span>
        <span className="step">2 检查</span>
        <span className="step">3 改动</span>
        <span className="step">4 写回</span>
      </div>
      <div className="manual-artifact">
        <input
          value={manualId}
          onChange={(event) => setManualId(event.target.value.replace(/[^\d]/g, ''))}
          placeholder="手动输入草稿编号"
        />
        <button
          type="button"
          className="secondary-button"
          onClick={() => setArtifactId(manualId ? Number.parseInt(manualId, 10) : null)}
          disabled={manualId.trim() === ''}
        >
          绑定草稿
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
            <span>{artifactKind === 'candidate' ? '草稿' : '提案'} · {reviewStatus(candidate.latest_review)}</span>
            <small>{candidate.latest_publish ? '已写回' : allowPublish ? '未写回' : '不直接写回'}</small>
          </button>
        ))}
        {candidates.length === 0 && <p className="muted">暂无草稿。先在写作界面保存草稿，或生成审核快照。</p>}
      </div>
    </section>
  );
}

function reviewStatus(review: { passed: boolean; manual_required: boolean } | null): string {
  if (!review) {
    return '未检查';
  }
  if (review.passed) {
    return '检查通过';
  }
  return review.manual_required ? '需人工判断' : '需修改';
}
