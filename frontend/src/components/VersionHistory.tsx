import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api';
import { useChapterVersions } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { ChapterVersion } from '../types';
import type { ReactNode } from 'react';

export function VersionHistory({ chapterId }: { chapterId: number | null }) {
  const versions = useChapterVersions(chapterId);
  const selectedVersionId = useWorkbenchStore((state) => state.selectedChapterVersionId);
  const setSelectedChapterVersionId = useWorkbenchStore((state) => state.setSelectedChapterVersionId);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const queryClient = useQueryClient();

  const publishMutation = useMutation({
    mutationFn: (versionId: number) =>
      apiRequest<{ published: boolean; version_id: number; backup_path: string; diff_path: string }>(
        `/api/chapters/${chapterId}/versions/${versionId}/publish`,
        {
          method: 'POST',
          body: JSON.stringify({ approved_by_user: true }),
        },
      ),
    onMutate: (versionId) => pushTask({ label: '发布正文版本', status: 'running', detail: `正在发布正文版本 #${versionId}。` }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['chapter-content'] });
      void queryClient.invalidateQueries({ queryKey: ['chapter-versions'] });
      void queryClient.invalidateQueries({ queryKey: ['source-files'] });
      void queryClient.invalidateQueries({ queryKey: ['chapters'] });
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      setSelectedChapterVersionId(null);
      pushTask({
        label: '发布正文版本',
        status: 'succeeded',
        detail: `正文版本 #${result.version_id} 已发布，并已生成备份。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '发布正文版本', status: 'failed', detail: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (versionId: number) =>
      apiRequest<{ deleted: boolean; version_id: number; deleted_snapshot: boolean }>(
        `/api/chapters/${chapterId}/versions/${versionId}`,
        { method: 'DELETE' },
      ),
    onMutate: (versionId) => pushTask({ label: '删除正文版本', status: 'running', detail: `正在删除正文版本 #${versionId}。` }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['chapter-versions'] });
      void queryClient.removeQueries({ queryKey: ['chapter-version-content', chapterId, result.version_id] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      if (selectedVersionId === result.version_id) {
        setSelectedChapterVersionId(null);
      }
      pushTask({
        label: '删除正文版本',
        status: 'succeeded',
        detail: `正文版本 #${result.version_id} 已删除。当前正文和备份记录未受影响。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '删除正文版本', status: 'failed', detail: error.message }),
  });

  const handlePublish = (version: ChapterVersion) => {
    if (!version.can_publish || !chapterId) {
      return;
    }
    const confirmed = window.confirm(`确认发布“${version.title}”的正文版本 #${version.id} 吗？系统会先备份当前正文。`);
    if (confirmed) {
      publishMutation.mutate(version.id);
    }
  };

  const handleDelete = (version: ChapterVersion) => {
    if (!version.can_delete || !chapterId) {
      return;
    }
    const confirmed = window.confirm(`确认删除正文版本 #${version.id} 吗？这不会删除当前正文、备份和发布记录。`);
    if (confirmed) {
      deleteMutation.mutate(version.id);
    }
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
            {versions.isLoading && <p className="muted">正在读取正文版本...</p>}
            {(versions.data ?? []).map((version) => (
              <VersionCard
                key={version.id}
                version={version}
                active={selectedVersionId === version.id}
                publishing={publishMutation.isPending && publishMutation.variables === version.id}
                deleting={deleteMutation.isPending && deleteMutation.variables === version.id}
                onPreview={() => setSelectedChapterVersionId(version.is_current ? null : version.id)}
                onPublish={() => handlePublish(version)}
                onDelete={() => handleDelete(version)}
              />
            ))}
            {!versions.isLoading && !(versions.data ?? []).length && <p className="muted">暂无正文版本。</p>}
          </HistoryGroup>
          <p className="form-hint">这里不区分草稿和正文：保存后就是一个正文版本。发布某个版本前会要求确认，并自动备份当前正文。</p>
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

function VersionCard({
  version,
  active,
  publishing,
  deleting,
  onPreview,
  onPublish,
  onDelete,
}: {
  version: ChapterVersion;
  active: boolean;
  publishing: boolean;
  deleting: boolean;
  onPreview: () => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  return (
    <article className={version.is_current ? 'history-card history-card--current' : active ? 'history-card history-card--active' : 'history-card'}>
      <div>
        <strong>{version.is_current ? '当前正文' : `历史版本 #${version.id}`}</strong>
        <span>{version.title}</span>
      </div>
      <small>{formatDate(version.created_at)}</small>
      <code>正文 {shortHash(version.body_hash)} · 文件 {shortHash(version.source_file_hash)}</code>
      {!version.can_preview && <small className="form-hint form-hint--error">该历史版本缺少正文快照，不能切换，只能保留记录或删除。</small>}
      <div className="history-actions">
        <button className="secondary-button" type="button" onClick={onPreview} disabled={!version.can_preview}>
          {version.is_current ? '查看当前正文' : active ? '正在查看' : '切换查看'}
        </button>
        <button className="secondary-button danger-button" type="button" onClick={onPublish} disabled={!version.can_publish || publishing}>
          {version.is_current ? '已是当前正文' : publishing ? '发布中...' : '发布此版本'}
        </button>
        <button className="secondary-button danger-button" type="button" onClick={onDelete} disabled={!version.can_delete || deleting}>
          {version.is_current ? '当前正文不可删' : deleting ? '删除中...' : '删除版本'}
        </button>
      </div>
    </article>
  );
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
