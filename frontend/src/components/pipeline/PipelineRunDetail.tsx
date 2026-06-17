import type { PipelineRun, PipelineRunCreatePayload } from '../../types';
import { Button } from '../ui/Button';
import { Surface } from '../ui/Surface';
import { generationModeLabels, jobTypeLabel, modeLabels, runOperationHelp, statusLabels } from '../../lib/pipelineLabels';
import {
  canCancel,
  canPause,
  canResume,
  canRetry,
  disabledReason,
  generationModeFromPayload,
  groupTasksByChapter,
  nextStepForRun,
  statusText,
  summarizeRun,
  type MutateAction,
} from './pipelineUtils';
import { PipelineFailureSummary } from './PipelineFailureSummary';

export interface PipelineRunDetailProps {
  run: PipelineRun | null;
  mutating: boolean;
  deleting: boolean;
  onMutate: (action: MutateAction) => void;
  onReuse: () => void;
  onDelete: () => void;
}

export function PipelineRunDetail({ run, mutating, deleting, onMutate, onReuse, onDelete }: PipelineRunDetailProps) {
  return (
    <Surface as="section" variant="paper" className="workflow-card pipeline-run-detail__surface">
      <div className="section-title">
        <div>
          <p className="eyebrow">任务详情</p>
          <h2>{run ? `流水线 #${run.id}` : '请选择一个任务'}</h2>
        </div>
        {run && (
          <div className="action-row">
            <Button
              variant="secondary"
              title={runOperationHelp.pause}
              onClick={() => onMutate('pause')}
              disabled={mutating || !canPause(run)}
              aria-disabled-reason={!canPause(run) ? disabledReason('pause', run) : undefined}
            >
              暂停
            </Button>
            <Button
              variant="secondary"
              title={runOperationHelp.resume}
              onClick={() => onMutate('resume')}
              disabled={mutating || !canResume(run)}
              aria-disabled-reason={!canResume(run) ? disabledReason('resume', run) : undefined}
            >
              恢复
            </Button>
            <Button
              variant="secondary"
              title={runOperationHelp.retry}
              onClick={() => onMutate('retry')}
              disabled={mutating || !canRetry(run)}
              aria-disabled-reason={!canRetry(run) ? disabledReason('retry', run) : undefined}
            >
              重试
            </Button>
            <Button variant="secondary" onClick={onReuse} disabled={mutating}>
              复用设置
            </Button>
            <Button
              variant="danger"
              title={runOperationHelp.cancel}
              onClick={() => onMutate('cancel')}
              disabled={mutating || !canCancel(run)}
              aria-disabled-reason={!canCancel(run) ? disabledReason('cancel', run) : undefined}
            >
              停止
            </Button>
            <Button
              variant="danger"
              className="danger-button--quiet"
              title={runOperationHelp.delete}
              onClick={onDelete}
              disabled={deleting}
            >
              删除记录
            </Button>
          </div>
        )}
      </div>
      {run ? <RunDetailBody run={run} /> : <p className="muted">创建或选择任务后，这里会显示每章进度、失败原因和报告详情。</p>}
    </Surface>
  );
}

function RunDetailBody({ run }: { run: PipelineRun }) {
  const summary = summarizeRun(run);
  const nextStep = nextStepForRun(run, summary);
  return (
    <>
      <div className="pipeline-progress">
        <strong>{summary.done}/{summary.total}</strong>
        <span>步骤完成</span>
        <progress value={summary.done} max={Math.max(1, summary.total)} />
      </div>
      <div className="pipeline-status-grid">
        <span>状态：{statusText(run.status)}</span>
        <span>需人工判断：{summary.manual}</span>
        <span>失败/暂停：{summary.failed}</span>
      </div>
      <div className={`pipeline-next-step pipeline-next-step--${nextStep.tone}`}>
        <strong>{nextStep.label}</strong>
        <span>{nextStep.text}</span>
        {run.error && <small>任务提示：{run.error}</small>}
      </div>
      <PipelineFailureSummary run={run} />
      {run.report_summary.path && (
        <div className="pipeline-report-chip">
          <span className="chip blue">运行报告</span>
          <span className="muted">{run.report_summary.path}</span>
        </div>
      )}
      <div className="pipeline-chapter-timeline">
        {groupTasksByChapter(run.child_tasks).map(([chapterNo, tasks]) => (
          <article className="pipeline-chapter-card" key={chapterNo}>
            <strong>第 {chapterNo} 章</strong>
            <div>
              {tasks.map((task) => (
                <span className={`pipeline-task-pill status-${task.status}`} key={task.id}>
                  {jobTypeLabel(task.type)}：{statusLabels[task.status] ?? task.status}
                </span>
              ))}
            </div>
            {tasks.some((t) => t.error) && (
              <details className="advanced-details">
                <summary>查看错误详情</summary>
                {tasks.filter((t) => t.error).map((t) => (
                  <small key={t.id}>{jobTypeLabel(t.type)}：{t.error}</small>
                ))}
              </details>
            )}
          </article>
        ))}
      </div>
      <details className="advanced-details">
        <summary>高级详情</summary>
        <div className="pipeline-advanced-grid">
          <span>任务编号：#{run.id}</span>
          <span>写回策略：{run.payload.dry_run ? '只生成草稿，不写回正文' : '允许写回正文'}</span>
          <span>模式：{modeLabels[run.payload.mode as PipelineRunCreatePayload['mode']] ?? String(run.payload.mode ?? '未知')}</span>
          <span>生成模式：{generationModeLabels[generationModeFromPayload(run)]}</span>
          <span>章节：第 {String(run.payload.start_chapter)}-{String(run.payload.end_chapter)} 章</span>
          <span>报告：{run.report_summary.path ?? '暂无'}</span>
        </div>
      </details>
    </>
  );
}
