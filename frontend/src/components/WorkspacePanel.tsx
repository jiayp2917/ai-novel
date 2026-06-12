import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api';
import { useChapters, useHealth, useSources, useWorkspace } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { WorkspaceBookmark, WorkspaceStatus } from '../types';
import { layoutLabel, workspaceLocationLabel, workspaceStatusFromHealth } from '../utils';

export function WorkspacePanel({ compact = false }: { compact?: boolean }) {
  const health = useHealth();
  const workspace = useWorkspace();
  const sources = useSources();
  const chapters = useChapters();
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const bookmarks = useWorkbenchStore((state) => state.workspaceBookmarks);
  const rememberWorkspace = useWorkbenchStore((state) => state.rememberWorkspace);
  const renameWorkspaceBookmark = useWorkbenchStore((state) => state.renameWorkspaceBookmark);
  const removeWorkspaceBookmark = useWorkbenchStore((state) => state.removeWorkspaceBookmark);
  const [path, setPath] = useState('<novel-workspace-path>');
  const [displayName, setDisplayName] = useState('');
  const [lastResult, setLastResult] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const syncedWorkspaceRoot = useRef<string | null>(null);

  const current = workspace.data ?? workspaceStatusFromHealth(health.data);
  const sourceCount = sources.data?.length ?? 0;
  const chapterCount = chapters.data?.length ?? 0;
  const counts = current?.detected_counts ?? {};
  const currentBookmark = useMemo(
    () => (current ? bookmarkFromWorkspace(current, sourceCount, chapterCount) : null),
    [current, sourceCount, chapterCount],
  );

  useEffect(() => {
    if (workspace.data?.root && syncedWorkspaceRoot.current !== workspace.data.root) {
      syncedWorkspaceRoot.current = workspace.data.root;
      setPath(workspace.data.root);
    }
  }, [workspace.data?.root]);

  useEffect(() => {
    if (current && current.layout !== 'unsupported') {
      rememberWorkspace(current);
    }
  }, [current?.root, current?.layout, JSON.stringify(current?.detected_counts ?? {})]);

  const invalidateWorkspaceQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['workspace'] });
    void queryClient.invalidateQueries({ queryKey: ['health'] });
    void queryClient.invalidateQueries({ queryKey: ['source-files'] });
    void queryClient.invalidateQueries({ queryKey: ['chapters'] });
    void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
    void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
    void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
  };

  const switchMutation = useMutation({
    mutationFn: async (nextPath: string) => {
      const nextWorkspace = await apiRequest<WorkspaceStatus>('/api/workspace', {
        method: 'POST',
        body: JSON.stringify({ path: nextPath }),
      });
      const scan = await apiRequest<Record<string, number>>('/api/library/scan', { method: 'POST' });
      return { workspace: nextWorkspace, scan };
    },
    onMutate: (nextPath) =>
      pushTask({ label: '打开作品', status: 'running', detail: `正在打开 ${nextPath}` }),
    onSuccess: (result) => {
      invalidateWorkspaceQueries();
      rememberWorkspace(result.workspace, displayName);
      setPath(result.workspace.root);
      setDisplayName('');
      setLastResult(`已打开作品：${result.workspace.root}。识别到 ${result.scan.source_files_seen ?? 0} 个素材文件、${result.scan.chapters_seen ?? 0} 章正文。`);
      pushTask({
        label: '打开作品',
        status: 'succeeded',
        detail: `已识别 ${layoutLabel(result.workspace.layout)}，正文 ${result.scan.chapters_seen ?? 0} 章。`,
      });
    },
    onError: (error: Error) => {
      setLastResult(`打开失败：${error.message}`);
      pushTask({ label: '打开作品', status: 'failed', detail: error.message });
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => apiRequest<Record<string, number>>('/api/library/scan', { method: 'POST' }),
    onMutate: () => pushTask({ label: '重新扫描作品', status: 'running', detail: '正在读取设定、章纲和正文目录。' }),
    onSuccess: (result) => {
      invalidateWorkspaceQueries();
      if (current) {
        rememberWorkspace(current);
      }
      setLastResult(`扫描完成：${result.source_files_seen ?? 0} 个素材文件，${result.chapters_seen ?? 0} 章正文。`);
      pushTask({
        label: '重新扫描作品',
        status: 'succeeded',
        detail: `发现 ${result.source_files_seen ?? 0} 个素材文件，${result.chapters_seen ?? 0} 章正文。`,
      });
    },
    onError: (error: Error) => {
      setLastResult(`扫描失败：${error.message}`);
      pushTask({ label: '重新扫描作品', status: 'failed', detail: error.message });
    },
  });

  const rebuildMemoryMutation = useMutation({
    mutationFn: () => apiRequest<Record<string, number>>('/api/memory/rebuild', { method: 'POST' }),
    onMutate: () => pushTask({ label: '整理记忆库', status: 'running', detail: '正在整理核心事实、章节卡和短记忆。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      setLastResult(`记忆库已整理：核心事实 ${result.core_facts ?? 0}，章节卡 ${result.chapter_cards ?? 0}，摘要 ${result.chapter_summaries ?? 0}。`);
      pushTask({
        label: '整理记忆库',
        status: 'succeeded',
        detail: `核心事实 ${result.core_facts ?? 0}，章节卡 ${result.chapter_cards ?? 0}，摘要 ${result.chapter_summaries ?? 0}。`,
      });
    },
    onError: (error: Error) => {
      setLastResult(`整理记忆库失败：${error.message}`);
      pushTask({ label: '整理记忆库', status: 'failed', detail: error.message });
    },
  });

  const openBookmark = (bookmark: WorkspaceBookmark) => {
    setPath(bookmark.path);
    setDisplayName(bookmark.name);
    switchMutation.mutate(bookmark.path);
  };

  return (
    <section className={compact ? 'workspace-card workspace-card--compact' : 'workspace-card'}>
      <div className="section-title">
        <div>
          <p className="eyebrow">作品管理</p>
          <h2>作品列表与最近打开</h2>
        </div>
        <span className="count-badge">{bookmarks.length} 个作品</span>
      </div>

      {currentBookmark && (
        <article className="workspace-current">
          <div>
            <p className="eyebrow">当前作品</p>
            <h3>{currentBookmark.name}</h3>
            <span title={currentBookmark.path}>{currentBookmark.path}</span>
          </div>
          <div className="workspace-stats workspace-stats--inline">
            <span>{workspaceLocationLabel(current?.workspace_location)}</span>
            <span>{layoutLabel(current?.layout)}</span>
            <span>素材 {sourceCount}</span>
            <span>正文 {chapterCount}</span>
          </div>
        </article>
      )}

      <div className="workspace-layout">
        <section className="workspace-list">
          <div className="compact-title">
            <div>
              <p className="eyebrow">最近打开</p>
              <h3>选择一个作品继续写</h3>
            </div>
          </div>
          {bookmarks.length === 0 && <p className="muted">还没有最近打开的作品。先在右侧添加本地作品。</p>}
          {bookmarks.map((bookmark) => (
            <article className="workspace-bookmark" key={bookmark.id}>
              <div>
                {renamingId === bookmark.id ? (
                  <input
                    aria-label="作品显示名"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        renameWorkspaceBookmark(bookmark.id, renameValue);
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <strong>{bookmark.name}</strong>
                )}
                <span title={bookmark.path}>{bookmark.path}</span>
                <small>
                  {layoutLabel(bookmark.layout)} · 最近打开 {formatTime(bookmark.lastOpenedAt)}
                </small>
              </div>
              <div className="workspace-bookmark__actions">
                <button className="secondary-button" type="button" onClick={() => openBookmark(bookmark)} disabled={switchMutation.isPending}>
                  打开
                </button>
                {renamingId === bookmark.id ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      renameWorkspaceBookmark(bookmark.id, renameValue);
                      setRenamingId(null);
                    }}
                  >
                    保存名称
                  </button>
                ) : (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setRenamingId(bookmark.id);
                      setRenameValue(bookmark.name);
                    }}
                  >
                    重命名
                  </button>
                )}
                <button className="secondary-button" type="button" onClick={() => removeWorkspaceBookmark(bookmark.id)}>
                  移除
                </button>
              </div>
            </article>
          ))}
        </section>

        <section className="workspace-add">
          <div className="compact-title">
            <div>
              <p className="eyebrow">添加作品</p>
              <h3>打开本地作品文件夹</h3>
            </div>
          </div>
          <label>
            作品显示名
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="可选，例如：我的番茄小说" />
          </label>
          <label>
            作品路径
            <input aria-label="当前路径" value={path} onChange={(event) => setPath(event.target.value)} />
          </label>
          <div className="action-row">
            <button type="button" className="secondary-button" onClick={() => switchMutation.mutate(path)} disabled={switchMutation.isPending}>
              打开并扫描
            </button>
            <button type="button" className="secondary-button" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
              重新扫描当前作品
            </button>
            <button type="button" className="secondary-button" onClick={() => rebuildMemoryMutation.mutate()} disabled={rebuildMemoryMutation.isPending || chapterCount === 0}>
              整理记忆库
            </button>
          </div>
          <div className="workspace-stats">
            <span>素材文件：{sourceCount}</span>
            <span>正文：{chapterCount}</span>
            {Object.entries(counts).map(([name, count]) => (
              <span key={name}>{name}：{count}</span>
            ))}
          </div>
          <div className="workspace-meta">
            <span>作品运行目录：{current?.runtime_root ?? '未识别'}</span>
            <span>系统运行目录：{current?.app_runtime_root ?? health.data?.runtime_root ?? '未识别'}</span>
          </div>
          {lastResult && <div className="workspace-feedback" role="status">{lastResult}</div>}
          {sourceCount === 0 && chapterCount === 0 && (
            <div className="empty-state">
              <strong>还没有识别到素材。</strong>
              <span>当前扫描目录：{current?.root ?? path}</span>
              <span>请确认目录内存在 00-系统/01-设定/02-正文/03-章纲，或 00-设定/01-大纲/02-正文/03-章纲，或 content/settings/content/outlines/content/chapters。</span>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function bookmarkFromWorkspace(workspace: WorkspaceStatus, sourceCount: number, chapterCount: number): WorkspaceBookmark {
  return {
    id: workspace.root,
    name: defaultWorkspaceName(workspace.root),
    path: workspace.root,
    layout: workspace.layout,
    lastOpenedAt: new Date().toISOString(),
    counts: {
      ...workspace.detected_counts,
      sources: sourceCount,
      chapters: chapterCount,
    },
  };
}

function defaultWorkspaceName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) || '未命名作品';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }
  return date.toLocaleString();
}
