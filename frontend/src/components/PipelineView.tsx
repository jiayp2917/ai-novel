import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ApiRequestError, apiRequest, queryClient } from '../api';
import { useChapters, useCostDashboard, usePipelineRuns } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { Job, PipelineRun, PipelineRunCreatePayload } from '../types';

const RUN_LIST_LIMIT = 20;

const modeLabels: Record<PipelineRunCreatePayload['mode'], string> = {
  review_only: '只检查已有草稿',
  generate_missing: '只补齐缺失草稿',
  review_fix: '检查并生成修订草稿',
  full_auto: '全自动生成、检查、修订',
};

const modeDescriptions: Record<PipelineRunCreatePayload['mode'], string> = {
  review_only: '适合已经有草稿，只想批量检查问题。',
  generate_missing: '适合缺章或短稿，只生成候选，不自动写回。',
  review_fix: '适合已有草稿，希望系统检查后按问题生成修订候选。',
  full_auto: '适合沙盒或明确授权的批量流程；正式写回仍受发布门控制。',
};

const statusLabels: Record<string, string> = {
  planned: '等待开始',
  queued: '等待执行',
  context_built: '上下文已准备',
  draft_generated: '草稿已生成',
  local_validated: '本地规则已通过',
  reviewed: '已检查',
  fixing: '正在修订',
  approved: '可进入写回确认',
  published: '已写回',
  summarized: '记忆已整理',
  done: '已完成',
  paused: '已暂停',
  manual_required: '需要人工判断',
  paused_budget: 'AI 调用已暂停',
  failed_retryable: '失败，可重试',
  failed_terminal: '已终止',
};

const taskLabels: Record<string, string> = {
  generate_chapter_draft: '生成草稿',
  review_chapter_candidate: '检查草稿',
  fix_chapter_candidate: '修订草稿',
  publish_chapter_candidate: '写回确认',
  summarize_published_chapter: '整理记忆',
};

const runOperationHelp: Record<string, string> = {
  pause: '暂停后不会继续领取新步骤；已完成的草稿、检查报告会保留。',
  resume: '恢复后任务会回到队列，需要点击“运行一次队列”继续推进。',
  retry: '只适用于失败可重试或额度暂停的任务；重试后需要再次运行队列。',
  cancel: '停止后不能继续，只能复用相同设置重新创建一条流水线。',
  delete: '只删除这条流水线的任务记录，不删除草稿、报告、模型日志或正文。',
};

