import { useEffect, useMemo, useState } from 'react';
import { useChapters } from '../hooks';
import type { Artifact } from '../types';
import { isManualEditorDraft, publishBlockReason, reviewLabel, reviewStatus, shortHash } from './artifactGateUtils';
import { Button } from './ui/Button';

type PublishDecision = {
  id: number;
  diff_path: string;
  backup_path: string;
  published_at: string | null;
  force: boolean;
  force_reason: string | null;
};

export function ArtifactTrace({
  artifact,
  publishDecision,
  allowPublish,
  diffReady,
}: {
  artifact: Artifact;
  publishDecision: PublishDecision | undefined;
  allowPublish: boolean;
  diffReady: boolean;
}) {
  const review = artifact.latest_review;
  const blockedReason = publishBlockReason({ artifact, allowPublish, diffReady });
  const manualDraft = isManualEditorDraft(artifact);

  return (
    <section className="artifact-trace" aria-label="草稿追踪">
      <div className="artifact-trace-grid">
        <span><strong>检查</strong>{review ? reviewLabel(review.passed, review.manual_required) : manualDraft ? '人工草稿，可选检查' : '未检查'}</span>
        <span><strong>改动</strong>{diffReady || publishDecision?.diff_path ? '已查看' : '未查看'}</span>
        <span><strong>备份</strong>{publishDecision?.backup_path ? '已生成' : '写回后生成'}</span>
        <span><strong>写回</strong>{publishDecision ? '已有记录' : '暂无'}</span>
      </div>
      {blockedReason && <p className="form-hint form-hint--error">暂不能写回：{blockedReason}</p>}
      {review && !review.passed && review.issues.length > 0 && (
        <details className="artifact-review-detail">
          <summary>查看检查问题</summary>
          <div className="review-issue-list">
            {review.issues.map((issue, index) => (
              <article className="review-issue-card" key={index}>
                <strong>{issueText(issue, 'description', '未命名问题')}</strong>
                <span>严重程度：{issueText(issue, 'severity', '未标注')}</span>
                <span>处理建议：{issueText(issue, 'fix_instruction', '请人工判断')}</span>
                {issueText(issue, 'evidence', '') && <blockquote>{issueText(issue, 'evidence', '')}</blockquote>}
              </article>
            ))}
          </div>
          <details className="advanced-details">
            <summary>查看原始检查数据</summary>
            <pre>{JSON.stringify(review.issues, null, 2)}</pre>
          </details>
        </details>
      )}
      <details className="advanced-details">
        <summary>查看排错信息</summary>
        <div className="artifact-trace-grid">
          <span><strong>草稿编号</strong>#{artifact.id}</span>
          <span><strong>章节版本</strong>{artifact.base_chapter_version_id ?? '无'}</span>
          <span><strong>草稿类型</strong>{artifact.kind}</span>
          <span><strong>源文件</strong>{shortHash(artifact.base_source_file_hash)}</span>
          <span><strong>草稿校验</strong>{shortHash(artifact.sha256)}</span>
          <span><strong>写回记录</strong>{publishDecision ? `#${publishDecision.id}` : '暂无'}</span>
          <span><strong>改动记录</strong>{publishDecision?.diff_path ?? '暂无'}</span>
          <span><strong>备份路径</strong>{publishDecision?.backup_path ?? '暂无'}</span>
          {publishDecision?.force && <span><strong>强制写回原因</strong>{publishDecision.force_reason || '未填写'}</span>}
        </div>
      </details>
    </section>
  );
}

