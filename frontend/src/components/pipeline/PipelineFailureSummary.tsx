import type { PipelineRun } from '../../types';
import { isPausedFailureSummary } from './pipelineUtils';

export function PipelineFailureSummary({ run }: { run: PipelineRun }) {
  const failures = run.summary?.failure_summaries ?? [];
  if (!failures.length) {
    return null;
  }
  const pausedFailures = failures.filter(isPausedFailureSummary);
  const visibleFailures = failures.filter((failure) => !isPausedFailureSummary(failure));
  return (
    <section className="pipeline-failure-summary" aria-label="失败章节摘要">
      <strong>失败和人工处理摘要</strong>
      {pausedFailures.length > 0 && (
        <div className="pipeline-failure-rollup">
          <b>{pausedFailures.length} 个步骤已暂停</b>
          <span>恢复流水线后可继续推进；暂停明细已折叠，避免挤占任务详情。</span>
          <details className="advanced-details pipeline-failure-details">
            <summary>查看暂停步骤明细</summary>
            {pausedFailures.map((failure) => (
              <small key={failure.job_id}>
                第 {failure.chapter_no ? String(failure.chapter_no).padStart(3, '0') : '未知'} 章 · {failure.task_label} · {failure.status_label}
              </small>
            ))}
          </details>
        </div>
      )}
      {visibleFailures.map((failure) => (
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
