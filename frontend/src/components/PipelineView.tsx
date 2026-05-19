import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiRequest, queryClient } from '../api';
import { useChapters, useCostDashboard, usePipelineRuns } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { PipelineRun, PipelineRunCreatePayload } from '../types';

const modeLabels: Record<PipelineRunCreatePayload['mode'], string> = {
  review_only: '只审核候选',
  generate_missing: '缺失正文生成',
  review_fix: '审核 + 修复候选',
  full_auto: '全自动生成审核修复',
};

const statusLabels: Record<string, string> = {
  planned: '已规划',
  queued: '排队中',
  context_built: '上下文已构建',
  draft_generated: '候选已生成',
  local_validated: '本地规则已通过',
  reviewed: '已审核',
  fixing: '修复中',
  approved: '已批准',
  published: '已发布',
  summarized: '记忆已更新',
  done: '完成',
  paused: '已暂停',
  manual_required: '待人工处理',
  paused_budget: '预算暂停',
  failed_retryable: '可重试失败',
  failed_terminal: '终止失败',
};

export function PipelineView() {
  const chapters = useChapters();
  const runs = usePipelineRuns();
  const cost = useCostDashboard();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const chapterCount = chapters.data?.length ?? 0;
  const [form, setForm] = useState<PipelineRunCreatePayload>({
    start_chapter: 1,
    end_chapter: Math.min(3, Math.max(1, chapterCount || 3)),
    mode: 'review_fix',
    chunk_size: 3,
    max_fix_rounds: 2,
    dry_run: true,
  });
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const selectedRun = useMemo(
    () => runs.data?.find((run) => run.id === selectedRunId) ?? runs.data?.[0] ?? null,
    [runs.data, selectedRunId],
  );

  const createRun = useMutation({
    mutationFn: () =>
      apiRequest<PipelineRun>('/api/pipeline/runs', {
        method: 'POST',
        body: JSON.stringify(form),
      }),
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      pushTask({ label: '自动流水线', status: 'succeeded', detail: `已创建第 ${form.start_chapter}-${form.end_chapter} 章任务` });
    },
    onError: (error: Error) => pushTask({ label: '自动流水线', status: 'failed', detail: error.message }),
  });

  const mutateRun = useMutation({
    mutationFn: ({ runId, action }: { runId: number; action: 'pause' | 'resume' | 'retry' | 'cancel' }) =>
      apiRequest<PipelineRun>(`/api/pipeline/runs/${runId}/${action}`, { method: 'POST' }),
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      pushTask({ label: '自动流水线', status: 'succeeded', detail: `任务 ${run.id} 状态：${statusText(run.status)}` });
    },
    onError: (error: Error) => pushTask({ label: '自动流水线', status: 'failed', detail: error.message }),
  });

  function updateNumber(name: keyof PipelineRunCreatePayload, value: string) {
    const parsed = Number.parseInt(value, 10);
    setForm((current) => ({ ...current, [name]: Number.isFinite(parsed) ? parsed : 0 }));
  }

  return (
    <main className="content-view">
      <div className="view-header">
        <div>
          <p className="eyebrow">自动流水线</p>
          <h1>章节范围生产、审核与修复</h1>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={() => runs.refetch()}>
            刷新状态
          </button>
          <button className="secondary-button" type="button" onClick={() => setActiveView('models')}>
            查看模型任务
          </button>
        </div>
      </div>

      <section className="workflow-card workflow-card--compact">
        <div className="pipeline-summary">
          <span>已索引正文：{chapterCount} 章</span>
          <span>流水线任务：{runs.data?.length ?? 0}</span>
          <span>今日模型调用：{cost.data?.today_model_calls ?? 0}</span>
          <span>运行中任务：{cost.data?.running_jobs ?? 0}</span>
        </div>
      </section>

      <div className="split-grid">
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">创建任务</p>
              <h2>选择章节范围和执行模式</h2>
            </div>
          </div>
          <div className="pipeline-form-preview" aria-label="自动流水线计划参数">
            <label>
              起始章节
              <input min={1} type="number" value={form.start_chapter} onChange={(event) => updateNumber('start_chapter', event.target.value)} />
            </label>
            <label>
              结束章节
              <input min={1} type="number" value={form.end_chapter} onChange={(event) => updateNumber('end_chapter', event.target.value)} />
            </label>
            <label>
              执行模式
              <select value={form.mode} onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value as PipelineRunCreatePayload['mode'] }))}>
                {Object.entries(modeLabels).map(([mode, label]) => (
                  <option key={mode} value={mode}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              分片大小
              <input min={1} max={20} type="number" value={form.chunk_size} onChange={(event) => updateNumber('chunk_size', event.target.value)} />
            </label>
            <label>
              最大修复轮次
              <input min={0} max={5} type="number" value={form.max_fix_rounds} onChange={(event) => updateNumber('max_fix_rounds', event.target.value)} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.dry_run} onChange={(event) => setForm((current) => ({ ...current, dry_run: event.target.checked }))} />
              dry-run，不写回正文
            </label>
          </div>
          <p className="form-hint">
            创建后可在“模型任务”页点击“运行任务队列”逐步执行。dry-run 不写回正文；真正写回仍必须走发布门，设定和章纲只生成提案。
          </p>
          <div className="action-row">
            <button className="primary-button" type="button" onClick={() => createRun.mutate()} disabled={createRun.isPending}>
              创建流水线任务
            </button>
          </div>
        </section>

        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">任务列表</p>
              <h2>最近流水线任务</h2>
            </div>
          </div>
          <div className="pipeline-run-list">
            {runs.data?.map((run) => (
              <button
                className={`pipeline-run-item ${selectedRun?.id === run.id ? 'is-active' : ''}`}
                key={run.id}
                type="button"
                onClick={() => setSelectedRunId(run.id)}
              >
                <strong>#{run.id} {modeLabels[(run.payload.mode as PipelineRunCreatePayload['mode'])] ?? run.payload.mode}</strong>
                <span>第 {String(run.payload.start_chapter)}-{String(run.payload.end_chapter)} 章 · {statusText(run.status)}</span>
              </button>
            ))}
            {runs.isLoading && <p className="muted">正在加载流水线任务...</p>}
            {!runs.isLoading && !runs.data?.length && <p className="muted">还没有流水线任务。</p>}
          </div>
        </section>
      </div>

      <section className="workflow-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">任务详情</p>
            <h2>{selectedRun ? `流水线 #${selectedRun.id}` : '请选择一个流水线任务'}</h2>
          </div>
          {selectedRun && (
            <div className="action-row">
              <button className="secondary-button" type="button" onClick={() => mutateRun.mutate({ runId: selectedRun.id, action: 'pause' })} disabled={mutateRun.isPending || selectedRun.status === 'paused'}>
                暂停
              </button>
              <button className="secondary-button" type="button" onClick={() => mutateRun.mutate({ runId: selectedRun.id, action: 'resume' })} disabled={mutateRun.isPending || selectedRun.status !== 'paused'}>
                恢复
              </button>
              <button className="secondary-button" type="button" onClick={() => mutateRun.mutate({ runId: selectedRun.id, action: 'retry' })} disabled={mutateRun.isPending || !['failed_retryable', 'paused_budget'].includes(selectedRun.status)}>
                重试
              </button>
              <button className="danger-button" type="button" onClick={() => mutateRun.mutate({ runId: selectedRun.id, action: 'cancel' })} disabled={mutateRun.isPending || ['done', 'failed_terminal', 'manual_required'].includes(selectedRun.status)}>
                取消
              </button>
            </div>
          )}
        </div>
        {selectedRun ? (
          <div className="pipeline-detail-grid">
            <div className="model-output-map">
              <span>状态：{statusText(selectedRun.status)}</span>
              <span>模式：{String(selectedRun.payload.mode)}</span>
              <span>章节：第 {String(selectedRun.payload.start_chapter)}-{String(selectedRun.payload.end_chapter)} 章</span>
              <span>分片：{String(selectedRun.payload.chunk_size)} 章/批</span>
              <span>dry-run：{selectedRun.payload.dry_run ? '是' : '否'}</span>
              <span>input_hash：{String(selectedRun.payload.input_hash ?? '').slice(0, 16)}...</span>
              {selectedRun.error && <span>错误：{selectedRun.error}</span>}
            </div>
            <pre className="json-preview">{JSON.stringify(selectedRun, null, 2)}</pre>
          </div>
        ) : (
          <p className="muted">创建或选择任务后，这里会显示状态、参数、错误和子任务。</p>
        )}
      </section>

      <section className="workflow-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">安全节点</p>
            <h2>自动任务必须经过的边界</h2>
          </div>
        </div>
        <div className="pipeline-lanes">
          <span>1 构建上下文，记录预算</span>
          <span>2 生成候选，保存 artifact</span>
          <span>3 本地规则预检</span>
          <span>4 证据约束审核 JSON</span>
          <span>5 只修复 writer 问题</span>
          <span>6 复审通过后进入发布门</span>
          <span>7 dry-run 只生成 diff，正式模式才串行写回</span>
          <span>8 发布后更新短记忆与运行报告</span>
        </div>
      </section>
    </main>
  );
}

function statusText(status: string): string {
  return statusLabels[status] ?? status;
}
