import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '../api';
import { useMemoryItems } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { ContextPreview } from '../types';
import { Button } from './ui/Button';

export function MemoryView({ compact = false }: { compact?: boolean }) {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const memory = useMemoryItems();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [showRawMemory, setShowRawMemory] = useState(false);

  const rebuildMutation = useMutation({
    mutationFn: () => apiRequest<Record<string, number>>('/api/memory/rebuild', { method: 'POST' }),
    onMutate: () => pushTask({ label: '重建短记忆', status: 'running', detail: '正在重建短记忆索引。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      pushTask({ label: '重建短记忆', status: 'succeeded', detail: `核心事实 ${result.core_facts ?? 0}，章卡 ${result.chapter_cards ?? 0}，摘要 ${result.chapter_summaries ?? 0}。` });
    },
    onError: (error: Error) => pushTask({ label: '重建短记忆', status: 'failed', detail: error.message }),
  });

  const previewMutation = useMutation({
    mutationFn: () => apiRequest<ContextPreview>(`/api/memory/context-preview?chapter_id=${selectedChapterId}`),
    onSuccess: (result) => {
      setPreview(result);
      pushTask({ label: '上下文预览', status: 'succeeded', detail: `核心事实 ${result.core_facts.length} 条。` });
    },
    onError: (error: Error) => pushTask({ label: '上下文预览', status: 'failed', detail: error.message }),
  });

  const grouped = new Map<string, number>();
  for (const item of memory.data ?? []) {
    grouped.set(item.kind, (grouped.get(item.kind) ?? 0) + 1);
  }


  if (compact) {
    const total = (memory.data ?? []).length;
    return (
      <main className="content-view memory-view memory-view--compact">
        <div className="dashboard-grid">
          {[...grouped.entries()].map(([kind, count]) => (
            <section className="metric-card" key={kind}>
              <span>{kind}</span>
              <strong>{count}</strong>
            </section>
          ))}
          {memory.isSuccess && total === 0 && <p className="muted">暂无短记忆。请先扫描并重建。</p>}
        </div>
        {total > 0 && (
          <p className="muted">已加载 {total} 份记忆，涵盖 {[...grouped.keys()].join('、')}。</p>
        )}
        <div className="action-row">
          <Button variant="secondary" onClick={() => rebuildMutation.mutate()} disabled={rebuildMutation.isPending} loading={rebuildMutation.isPending}>
            重建短记忆
          </Button>
        </div>
        {preview && (
          <details className="advanced-details">
            <summary>查看上下文预览</summary>
            <pre className="json-preview">{JSON.stringify(preview, null, 2)}</pre>
          </details>
        )}
        <details className="advanced-details">
          <summary>查看原始数据</summary>
          <div className="memory-list">
            {(memory.data ?? []).slice(0, 12).map((item) => (
              <article className="memory-card" key={item.id}>
                <strong>{item.kind} / {item.scope}</strong>
                <p className="muted">{memorySummary(item.content_json)}</p>
                <pre>{item.content_json}</pre>
              </article>
            ))}
          </div>
        </details>
      </main>
    );
  }

  return (
    <main className="content-view memory-view">
      <div className="view-header">
        <div>
          <p className="eyebrow">记忆</p>
          <h1>短记忆与上下文预算</h1>
        </div>
        <div className="action-row">
          <Button variant="secondary" onClick={() => rebuildMutation.mutate()} disabled={rebuildMutation.isPending} loading={rebuildMutation.isPending}>
            重建短记忆
          </Button>
          <Button variant="secondary" onClick={() => previewMutation.mutate()} disabled={!selectedChapterId || previewMutation.isPending} loading={previewMutation.isPending}>
            当前章上下文预览
          </Button>
        </div>
      </div>
      <section className="workflow-card workflow-card--compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">上下文原则</p>
            <h2>短记忆按需注入，不把全书塞给模型</h2>
          </div>
        </div>
        <div className="memory-budget-grid">
          <div><strong>核心事实</strong><span>稳定设定、规则、禁止违反项</span></div>
          <div><strong>章节卡</strong><span>每章短摘要，用于跨章定位</span></div>
          <div><strong>人物/伏笔</strong><span>只选当前任务相关项</span></div>
          <div><strong>预算检查</strong><span>超限时应降级并记录原因</span></div>
        </div>
      </section>
      <div className="dashboard-grid">
        {[...grouped.entries()].map(([kind, count]) => (
          <section className="metric-card" key={kind}>
            <span>{kind}</span>
            <strong>{count}</strong>
          </section>
        ))}
        {memory.isSuccess && (memory.data ?? []).length === 0 && <p className="muted">暂无短记忆。请先扫描并重建。</p>}
      </div>
      <div className="split-grid">
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">全部记忆</p>
              <h2>索引摘要</h2>
            </div>
            <Button variant="secondary" onClick={() => setShowRawMemory((value) => !value)}>
              {showRawMemory ? '隐藏 JSON' : '查看 JSON'}
            </Button>
          </div>
          <p className="muted view-note">短记忆用于给模型注入必要上下文。默认只看类型、范围和摘要；需要排错时再展开 JSON。</p>
          <div className="memory-list">
            {(memory.data ?? []).slice(0, 80).map((item) => (
              <article className="memory-card" key={item.id}>
                <strong>{item.kind} / {item.scope}</strong>
                <p className="muted">{memorySummary(item.content_json)}</p>
                {showRawMemory && <pre>{item.content_json}</pre>}
              </article>
            ))}
          </div>
        </section>
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">上下文</p>
              <h2>当前章注入预览</h2>
            </div>
          </div>
          {preview ? <pre className="json-preview">{JSON.stringify(preview, null, 2)}</pre> : <p className="muted">选择正文后点击"当前章上下文预览"。</p>}
        </section>
      </div>
    </main>
  );
}

function memorySummary(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return parsed.slice(0, 160);
    }
    if (parsed && typeof parsed === 'object') {
      const values = Object.entries(parsed as Record<string, unknown>)
        .slice(0, 4)
        .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
      return values.join('；').slice(0, 220);
    }
  } catch {
    return raw.slice(0, 180);
  }
  return raw.slice(0, 180);
}
