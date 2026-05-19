import { useArtifacts, useChapterVersions, usePublishDecisions } from '../hooks';
import type { Artifact, ChapterVersion, PublishDecisionRecord } from '../types';
import type { ReactNode } from 'react';

export function VersionHistory({ chapterId }: { chapterId: number | null }) {
  const versions = useChapterVersions(chapterId);
  const drafts = useArtifacts({ baseChapterId: chapterId, kind: 'candidate' });
  const decisions = usePublishDecisions();
  const chapterDecisions = (decisions.data ?? []).filter((decision) =>
    (drafts.data ?? []).some((artifact) => artifact.id === decision.artifact_id),
  );

  return (
    <section className="version-history" aria-label="版本历史">
      <div className="compact-title">
        <div>
          <p className="eyebrow">版本历史</p>
          <h3>当前章节的草稿、检查和写回记录</h3>
        </div>
        <span className="count-badge">{(versions.data?.length ?? 0) + (drafts.data?.length ?? 0)}</span>
      </div>
      {!chapterId && <p className="muted">选择一章正文后查看版本历史。</p>}
      {chapterId && (
        <>
          <HistoryGroup title="正文版本">
            {versions.isLoading && <p className="muted">正在读取正文版本...</p>}
            {(versions.data ?? []).map((version) => (
              <VersionCard key={version.id} version={version} />
            ))}
            {!versions.isLoading && !(versions.data ?? []).length && <p className="muted">暂无正文版本。</p>}
          </HistoryGroup>

          <HistoryGroup title="已保存草稿">
            {drafts.isLoading && <p className="muted">正在读取草稿...</p>}
            {(drafts.data ?? []).map((artifact) => (
              <DraftCard key={artifact.id} artifact={artifact} />
            ))}
            {!drafts.isLoading && !(drafts.data ?? []).length && <p className="muted">暂无草稿。点击“保存草稿”后会出现在这里。</p>}
          </HistoryGroup>

          <HistoryGroup title="写回记录">
            {chapterDecisions.map((decision) => (
              <PublishCard key={decision.id} decision={decision} />
            ))}
            {!chapterDecisions.length && <p className="muted">暂无写回记录。</p>}
          </HistoryGroup>
        </>
      )}
    </section>
  );
}

function HistoryGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="history-group">
      <h4>{title}</h4>
      <div className="history-list">{children}</div>
    </section>
  );
}

function VersionCard({ version }: { version: ChapterVersion }) {
  return (
    <article className={version.is_current ? 'history-card history-card--current' : 'history-card'}>
      <div>
        <strong>{version.is_current ? '当前正文' : `历史版本 #${version.id}`}</strong>
        <span>{version.title}</span>
      </div>
      <small>{formatDate(version.created_at)}</small>
      <code>正文 {shortHash(version.body_hash)} · 文件 {shortHash(version.source_file_hash)}</code>
      {version.text_snapshot_path && <small>快照：{version.text_snapshot_path}</small>}
    </article>
  );
}

function DraftCard({ artifact }: { artifact: Artifact }) {
  const review = artifact.latest_review;
  return (
    <article className="history-card">
      <div>
        <strong>草稿 #{artifact.id}</strong>
        <span>{review ? reviewLabel(review.passed, review.manual_required) : '未检查'}</span>
      </div>
      <small>{formatDate(artifact.created_at)}</small>
      <code>草稿 {shortHash(artifact.sha256)}</code>
      {review && review.issues.length > 0 && <small>问题 {review.issues.length} 条</small>}
      {artifact.latest_publish && <small>已写回：{formatDate(artifact.latest_publish.published_at)}</small>}
    </article>
  );
}

function PublishCard({ decision }: { decision: PublishDecisionRecord }) {
  return (
    <article className="history-card">
      <div>
        <strong>写回 #{decision.id}</strong>
        <span>{decision.published_at ? '已完成' : '未完成'}</span>
      </div>
      <small>{decision.published_at ? formatDate(decision.published_at) : '未写回'}</small>
      <small>改动记录：{decision.diff_path}</small>
      <small>备份：{decision.backup_path}</small>
    </article>
  );
}

function reviewLabel(passed: boolean, manualRequired: boolean): string {
  if (passed) {
    return '检查通过';
  }
  return manualRequired ? '需人工判断' : '需修改';
}

function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 8)}...` : '无';
}

function formatDate(value: string | null): string {
  if (!value) {
    return '未知时间';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
