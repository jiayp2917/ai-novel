import { useJobs } from '../../hooks';
import type { Job } from '../../types';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { jobNextStep, jobStatusLabel, jobTone, jobTypeLabel } from '../../lib/pipelineLabels';
import { safeJobStatuses, failedJobStatuses } from './jobLabelMap';

export function JobList({ compact = false }: { compact?: boolean }) {
  const jobs = useJobs();
  const allJobs = jobs.data ?? [];
  const visibleJobs = compact ? allJobs.slice(0, 8) : allJobs;

  if (compact) {
    const succeeded = allJobs.filter((j) => safeJobStatuses.includes(j.status as typeof safeJobStatuses[number])).length;
    const failed = allJobs.filter((j) => failedJobStatuses.includes(j.status as typeof failedJobStatuses[number])).length;
    const running = allJobs.filter((j) => j.status === 'running').length;
    return (
      <section className="workflow-card workflow-card--compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">任务队列</p>
            <h2>最近任务</h2>
          </div>
          <span className="count-badge">{allJobs.length}</span>
        </div>
        {allJobs.length > 0 ? (
          <p className="muted">共 {allJobs.length} 个任务：{succeeded} 个成功，{failed} 个失败{running > 0 ? `，${running} 个执行中` : ''}。</p>
        ) : jobs.isLoading ? (
          <p className="muted"><LoadingSpinner size="sm" /> 正在加载任务...</p>
        ) : (
          <p className="muted">暂无任务。</p>
        )}
        <div className="job-list job-list--compact">
          {visibleJobs.map((job) => <JobTimelineCard job={job} key={job.id} />)}
        </div>
        {allJobs.length > visibleJobs.length && (
          <p className="muted">仅显示最近 {visibleJobs.length} 条任务，完整队列请到模型页查看。</p>
        )}
      </section>
    );
  }

  return (
    <section className="workflow-card">
      <div className="section-title">
        <div>
          <p className="eyebrow">任务队列</p>
          <h2>最近任务</h2>
        </div>
        <span className="count-badge">{allJobs.length}</span>
      </div>
      <div className="job-list">
        {jobs.isLoading && <p className="muted"><LoadingSpinner size="sm" /> 正在加载任务...</p>}
        {visibleJobs.map((job) => <JobTimelineCard job={job} key={job.id} />)}
        {!jobs.isLoading && allJobs.length === 0 && <p className="muted">暂无任务。</p>}
      </div>
    </section>
  );
}

function JobTimelineCard({ job }: { job: Job }) {
  const failure = job.error ? summarizeJobError(job.error) : null;
  return (
    <article className={`job-card job-card--${job.status}`}>
      <div className="job-card__head">
        <div>
          <strong>#{job.id} {jobTypeLabel(job.type)}</strong>
          <span>{job.locked_chapter_id ? `章节 #${job.locked_chapter_id}` : job.locked_source_file_id ? `素材 #${job.locked_source_file_id}` : '全局任务'}</span>
        </div>
        <span className={`chip ${jobTone(job.status)}`}>{jobStatusLabel(job.status)}</span>
      </div>
      <div className="job-card__timeline">
        <span><strong>当前状态</strong>{jobStatusLabel(job.status)}</span>
        <span><strong>下一步</strong>{jobNextStep(job.status)}</span>
        <span><strong>失败原因</strong>{failure ?? '暂无'}</span>
      </div>
      {job.status === 'paused_budget' && <p className="form-hint form-hint--error">AI 调用已暂停。检查预算或密钥后，可在模型页点击“继续执行任务”。</p>}
      <details className="advanced-details">
        <summary>高级详情</summary>
        {job.error && <p>{job.error}</p>}
        {job.result && <pre>{JSON.stringify(job.result, null, 2)}</pre>}
      </details>
    </article>
  );
}

function summarizeJobError(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes('api key') || normalized.includes('api_key')) {
    return '缺少或无法读取密钥配置';
  }
  if (normalized.includes('timeout')) {
    return 'AI 请求超时';
  }
  if (normalized.includes('budget')) {
    return '预算限制暂停';
  }
  if (normalized.includes('json')) {
    return 'AI 返回格式异常';
  }
  return error.length > 80 ? `${error.slice(0, 80)}...` : error;
}