export function PipelineView() {
  const chapters = useChapters();
  const runs = usePipelineRuns();
  const cost = useCostDashboard();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const chapterCount = chapters.data?.length ?? 0;
  const defaultEnd = Math.min(10, Math.max(1, chapterCount || 10));
  const [form, setForm] = useState<PipelineRunCreatePayload>({
    start_chapter: 1,
    end_chapter: defaultEnd,
    mode: 'review_fix',
    chunk_size: 3,
    max_fix_rounds: 2,
    dry_run: true,
  });
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [pendingDeleteRun, setPendingDeleteRun] = useState<PipelineRun | null>(null);
  const [deleteDialogError, setDeleteDialogError] = useState<string | null>(null);
  const allRuns = runs.data ?? [];
  const visibleRuns = showAllRuns ? allRuns : allRuns.slice(0, RUN_LIST_LIMIT);
  const selectedRun = useMemo(
    () => allRuns.find((run) => run.id === selectedRunId) ?? allRuns[0] ?? null,
    [allRuns, selectedRunId],
  );
  const selectedSummary = selectedRun ? summarizeRun(selectedRun) : null;
  const selectedNextStep = selectedRun && selectedSummary ? nextStepForRun(selectedRun, selectedSummary) : null;

  const createRun = useMutation({
    mutationFn: () =>
      apiRequest<PipelineRun>('/api/pipeline/runs', {
        method: 'POST',
        body: JSON.stringify(form),
      }),
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      pushTask({ label: '自动流水线', status: 'succeeded', detail: `已创建第 ${form.start_chapter}-${form.end_chapter} 章任务。` });
    },
    onError: (error: Error) => pushTask({ label: '自动流水线', status: 'failed', detail: error.message }),
  });

  const mutateRun = useMutation({
    mutationFn: ({ runId, action }: { runId: number; action: 'pause' | 'resume' | 'retry' | 'cancel' }) =>
      apiRequest<PipelineRun>(`/api/pipeline/runs/${runId}/${action}`, { method: 'POST' }),
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      pushTask({ label: '自动流水线', status: 'succeeded', detail: `流水线 #${run.id}：${statusText(run.status)}。${nextStepForRun(run, summarizeRun(run)).text}` });
    },
    onError: (error: Error) => pushTask({ label: '自动流水线', status: 'failed', detail: error.message }),
  });

  const deleteRun = useMutation({
    mutationFn: async (runId: number) => {
      const [result] = await Promise.all([deletePipelineRun(runId), waitForDeleteFeedback()]);
      return result;
    },
    onMutate: (runId) => {
      setDeleteDialogError(null);
      pushTask({ label: '删除流水线记录', status: 'running', detail: `正在删除流水线 #${runId} 的任务记录。` });
    },
    onSuccess: (result) => {
      setPendingDeleteRun(null);
      setDeleteDialogError(null);
      setSelectedRunId(null);
      queryClient.setQueryData<PipelineRun[]>(['pipeline-runs'], (current) =>
        current ? current.filter((run) => run.id !== result.run_id) : current,
      );
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      pushTask({
        label: '删除流水线记录',
        status: 'succeeded',
        detail: `已删除流水线 #${result.run_id} 和 ${result.deleted_child_tasks} 个步骤记录。草稿、报告和日志已保留。`,
      });
    },
    onError: (error: Error) => {
      setDeleteDialogError(error.message);
      pushTask({ label: '删除流水线记录', status: 'failed', detail: error.message });
    },
  });

  const runJobsMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ started: number; succeeded: number; failed: number }>('/api/jobs/run-once', { method: 'POST' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      pushTask({
        label: '执行流水线',
        status: result.failed ? 'failed' : 'succeeded',
        detail: `本次启动 ${result.started} 个任务，完成 ${result.succeeded} 个，失败 ${result.failed} 个。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '执行流水线', status: 'failed', detail: error.message }),
  });

  function updateNumber(name: keyof PipelineRunCreatePayload, value: string) {
    const parsed = Number.parseInt(value, 10);
    setForm((current) => ({ ...current, [name]: Number.isFinite(parsed) ? parsed : 0 }));
  }

  function reuseRun(run: PipelineRun) {
    setForm({
      start_chapter: numberFromPayload(run, 'start_chapter', 1),
      end_chapter: numberFromPayload(run, 'end_chapter', defaultEnd),
      mode: modeFromPayload(run),
      chunk_size: numberFromPayload(run, 'chunk_size', 3),
      max_fix_rounds: numberFromPayload(run, 'max_fix_rounds', 2),
      dry_run: Boolean(run.payload.dry_run ?? true),
    });
    pushTask({ label: '自动流水线', status: 'succeeded', detail: `已套用流水线 #${run.id} 的设置，可调整后重新创建。` });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function confirmDeleteRun(run: PipelineRun) {
    setDeleteDialogError(null);
    setPendingDeleteRun(run);
  }

  return (
    <main className="content-view pipeline-workbench">
      <div className="view-header">
        <div>
          <p className="eyebrow">自动流水线</p>
          <h1>批量生成、检查和修订章节草稿</h1>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={() => runs.refetch()}>
            刷新进度
          </button>
          <button className="secondary-button" type="button" onClick={() => setActiveView('settings')}>
            查看 AI 设置
          </button>
        </div>
      </div>

      <section className="workflow-card workflow-card--compact">
        <div className="pipeline-summary">
          <span>已索引正文：{chapterCount} 章</span>
          <span>流水线任务：{runs.data?.length ?? 0}</span>
          <span>AI 用量：{cost.data?.today_model_calls ?? 0} 次</span>
          <span>运行中任务：{cost.data?.running_jobs ?? 0}</span>
        </div>
      </section>

      <section className="workflow-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">开始前确认</p>
            <h2>按 4 步创建自动任务</h2>
          </div>
          <span className={form.dry_run ? 'chip ok' : 'chip warn'}>
            {form.dry_run ? '只生成草稿和报告' : '允许进入写回确认'}
          </span>
        </div>
        <div className="pipeline-wizard">
          <label>
            <strong>1. 章节范围</strong>
            <span>建议先用 1-10 章沙盒验证。</span>
            <div className="pipeline-range">
              <input aria-label="起始章节" min={1} type="number" value={form.start_chapter} onChange={(event) => updateNumber('start_chapter', event.target.value)} />
              <span>到</span>
              <input aria-label="结束章节" min={1} type="number" value={form.end_chapter} onChange={(event) => updateNumber('end_chapter', event.target.value)} />
            </div>
          </label>
          <label>
            <strong>2. 选择模式</strong>
            <span>{modeDescriptions[form.mode]}</span>
            <select
              aria-label="执行模式"
              value={form.mode}
              onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value as PipelineRunCreatePayload['mode'] }))}
            >
              {Object.entries(modeLabels).map(([mode, label]) => (
                <option key={mode} value={mode}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <strong>3. 分批和修订</strong>
            <span>分片越小越稳，修订轮次越高越耗额度。</span>
            <div className="pipeline-range">
              <input aria-label="每批章节数" min={1} max={20} type="number" value={form.chunk_size} onChange={(event) => updateNumber('chunk_size', event.target.value)} />
              <input aria-label="最大修订轮次" min={0} max={5} type="number" value={form.max_fix_rounds} onChange={(event) => updateNumber('max_fix_rounds', event.target.value)} />
            </div>
          </label>
          <label className="pipeline-mode-card">
            <strong>4. 写回策略</strong>
            <span>开启后只生成草稿、检查结果和改动对比，不覆盖正文。</span>
            <span className="checkbox-row">
              <input type="checkbox" checked={form.dry_run} onChange={(event) => setForm((current) => ({ ...current, dry_run: event.target.checked }))} />
              只预演流程，不写回正文
            </span>
          </label>
        </div>
        <div className="notice safe">所有 AI 输出都会先进入草稿/候选。正式正文写回仍必须经过发布门；设定和章纲只生成提案。</div>
        <div className="action-row">
          <button className="primary-button" type="button" onClick={() => createRun.mutate()} disabled={createRun.isPending}>
            创建自动流水线
          </button>
          <button className="secondary-button" type="button" onClick={() => runJobsMutation.mutate()} disabled={runJobsMutation.isPending}>
            运行一次队列
          </button>
        </div>
      </section>

      <div className="pipeline-detail-grid">
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">任务列表</p>
              <h2>最近自动任务</h2>
            </div>
          </div>
          <p className="muted">点击左侧任务查看详情。默认显示最近 {RUN_LIST_LIMIT} 条；已完成、已终止或需人工判断的任务不会继续运行。</p>
          <div className="pipeline-run-list">
            {visibleRuns.map((run) => {
              const summary = summarizeRun(run);
              const step = nextStepForRun(run, summary);
              return (
                <button
                  className={`pipeline-run-item ${selectedRun?.id === run.id ? 'is-active' : ''}`}
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <strong>#{run.id} {modeLabels[(run.payload.mode as PipelineRunCreatePayload['mode'])] ?? run.payload.mode}</strong>
                  <span>第 {String(run.payload.start_chapter)}-{String(run.payload.end_chapter)} 章 · {statusText(run.status)}</span>
                  <small>{summary.done}/{summary.total} 个步骤完成 · {summary.manual} 个需人工判断 · {summary.failed} 个失败</small>
                  <small aria-hidden="true">{step.label}：{step.text}</small>
                </button>
              );
            })}
            {runs.isLoading && <p className="muted">正在加载自动任务...</p>}
            {!runs.isLoading && !allRuns.length && <p className="muted">还没有自动流水线任务。</p>}
          </div>
          {allRuns.length > RUN_LIST_LIMIT && (
            <button className="secondary-button pipeline-list-toggle" type="button" onClick={() => setShowAllRuns((value) => !value)}>
              {showAllRuns ? `收起到最近 ${RUN_LIST_LIMIT} 条` : `显示全部 ${allRuns.length} 条`}
            </button>
          )}
        </section>

        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">任务详情</p>
              <h2>{selectedRun ? `流水线 #${selectedRun.id}` : '请选择一个任务'}</h2>
            </div>
            {selectedRun && (
              <div className="action-row">
                <button
                  className="secondary-button"
                  type="button"
                  title={runOperationHelp.pause}
                  onClick={() => mutateRun.mutate({ runId: selectedRun.id, action: 'pause' })}
                  disabled={mutateRun.isPending || !canPause(selectedRun)}
                  aria-disabled-reason={!canPause(selectedRun) ? disabledReason('pause', selectedRun) : undefined}
                >
                  暂停
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  title={runOperationHelp.resume}
                  onClick={() => mutateRun.mutate({ runId: selectedRun.id, action: 'resume' })}
                  disabled={mutateRun.isPending || !canResume(selectedRun)}
                  aria-disabled-reason={!canResume(selectedRun) ? disabledReason('resume', selectedRun) : undefined}
                >
                  恢复
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  title={runOperationHelp.retry}
                  onClick={() => mutateRun.mutate({ runId: selectedRun.id, action: 'retry' })}
                  disabled={mutateRun.isPending || !canRetry(selectedRun)}
                  aria-disabled-reason={!canRetry(selectedRun) ? disabledReason('retry', selectedRun) : undefined}
                >
                  重试
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => reuseRun(selectedRun)}
                  disabled={mutateRun.isPending}
                >
                  复用设置
                </button>
                <button
                  className="danger-button"
                  type="button"
                  title={runOperationHelp.cancel}
                  onClick={() => mutateRun.mutate({ runId: selectedRun.id, action: 'cancel' })}
                  disabled={mutateRun.isPending || !canCancel(selectedRun)}
                  aria-disabled-reason={!canCancel(selectedRun) ? disabledReason('cancel', selectedRun) : undefined}
                >
                  停止
                </button>
                <button
                  className="danger-button danger-button--quiet"
                  type="button"
                  title={runOperationHelp.delete}
                  onClick={() => confirmDeleteRun(selectedRun)}
                  disabled={deleteRun.isPending}
                >
                  删除记录
                </button>
              </div>
            )}
          </div>
          {selectedRun && selectedSummary ? (
            <>
              <div className="pipeline-progress">
                <strong>{selectedSummary.done}/{selectedSummary.total}</strong>
                <span>步骤完成</span>
                <progress value={selectedSummary.done} max={Math.max(1, selectedSummary.total)} />
              </div>
              <div className="pipeline-status-grid">
                <span>状态：{statusText(selectedRun.status)}</span>
                <span>需人工判断：{selectedSummary.manual}</span>
                <span>失败/暂停：{selectedSummary.failed}</span>
                <span>预演模式：{selectedRun.payload.dry_run ? '是' : '否'}</span>
              </div>
              {selectedNextStep && (
                <div className={`pipeline-next-step pipeline-next-step--${selectedNextStep.tone}`}>
                  <strong>{selectedNextStep.label}</strong>
                  <span>{selectedNextStep.text}</span>
                  {selectedRun.error && <small>任务提示：{selectedRun.error}</small>}
                </div>
              )}
              <PipelineFailureSummary run={selectedRun} />
              <PipelineReportSummary run={selectedRun} />
              <div className="pipeline-chapter-timeline">
                {groupTasksByChapter(selectedRun.child_tasks).map(([chapterNo, tasks]) => (
                  <article className="pipeline-chapter-card" key={chapterNo}>
                    <strong>第 {chapterNo} 章</strong>
                    <div>
                      {tasks.map((task) => (
                        <span className={`pipeline-task-pill status-${task.status}`} key={task.id} title={task.error ?? undefined}>
                          {taskTypeLabel(task.type)}：{statusText(task.status)}
                          {task.error ? ` · ${task.error}` : ''}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <details className="advanced-details">
                <summary>查看高级详情</summary>
                <div className="pipeline-advanced-grid">
                  <span>任务编号：#{selectedRun.id}</span>
                  <span>模式：{modeLabels[(selectedRun.payload.mode as PipelineRunCreatePayload['mode'])] ?? String(selectedRun.payload.mode ?? '未知')}</span>
                  <span>章节：第 {String(selectedRun.payload.start_chapter)}-{String(selectedRun.payload.end_chapter)} 章</span>
                  <span>报告：{selectedRun.report_summary.path ?? '暂无'}</span>
                </div>
              </details>
            </>
          ) : (
            <p className="muted">创建或选择任务后，这里会显示每章进度、失败原因和报告详情。</p>
          )}
        </section>
      </div>

      <section className="workflow-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">安全节点</p>
            <h2>自动任务的固定边界</h2>
          </div>
        </div>
        <div className="pipeline-lanes">
          <span>1 选择作品</span>
          <span>2 选择章节范围</span>
          <span>3 选择执行模式</span>
          <span>4 设置预算和预演模式</span>
          <span>5 生成草稿/候选</span>
          <span>6 证据约束检查</span>
          <span>7 只修复可修 writer 问题</span>
          <span>8 报告和发布门确认</span>
        </div>
      </section>
      <PipelineDeleteDialog
        busy={deleteRun.isPending}
        error={deleteDialogError}
        run={pendingDeleteRun}
        onCancel={() => {
          if (!deleteRun.isPending) {
            setDeleteDialogError(null);
            setPendingDeleteRun(null);
          }
        }}
        onConfirm={() => {
          if (pendingDeleteRun) {
            deleteRun.mutate(pendingDeleteRun.id);
          }
        }}
      />
    </main>
  );
}

function statusText(status: string): string {
  return statusLabels[status] ?? status;
}

function taskTypeLabel(type: string): string {
  return taskLabels[type] ?? type;
}

function summarizeRun(run: PipelineRun): { total: number; done: number; manual: number; failed: number } {
  if (run.summary) {
    return {
      total: run.summary.total_steps,
      done: run.summary.completed_steps,
      manual: run.summary.manual_required_steps,
      failed: run.summary.failed_or_paused_steps,
    };
  }
  const terminalDone = new Set(['approved', 'published', 'summarized', 'done']);
  const manual = run.child_tasks.filter((task) => task.status === 'manual_required').length;
  const failed = run.child_tasks.filter((task) => ['failed_terminal', 'failed_retryable', 'paused_budget'].includes(task.status)).length;
  const done = run.child_tasks.filter((task) => terminalDone.has(task.status)).length;
  return { total: run.child_tasks.length, done, manual, failed };
}

function numberFromPayload(run: PipelineRun, key: string, fallback: number): number {
  const value = run.payload[key];
  return typeof value === 'number' ? value : fallback;
}

function modeFromPayload(run: PipelineRun): PipelineRunCreatePayload['mode'] {
  const mode = run.payload.mode;
  return mode === 'review_only' || mode === 'generate_missing' || mode === 'review_fix' || mode === 'full_auto' ? mode : 'review_fix';
}

function canPause(run: PipelineRun): boolean {
  return !['paused', 'done', 'failed_terminal', 'manual_required'].includes(run.status);
}

function canResume(run: PipelineRun): boolean {
  return run.status === 'paused' || run.status === 'paused_budget';
}

function canRetry(run: PipelineRun): boolean {
  return run.status === 'failed_retryable' || run.status === 'paused_budget';
}

function canCancel(run: PipelineRun): boolean {
  return !['done', 'failed_terminal', 'manual_required'].includes(run.status);
}

function canDelete(run: PipelineRun): boolean {
  return run.summary?.can_delete ?? ['done', 'failed_terminal', 'manual_required'].includes(run.status);
}

function disabledReason(action: 'pause' | 'resume' | 'retry' | 'cancel' | 'delete', run: PipelineRun): string {
  if (action === 'resume') {
    return '只有已暂停或额度暂停的任务可以恢复。';
  }
  if (action === 'retry') {
    return '只有可重试失败或额度暂停的任务可以重试。';
  }
  if (action === 'delete') {
    return '只能删除已完成、已终止或需人工处理的记录。';
  }
  if (action === 'pause') {
    return '已结束或需人工处理的任务不能暂停。';
  }
  return '已结束或需人工处理的任务不能停止。';
}

function nextStepForRun(run: PipelineRun, summary: { total: number; done: number; manual: number; failed: number }): { label: string; text: string; tone: 'ok' | 'warn' | 'danger' | 'info' } {
  if (run.next_step) {
    return run.next_step;
  }
  if (run.status === 'done') {
    return { label: '已完成', text: '可查看报告和产物；如要重新跑，请点击“复用设置”。', tone: 'ok' };
  }
  if (run.status === 'manual_required' || summary.manual > 0) {
    return { label: '需要人工处理', text: '请查看下方标红步骤的原因。处理后建议复用设置重新创建，或在 AI 工作台查看对应草稿。', tone: 'warn' };
  }
  if (run.status === 'failed_terminal') {
    return { label: '已停止', text: '这条任务不会继续运行；可复用设置重新创建一条新任务。', tone: 'danger' };
  }
  if (run.status === 'failed_retryable') {
    return { label: '可重试', text: '点击“重试”，再点击“运行一次队列”。如果连续失败，请先查看失败原因。', tone: 'danger' };
  }
  if (run.status === 'paused_budget') {
    return { label: '额度暂停', text: '确认 AI 调用预算后点击“重试”或“恢复”，再运行队列。', tone: 'warn' };
  }
  if (run.status === 'paused') {
    return { label: '已暂停', text: '点击“恢复”，再点击“运行一次队列”继续。', tone: 'info' };
  }
  if (summary.failed > 0) {
    return { label: '有步骤失败', text: '查看标红步骤原因；可重试的任务会显示重试入口。', tone: 'danger' };
  }
  return { label: '下一步', text: '点击“运行一次队列”推进任务。每次只执行一批，便于观察失败原因和额度消耗。', tone: 'info' };
}

function deleteBlockReason(run: PipelineRun): string | null {
  return run.summary?.delete_block_reason ?? (canDelete(run) ? null : disabledReason('delete', run));
}

function PipelineFailureSummary({ run }: { run: PipelineRun }) {
  const failures = run.summary?.failure_summaries ?? [];
  if (!failures.length) {
    return null;
  }
  return (
    <section className="pipeline-failure-summary" aria-label="失败章节摘要">
      <strong>失败和人工处理摘要</strong>
      {failures.map((failure) => (
        <article className="pipeline-failure-card" key={failure.job_id}>
          <span>第 {failure.chapter_no ? String(failure.chapter_no).padStart(3, '0') : '未知'} 章 · {failure.task_label}</span>
          <b>{failure.status_label}</b>
          <p>{failure.reason}</p>
          <small>{failure.next_step}</small>
        </article>
      ))}
    </section>
  );
}

function PipelineReportSummary({ run }: { run: PipelineRun }) {
  const report = run.report_summary;
  return (
    <section className="pipeline-report-summary" aria-label="流水线报告摘要">
      <strong>运行报告</strong>
      <span>{report?.path ?? '任务结束后生成轻量报告'}</span>
      <small>{report?.note ?? '报告保存在当前工作区 runtime/reports，不进入 Git。'}</small>
    </section>
  );
}

function groupTasksByChapter(tasks: Job[]): Array<[string, Job[]]> {
  const groups = new Map<string, Job[]>();
  for (const task of tasks) {
    const chapterNo = typeof task.payload.chapter_no === 'number' ? String(task.payload.chapter_no).padStart(3, '0') : '未知';
    groups.set(chapterNo, [...(groups.get(chapterNo) ?? []), task]);
  }
  return [...groups.entries()];
}

async function deletePipelineRun(runId: number): Promise<{ deleted: boolean; run_id: number; deleted_child_tasks: number }> {
  try {
    return await apiRequest<{ deleted: boolean; run_id: number; deleted_child_tasks: number }>(`/api/pipeline/runs/${runId}/delete`, { method: 'POST' });
  } catch (error) {
    if (error instanceof ApiRequestError && [404, 405].includes(error.status)) {
      try {
        return await apiRequest<{ deleted: boolean; run_id: number; deleted_child_tasks: number }>(`/api/pipeline/runs/${runId}`, { method: 'DELETE' });
      } catch (fallbackError) {
        if (fallbackError instanceof ApiRequestError && [404, 405].includes(fallbackError.status)) {
          throw new Error('删除接口不可用，请重启后端服务后再试。');
        }
        throw fallbackError;
      }
    }
    throw error;
  }
}

function waitForDeleteFeedback(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 180));
}

function PipelineDeleteDialog({
  run,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  run: PipelineRun | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!run) {
    return null;
  }
  const summary = summarizeRun(run);
  const blockedReason = deleteBlockReason(run);
  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="pipeline-delete-title">
        <div className="confirm-dialog__header">
          <span className="confirm-dialog__mark confirm-dialog__mark--delete">删</span>
          <div>
            <h3 id="pipeline-delete-title">确认删除流水线记录</h3>
            <p>
              删除流水线 #{run.id} 的任务列表和 {summary.total} 个步骤记录？这不会删除草稿、报告、模型日志或正文。
            </p>
          </div>
        </div>
        <div className="notice danger">删除后列表中不再显示这条任务；已生成的产物仍保留在运行记录中。</div>
        {blockedReason && <div className="notice danger" role="alert">{blockedReason}</div>}
        {error && <div className="notice danger" role="alert">{error}</div>}
        <div className="confirm-dialog__actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="secondary-button danger-button" type="button" onClick={onConfirm} disabled={busy || Boolean(blockedReason)}>
            {busy ? '删除中...' : '确认删除'}
          </button>
        </div>
      </section>
    </div>
  );
}
