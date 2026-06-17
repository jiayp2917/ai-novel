import type { Job, PipelineRun, PipelineRunCreatePayload } from '../../types';
import { statusLabels } from '../../lib/pipelineLabels';

export const RUN_LIST_LIMIT = 20;

export function statusText(status: string): string {
  return statusLabels[status] ?? status;
}

export function summarizeRun(run: PipelineRun): { total: number; done: number; manual: number; failed: number } {
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

export function numberFromPayload(run: PipelineRun, key: string, fallback: number): number {
  const value = run.payload[key];
  return typeof value === 'number' ? value : fallback;
}

export function modeFromPayload(run: PipelineRun): PipelineRunCreatePayload['mode'] {
  const mode = run.payload.mode;
  return mode === 'review_only' || mode === 'generate_missing' || mode === 'review_fix' || mode === 'full_auto' ? mode : 'review_fix';
}

export function generationModeFromPayload(run: PipelineRun): PipelineRunCreatePayload['generation_mode'] {
  const mode = run.payload.generation_mode;
  return mode === 'quality' || mode === 'fast' || mode === 'stable' ? mode : 'stable';
}

export function canPause(run: PipelineRun): boolean {
  return !['paused', 'done', 'failed_terminal', 'manual_required'].includes(run.status);
}

export function canResume(run: PipelineRun): boolean {
  return run.status === 'paused' || run.status === 'paused_budget';
}

export function canRetry(run: PipelineRun): boolean {
  return run.status === 'failed_retryable' || run.status === 'paused_budget';
}

export function canCancel(run: PipelineRun): boolean {
  return !['done', 'failed_terminal', 'manual_required'].includes(run.status);
}

export function canDelete(run: PipelineRun): boolean {
  return run.summary?.can_delete ?? ['done', 'failed_terminal', 'manual_required'].includes(run.status);
}

export function disabledReason(action: 'pause' | 'resume' | 'retry' | 'cancel' | 'delete', run: PipelineRun): string {
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

export function deleteBlockReason(run: PipelineRun): string | null {
  return run.summary?.delete_block_reason ?? (canDelete(run) ? null : disabledReason('delete', run));
}

export type NextStepTone = 'ok' | 'warn' | 'danger' | 'info';
export type RunNextStep = { label: string; text: string; tone: NextStepTone };

export function nextStepForRun(run: PipelineRun, summary: { total: number; done: number; manual: number; failed: number }): RunNextStep {
  if (run.next_step) {
    return run.next_step;
  }
  if (run.status === 'done') {
    return { label: '已完成', text: '可查看报告和产物；如要重新跑，请点击"复用设置"。', tone: 'ok' };
  }
  if (run.status === 'manual_required' || summary.manual > 0) {
    return { label: '需要人工处理', text: '请查看下方标红步骤的原因。处理后建议复用设置重新创建，或在 AI 工作台查看对应草稿。', tone: 'warn' };
  }
  if (run.status === 'failed_terminal') {
    return { label: '已停止', text: '这条任务不会继续运行；可复用设置重新创建一条新任务。', tone: 'danger' };
  }
  if (run.status === 'failed_retryable') {
    return { label: '可重试', text: '点击"重试"，再点击"推进一次任务"。如果连续失败，请先查看失败原因。', tone: 'danger' };
  }
  if (run.status === 'paused_budget') {
    return { label: '额度暂停', text: '确认 AI 调用预算后点击"重试"或"恢复"，再推进任务。', tone: 'warn' };
  }
  if (run.status === 'paused') {
    return { label: '已暂停', text: '点击"恢复"，再点击"推进一次任务"继续。', tone: 'info' };
  }
  if (summary.failed > 0) {
    return { label: '有步骤失败', text: '查看标红步骤原因；可重试的任务会显示重试入口。', tone: 'danger' };
  }
  return { label: '下一步', text: '点击"推进一次任务"继续。每次只执行一批，便于观察失败原因和额度消耗。', tone: 'info' };
}

export function groupTasksByChapter(tasks: Job[]): Array<[string, Job[]]> {
  const groups = new Map<string, Job[]>();
  for (const task of tasks) {
    const chapterNo = typeof task.payload.chapter_no === 'number' ? String(task.payload.chapter_no).padStart(3, '0') : '未知';
    groups.set(chapterNo, [...(groups.get(chapterNo) ?? []), task]);
  }
  return [...groups.entries()];
}

export function isPausedFailureSummary(failure: PipelineRun['summary']['failure_summaries'][number]): boolean {
  const reason = failure.reason.toLowerCase();
  return failure.status === 'paused' || reason === 'paused by user' || failure.reason.includes('用户暂停') || failure.reason.includes('手动暂停');
}

export function numberFromPayloadValue(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

export function modeFromPayloadValue(value: unknown): PipelineRunCreatePayload['mode'] {
  return value === 'review_only' || value === 'generate_missing' || value === 'review_fix' || value === 'full_auto' ? value : 'review_fix';
}

export function generationModeFromPayloadValue(value: unknown): PipelineRunCreatePayload['generation_mode'] {
  return value === 'quality' || value === 'fast' || value === 'stable' ? value : 'stable';
}