function issueText(issue: Record<string, unknown>, key: string, fallback: string): string {
  const value = issue[key];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function PublishGateChecklist({
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
  const manualDraft = Boolean(artifact && isManualEditorDraft(artifact));
  const published = Boolean(artifact?.latest_publish);
  const items = [
    { label: '已选择草稿', done: artifactSelected && contextValid },
    {
      label: allowPublish ? (manualDraft ? '人工草稿，可选检查' : '检查已通过') : '提案可检查，不直接写回',
      done: allowPublish ? manualDraft || reviewPassed : true,
    },
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

export function CandidateSelector({
  artifactId,
  setArtifactId,
  candidates,
  artifactKind,
  allowPublish,
  baseChapterId,
}: {
  artifactId: number | null;
  setArtifactId: (id: number | null) => void;
  candidates: Artifact[];
  artifactKind: string;
  allowPublish: boolean;
  baseChapterId?: number;
}) {
  const [manualId, setManualId] = useState(artifactId ? String(artifactId) : '');
  const chapters = useChapters();
  const chapterById = useMemo(
    () => new Map((chapters.data ?? []).map((chapter) => [chapter.id, chapter])),
    [chapters.data],
  );
  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      const aCurrent = baseChapterId !== undefined && a.base_chapter_id === baseChapterId ? 1 : 0;
      const bCurrent = baseChapterId !== undefined && b.base_chapter_id === baseChapterId ? 1 : 0;
      if (aCurrent !== bCurrent) {
        return bCurrent - aCurrent;
      }
      const createdDelta = timestamp(b.created_at) - timestamp(a.created_at);
      if (createdDelta !== 0) {
        return createdDelta;
      }
      const aUnpublished = a.latest_publish ? 0 : 1;
      const bUnpublished = b.latest_publish ? 0 : 1;
      if (aUnpublished !== bUnpublished) {
        return bUnpublished - aUnpublished;
      }
      return b.id - a.id;
    });
  }, [baseChapterId, candidates]);

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
      <details className="advanced-details">
        <summary>高级选择草稿</summary>
        <div className="manual-artifact">
          <input
            value={manualId}
            onChange={(event) => setManualId(event.target.value.replace(/[^\d]/g, ''))}
            placeholder="手动输入草稿编号"
          />
          <Button
            variant="secondary"
            onClick={() => setArtifactId(manualId ? Number.parseInt(manualId, 10) : null)}
            disabled={manualId.trim() === ''}
          >
            绑定草稿
          </Button>
        </div>
      </details>
      <div className="candidate-list">
        {sortedCandidates.map((candidate) => {
          const chapter = candidate.base_chapter_id ? chapterById.get(candidate.base_chapter_id) : undefined;
          const source = candidateSourceLabel(candidate);
          return (
            <button
              type="button"
              className={candidate.id === artifactId ? 'candidate-row candidate-row--active' : 'candidate-row'}
              key={candidate.id}
              onClick={() => setArtifactId(candidate.id)}
            >
              <div className="candidate-row__main">
                <strong>{artifactKind === 'candidate' ? source : '素材提案'}</strong>
                <span>{chapter ? `第 ${String(chapter.chapter_no).padStart(3, '0')} 章：${chapter.title}` : artifactKind === 'candidate' ? '当前章节草稿' : '设定/章纲提案'}</span>
              </div>
              <div className="candidate-row__meta">
                <span>保存：{formatDate(candidate.created_at)}</span>
                <span>检查：{reviewStatus(candidate.latest_review)}</span>
              </div>
              <div className="candidate-row__status">
                <span>{candidate.latest_publish ? '已写回' : allowPublish ? '未写回' : '不直接写回'}</span>
                <small>{candidate.latest_publish ? '已有写回记录' : candidateActionHint(candidate, allowPublish)}</small>
              </div>
            </button>
          );
        })}
        {candidates.length === 0 && (
          <p className="muted">
            {artifactKind === 'candidate'
              ? '暂无草稿。先在写作界面保存正文版本，或在 AI 工作台生成修订草稿。'
              : '暂无提案。可先生成提案，再查看改动并人工采纳。'}
          </p>
        )}
      </div>
    </section>
  );
}

function candidateSourceLabel(candidate: Artifact): string {
  if (isManualEditorDraft(candidate)) {
    return candidate.metadata.unparsed_chapter_source ? '普通正文 Markdown' : '人工正文版本';
  }
  const source = textMeta(candidate.metadata.source);
  const taskType = textMeta(candidate.metadata.task_type);
  if (taskType === 'revise_from_annotations') {
    return '按批注修订';
  }
  if (taskType === 'generate_chapter_draft' || source === 'ai_generated_draft') {
    return 'AI 生成草稿';
  }
  if (taskType === 'fix_chapter_candidate') {
    return 'AI 修订草稿';
  }
  if (source === 'existing_chapter_snapshot' || textMeta(candidate.metadata.purpose) === 'pipeline_review_snapshot') {
    return '待检查副本';
  }
  return '未知来源草稿';
}

function candidateActionHint(candidate: Artifact, allowPublish: boolean): string {
  if (!allowPublish) {
    return '只用于对比和人工采纳';
  }
  if (isManualEditorDraft(candidate)) {
    return '可查看改动后确认';
  }
  if (!candidate.latest_review) {
    return '需要先检查';
  }
  return candidate.latest_review.passed ? '可查看改动后确认' : '需处理检查问题';
}

function textMeta(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timestamp(value: string | null): number {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDate(value: string | null): string {
  if (!value) {
    return '未知时间';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
