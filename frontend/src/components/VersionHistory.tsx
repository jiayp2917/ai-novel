import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '../api';
import { useChapterVersions } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { ChapterVersion } from '../types';
import type { ReactNode } from 'react';
import { LoadingSpinner } from './ui/LoadingSpinner';

type PendingConfirm =
  | { action: 'publish'; version: ChapterVersion }
  | { action: 'delete'; version: ChapterVersion }
  | null;

export function VersionHistory({ chapterId }: { chapterId: number | null }) {
  const versions = useChapterVersions(chapterId);
  const selectedVersionId = useWorkbenchStore((state) => state.selectedChapterVersionId);
  const setSelectedChapterVersionId = useWorkbenchStore((state) => state.setSelectedChapterVersionId);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const queryClient = useQueryClient();
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [viewedDiffs, setViewedDiffs] = useState<Record<number, string>>({});

  const publishMutation = useMutation({
    mutationFn: (versionId: number) =>
      apiRequest<{ published: boolean; version_id: number; backup_path: string; diff_path: string }>(
        `/api/chapters/${chapterId}/versions/${versionId}/publish`,
        {
          method: 'POST',
          body: JSON.stringify({ approved_by_user: true }),
        },
      ),
    onMutate: () => pushTask({ label: '发布正文版本', status: 'running', detail: '正在发布正文版本。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['chapter-content'] });
      void queryClient.invalidateQueries({ queryKey: ['chapter-versions'] });
      void queryClient.invalidateQueries({ queryKey: ['source-files'] });
      void queryClient.invalidateQueries({ queryKey: ['chapters'] });
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      setSelectedChapterVersionId(null, { force: true });
      pushTask({
        label: '发布正文版本',
        status: 'succeeded',
        detail: '正文版本已发布，并已生成备份。',
      });
    },
    onError: (error: Error) => pushTask({ label: '发布正文版本', status: 'failed', detail: error.message }),
  });

  const diffMutation = useMutation({
    mutationFn: (versionId: number) => apiRequest<{ diff: string }>(`/api/chapters/${chapterId}/versions/${versionId}/diff`),
    onMutate: () => pushTask({ label: '查看版本改动', status: 'running', detail: '正在整理这个正文版本的改动。' }),
    onSuccess: (result, versionId) => {
      setViewedDiffs((current) => ({ ...current, [versionId]: result.diff || '这个版本和当前正文没有可显示的差异。' }));
      pushTask({ label: '查看版本改动', status: 'succeeded', detail: '改动已生成，确认无误后可以发布。' });
    },
    onError: (error: Error) => pushTask({ label: '查看版本改动', status: 'failed', detail: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (versionId: number) =>
      apiRequest<{ deleted: boolean; version_id: number; deleted_snapshot: boolean }>(
        `/api/chapters/${chapterId}/versions/${versionId}`,
        { method: 'DELETE' },
      ),
    onMutate: () => pushTask({ label: '删除正文版本', status: 'running', detail: '正在删除正文版本。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['chapter-versions'] });
      void queryClient.removeQueries({ queryKey: ['chapter-version-content', chapterId, result.version_id] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      if (selectedVersionId === result.version_id) {
        setSelectedChapterVersionId(null, { force: true });
      }
      pushTask({
        label: '删除正文版本',
        status: 'succeeded',
        detail: '正文版本已删除。当前正文和备份记录未受影响。',
      });
    },
    onError: (error: Error) => pushTask({ label: '删除正文版本', status: 'failed', detail: error.message }),
  });

  const handlePublish = (version: ChapterVersion) => {
    if (!version.can_publish || !chapterId || !viewedDiffs[version.id]) {
      return;
    }
    setPendingConfirm({ action: 'publish', version });
  };

  const handleViewDiff = (version: ChapterVersion) => {
    if (!version.can_publish || !chapterId) {
      return;
    }
    diffMutation.mutate(version.id);
  };

  const handleDelete = (version: ChapterVersion) => {
    if (!version.can_delete || !chapterId) {
      return;
    }
    setPendingConfirm({ action: 'delete', version });
  };

  const confirmAction = () => {
    if (!pendingConfirm) {
      return;
    }
    if (pendingConfirm.action === 'publish') {
      publishMutation.mutate(pendingConfirm.version.id);
    } else {
      deleteMutation.mutate(pendingConfirm.version.id);
    }
    setPendingConfirm(null);
  };

  return (
    <section className="version-history" aria-label="版本历史">
      <div className="compact-title">
        <div>
          <p className="eyebrow">正文版本</p>
          <h3>切换、查看和发布正文版本</h3>
        </div>
        <span className="count-badge">{versions.data?.length ?? 0}</span>
      </div>
      {!chapterId && <p className="muted">选择一章正文后查看版本历史。</p>}
      {chapterId && (
        <>
          <HistoryGroup title="正文版本">
            {versions.isLoading && <p className="muted"><LoadingSpinner size="sm" /> 正在读取正文版本...</p>}
            {(versions.data ?? []).map((version) => (
              <VersionCard
                key={version.id}
                version={version}
                versions={versions.data ?? []}
                active={selectedVersionId === version.id}
                publishing={publishMutation.isPending && publishMutation.variables === version.id}
                deleting={deleteMutation.isPending && deleteMutation.variables === version.id}
                diffText={viewedDiffs[version.id]}
                diffLoading={diffMutation.isPending && diffMutation.variables === version.id}
                onSelect={() => {
                  if (version.can_preview) {
                    setSelectedChapterVersionId(version.is_current ? null : version.id);
                  }
                }}
                onViewDiff={() => handleViewDiff(version)}
                onPublish={() => handlePublish(version)}
                onDelete={() => handleDelete(version)}
              />
            ))}
            {!versions.isLoading && !(versions.data ?? []).length && <p className="muted">暂无正文版本。</p>}
          </HistoryGroup>
          <p className="form-hint">这里不区分草稿和正文：保存后就是一个正文版本。发布某个版本前会要求确认，并自动备份当前正文。</p>
        </>
      )}
      <VersionConfirmDialog
        pending={pendingConfirm}
        busy={publishMutation.isPending || deleteMutation.isPending}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={confirmAction}
      />
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

function VersionCard({
  version,
  versions,
  active,
  publishing,
  deleting,
  diffText,
  diffLoading,
  onSelect,
  onViewDiff,
  onPublish,
  onDelete,
}: {
  version: ChapterVersion;
  versions: ChapterVersion[];
  active: boolean;
  publishing: boolean;
  deleting: boolean;
  diffText: string | undefined;
  diffLoading: boolean;
  onSelect: () => void;
  onViewDiff: () => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const changeSummary = version.is_current
    ? '这是当前正在使用的正文。'
    : version.can_preview
      ? '可切换查看，也可确认发布为当前正文。'
      : '缺少正文快照，不能预览或发布。';
  const publishStatus = version.is_current
    ? '已发布为当前正文'
    : version.can_publish
      ? '未发布，可确认发布'
      : version.can_preview
        ? '暂不能发布'
        : '不能发布';
  const deleteReason = version.can_delete
    ? '可删除：不会影响当前正文、备份和发布记录。'
    : version.is_current
      ? '不可删除：当前正文必须保留。'
      : '不可删除：该版本仍受保护。';
  const previousVersion = previousByCreatedAt(version, versions);
  const publishNeedsDiff = version.can_publish && !diffText;

  return (
    <article
      className={version.is_current ? 'history-card history-card--current' : active ? 'history-card history-card--active' : 'history-card'}
      onClick={() => {
        if (version.can_preview) {
          onSelect();
        }
      }}
      onKeyDown={(event) => {
        if (!version.can_preview || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        event.preventDefault();
        onSelect();
      }}
      role="button"
      tabIndex={version.can_preview ? 0 : -1}
      aria-disabled={!version.can_preview}
      aria-label={version.is_current ? '查看当前正文' : active ? '正在查看此版本' : `切换到版本 ${version.id}`}
    >
      <div className="history-card__head">
        <div>
          <strong>{version.is_current ? '当前正文' : '历史版本'}</strong>
          <span>{version.title}</span>
        </div>
        <small>{formatDate(version.created_at)}</small>
      </div>
      <div className="history-status-grid">
        <span><strong>保存时间</strong>{formatDate(version.created_at)}</span>
        <span><strong>改动摘要</strong>{changeSummary}</span>
        <span><strong>发布状态</strong>{publishStatus}</span>
        <span><strong>删除说明</strong>{deleteReason}</span>
      </div>
      <details className="version-advanced" onClick={(event) => event.stopPropagation()}>
        <summary>排错信息</summary>
        <code>正文校验 {shortHash(version.body_hash)} · 文件校验 {shortHash(version.source_file_hash)}</code>
        <small>上一版本：{previousVersion ? `#${previousVersion.id} / ${formatDate(previousVersion.created_at)}` : '无'}</small>
      </details>
      {!version.can_preview && <small className="form-hint form-hint--error">该历史版本缺少可查看的正文内容，不能切换，只能保留记录或删除。</small>}
      {diffText && (
        <details className="version-diff-preview" open onClick={(event) => event.stopPropagation()}>
          <summary>已查看改动</summary>
          <pre className="diff-preview diff-preview--compact">{diffText}</pre>
        </details>
      )}
      <div className="history-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewDiff();
          }}
          disabled={!version.can_publish || diffLoading}
        >
          {diffLoading ? '整理改动中...' : version.is_current ? '当前正文无需查看' : diffText ? '重新查看改动' : '查看改动'}
        </button>
        <button
          className="secondary-button danger-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPublish();
          }}
          disabled={!version.can_publish || publishNeedsDiff || publishing}
          title={publishNeedsDiff ? '请先查看改动，再确认发布。' : undefined}
        >
          {version.is_current ? '已是当前正文' : publishing ? '发布中...' : publishNeedsDiff ? '先查看改动' : '确认发布'}
        </button>
        <button
          className="secondary-button danger-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          disabled={!version.can_delete || deleting}
        >
          {version.is_current ? '当前正文不可删' : deleting ? '删除中...' : '删除版本'}
        </button>
      </div>
    </article>
  );
}

function VersionConfirmDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: PendingConfirm;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) {
    return null;
  }
  const isPublish = pending.action === 'publish';
  const title = isPublish ? '确认发布正文版本' : '确认删除正文版本';
  const body = isPublish
    ? `发布“${pending.version.title}”这个正文版本？你已经查看过改动，系统会先备份当前正文，发布后该版本会成为当前正文。`
    : '删除这个正文版本？这不会删除当前正文、备份和发布记录。';

  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="version-confirm-title">
        <div className="confirm-dialog__header">
          <span className={isPublish ? 'confirm-dialog__mark confirm-dialog__mark--publish' : 'confirm-dialog__mark confirm-dialog__mark--delete'}>
            {isPublish ? '发' : '删'}
          </span>
          <div>
            <h3 id="version-confirm-title">{title}</h3>
            <p>{body}</p>
          </div>
        </div>
        {isPublish && <div className="notice safe">发布前会保留当前正文备份；发布成功后，该版本会成为当前正文。若还想复核，请取消后重新查看改动。</div>}
        {!isPublish && <div className="notice danger">删除只影响这个历史版本记录，不会删除当前正文。</div>}
        <div className="confirm-dialog__actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className={isPublish ? 'primary-button' : 'secondary-button danger-button'} type="button" onClick={onConfirm} disabled={busy}>
            {busy ? '处理中...' : isPublish ? '确认发布' : '确认删除'}
          </button>
        </div>
      </section>
    </div>
  );
}

function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 8)}...` : '无';
}

function previousByCreatedAt(version: ChapterVersion, versions: ChapterVersion[]): ChapterVersion | undefined {
  const sorted = [...versions].sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at));
  const index = sorted.findIndex((item) => item.id === version.id);
  return index >= 0 ? sorted[index + 1] : undefined;
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
