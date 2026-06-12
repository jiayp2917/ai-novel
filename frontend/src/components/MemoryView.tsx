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
    onMutate: () => pushTask({ label: '整理写作参考资料', status: 'running', detail: '正在整理人物、伏笔、章节摘要和批注规则。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      pushTask({ label: '整理写作参考资料', status: 'succeeded', detail: `核心事实 ${result.core_facts ?? 0}，章卡 ${result.chapter_cards ?? 0}，摘要 ${result.chapter_summaries ?? 0}。` });
    },
    onError: (error: Error) => pushTask({ label: '整理写作参考资料', status: 'failed', detail: error.message }),
  });

  const previewMutation = useMutation({
    mutationFn: () => apiRequest<ContextPreview>(`/api/memory/context-preview?chapter_id=${selectedChapterId}`),
    onSuccess: (result) => {
      setPreview(result);
      pushTask({ label: '写作参考预览', status: 'succeeded', detail: `本章将带入核心事实 ${result.core_facts.length} 条。` });
    },
    onError: (error: Error) => pushTask({ label: '写作参考预览', status: 'failed', detail: error.message }),
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
          {memory.isSuccess && total === 0 && <p className="muted">暂无写作参考资料。请先扫描作品并整理。</p>}
        </div>
        {total > 0 && (
          <p className="muted">已准备 {total} 份写作参考资料，涵盖 {[...grouped.keys()].join('、')}；AI 写作时只带入与当前章节相关的部分。</p>
        )}
        <div className="action-row">
          <Button variant="secondary" onClick={() => rebuildMutation.mutate()} disabled={rebuildMutation.isPending} loading={rebuildMutation.isPending}>
            整理写作参考资料
          </Button>
        </div>
        {preview && (
          <details className="advanced-details">
            <summary>查看本章会带入的参考资料</summary>
            <ContextPreviewSummary preview={preview} />
            <details className="advanced-details">
              <summary>高级：查看原始 JSON</summary>
              <pre className="json-preview">{JSON.stringify(preview, null, 2)}</pre>
            </details>
          </details>
        )}
        <details className="advanced-details">
          <summary>高级：查看原始资料</summary>
          <div className="memory-list">
            {(memory.data ?? []).slice(0, 12).map((item) => (
              <article className="memory-card" key={item.id}>
                <strong>{item.kind} / {item.scope}</strong>
                <p className="muted">{memorySummary(item.content_json)}</p>
                <details className="advanced-details">
                  <summary>原始 JSON</summary>
                  <pre>{item.content_json}</pre>
                </details>
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
          <p className="eyebrow">写作参考资料</p>
          <h1>人物、伏笔、摘要和批注规则</h1>
        </div>
        <div className="action-row">
          <Button variant="secondary" onClick={() => rebuildMutation.mutate()} disabled={rebuildMutation.isPending} loading={rebuildMutation.isPending}>
            整理写作参考资料
          </Button>
          <Button variant="secondary" onClick={() => previewMutation.mutate()} disabled={!selectedChapterId || previewMutation.isPending} loading={previewMutation.isPending}>
            预览本章参考资料
          </Button>
        </div>
      </div>
      <section className="workflow-card workflow-card--compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">使用原则</p>
            <h2>只给 AI 当前任务需要的资料</h2>
          </div>
        </div>
        <div className="memory-budget-grid">
          <div><strong>人物与设定</strong><span>稳定规则、角色状态、禁止违反项</span></div>
          <div><strong>章节摘要</strong><span>帮助 AI 知道前文发生了什么</span></div>
          <div><strong>伏笔与时间线</strong><span>只选当前章节需要照应的内容</span></div>
          <div><strong>批注规则</strong><span>作者已确认的问题会沉淀成检查规则</span></div>
        </div>
      </section>
      <div className="dashboard-grid">
        {[...grouped.entries()].map(([kind, count]) => (
          <section className="metric-card" key={kind}>
            <span>{kind}</span>
            <strong>{count}</strong>
          </section>
        ))}
        {memory.isSuccess && (memory.data ?? []).length === 0 && <p className="muted">暂无写作参考资料。请先扫描作品并整理。</p>}
      </div>
      <div className="split-grid">
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">资料索引</p>
              <h2>AI 可引用的写作参考</h2>
            </div>
            <Button variant="secondary" onClick={() => setShowRawMemory((value) => !value)}>
              {showRawMemory ? '隐藏原始 JSON' : '高级：查看 JSON'}
            </Button>
          </div>
          <p className="muted view-note">这些资料用于给 AI 补充必要背景。普通写作只看摘要即可，原始 JSON 仅用于排错。</p>
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
              <p className="eyebrow">本章参考</p>
              <h2>写作前会带入哪些资料</h2>
            </div>
          </div>
          {preview ? (
            <>
              <ContextPreviewSummary preview={preview} />
              <details className="advanced-details">
                <summary>高级：查看原始 JSON</summary>
                <pre className="json-preview">{JSON.stringify(preview, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className="muted">选择正文后点击“预览本章参考资料”。</p>
          )}
        </section>
      </div>
    </main>
  );
}

function ContextPreviewSummary({ preview }: { preview: ContextPreview }) {
  return (
    <div className="memory-preview-summary">
      <span><strong>核心事实</strong>{preview.core_facts.length} 条</span>
      <span><strong>章节摘要</strong>{preview.chapter_card ? '已准备' : '暂无'}</span>
      <span><strong>结构状态</strong>{preview.structured_state ? '已准备' : '暂无'}</span>
      <span><strong>批注规则</strong>{preview.annotation_insights.length} 条</span>
    </div>
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
