import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiRequest } from '../api';
import { useChapters, useHealth, useSources, useWorkspace } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { WorkspaceStatus } from '../types';
import { layoutLabel, workspaceLocationLabel, workspaceStatusFromHealth } from '../utils';

export function WorkspacePanel({ compact = false }: { compact?: boolean }) {
  const health = useHealth();
  const workspace = useWorkspace();
  const sources = useSources();
  const chapters = useChapters();
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const [path, setPath] = useState('D:\\2917\\numeric-monster');
  const [lastResult, setLastResult] = useState('');

  useEffect(() => {
    if (workspace.data?.root) {
      setPath(workspace.data.root);
    }
  }, [workspace.data?.root]);

  const switchMutation = useMutation({
    mutationFn: async () => {
      const nextWorkspace = await apiRequest<WorkspaceStatus>('/api/workspace', { method: 'POST', body: JSON.stringify({ path }) });
      const scan = await apiRequest<Record<string, number>>('/api/library/scan', { method: 'POST' });
      return { workspace: nextWorkspace, scan };
    },
    onMutate: () => pushTask({ label: '切换工作区', status: 'running', detail: `正在切换到 ${path}` }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['workspace'] });
      void queryClient.invalidateQueries({ queryKey: ['health'] });
      void queryClient.invalidateQueries({ queryKey: ['source-files'] });
      void queryClient.invalidateQueries({ queryKey: ['chapters'] });
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      setLastResult(`已切换到 ${result.workspace.root}，识别 ${result.scan.source_files_seen ?? 0} 个文件、${result.scan.chapters_seen ?? 0} 章正文。`);
      pushTask({
        label: '切换工作区',
        status: 'succeeded',
        detail: `已识别 ${layoutLabel(result.workspace.layout)}：${result.scan.source_files_seen ?? 0} 个文件、${result.scan.chapters_seen ?? 0} 章。`,
      });
    },
    onError: (error: Error) => {
      setLastResult(`切换失败：${error.message}`);
      pushTask({ label: '切换工作区', status: 'failed', detail: error.message });
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => apiRequest<Record<string, number>>('/api/library/scan', { method: 'POST' }),
    onMutate: () => pushTask({ label: '扫描素材库', status: 'running', detail: '正在扫描设定、章纲和正文。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['source-files'] });
      void queryClient.invalidateQueries({ queryKey: ['chapters'] });
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      setLastResult(`扫描完成：${result.source_files_seen ?? 0} 个文件、${result.chapters_seen ?? 0} 章正文。`);
      pushTask({
        label: '扫描素材库',
        status: 'succeeded',
        detail: `发现 ${result.source_files_seen ?? 0} 个文件、${result.chapters_seen ?? 0} 章正文。`,
      });
    },
    onError: (error: Error) => {
      setLastResult(`扫描失败：${error.message}`);
      pushTask({ label: '扫描素材库', status: 'failed', detail: error.message });
    },
  });

  const rebuildMemoryMutation = useMutation({
    mutationFn: () => apiRequest<Record<string, number>>('/api/memory/rebuild', { method: 'POST' }),
    onMutate: () => pushTask({ label: '重建短记忆', status: 'running', detail: '正在生成核心事实、章卡和结构化状态。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      setLastResult(`短记忆重建完成：核心事实 ${result.core_facts ?? 0}，章卡 ${result.chapter_cards ?? 0}，摘要 ${result.chapter_summaries ?? 0}。`);
      pushTask({
        label: '重建短记忆',
        status: 'succeeded',
        detail: `核心事实 ${result.core_facts ?? 0}，章卡 ${result.chapter_cards ?? 0}，摘要 ${result.chapter_summaries ?? 0}。`,
      });
    },
    onError: (error: Error) => {
      setLastResult(`短记忆重建失败：${error.message}`);
      pushTask({ label: '重建短记忆', status: 'failed', detail: error.message });
    },
  });

  const current = workspace.data ?? workspaceStatusFromHealth(health.data);
  const counts = current?.detected_counts ?? {};
  const sourceCount = sources.data?.length ?? 0;
  const chapterCount = chapters.data?.length ?? 0;

  return (
    <section className={compact ? 'workspace-card workspace-card--compact' : 'workspace-card'}>
      <div className="section-title">
        <div>
          <p className="eyebrow">工作区</p>
          <h2>素材索引与短记忆</h2>
        </div>
        <span className="count-badge">{layoutLabel(current?.layout)}</span>
      </div>
      <div className="workspace-line">
        <label>
          当前路径
          <input value={path} onChange={(event) => setPath(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" onClick={() => switchMutation.mutate()} disabled={switchMutation.isPending}>
          切换
        </button>
        <button type="button" className="secondary-button" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
          重新扫描
        </button>
        <button type="button" className="secondary-button" onClick={() => rebuildMemoryMutation.mutate()} disabled={rebuildMemoryMutation.isPending || chapterCount === 0}>
          重建短记忆
        </button>
      </div>
      <div className="workspace-stats">
        <span>{workspaceLocationLabel(current?.workspace_location)}</span>
        <span>源文件：{sourceCount}</span>
        <span>正文：{chapterCount}</span>
        {Object.entries(counts).map(([name, count]) => (
          <span key={name}>{name}：{count}</span>
        ))}
      </div>
      <div className="workspace-meta">
        <span>作品 runtime：{current?.runtime_root ?? '未识别'}{current?.runtime_override ? '（覆盖模式）' : ''}</span>
        <span>系统 runtime：{current?.app_runtime_root ?? health.data?.runtime_root ?? '未识别'}</span>
      </div>
      {lastResult && <div className="workspace-feedback" role="status">{lastResult}</div>}
      {sourceCount === 0 && chapterCount === 0 && (
        <div className="empty-state">
          <strong>素材库还没有索引。</strong>
          <span>当前扫描目录：{current?.root ?? path}</span>
          <span>请确认目录内存在 00-系统、01-设定、02-正文、03-章纲，或 content/settings、content/outlines、content/chapters。</span>
        </div>
      )}
    </section>
  );
}
