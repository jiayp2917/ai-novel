import { useCostDashboard, useHealth, useJobs } from '../hooks';
import { useWorkbenchStore } from '../store';
import { useState } from 'react';

export function TaskPanel() {
  const [expanded, setExpanded] = useState(false);
  const tasks = useWorkbenchStore((state) => state.taskLog);
  const health = useHealth();
  const cost = useCostDashboard();
  const jobs = useJobs();
  const latestTask = tasks[0];
  const pausedBudgetJobs = (jobs.data ?? []).filter((job) => job.status === 'paused_budget');
  const costSummary = cost.isSuccess ? (
    <>
      <span>调用 {cost.data.today_model_calls}</span>
      <span>成本 {cost.data.today_estimated_cost.toFixed(6)}</span>
      <span>输入 {cost.data.input_chars}</span>
      <span>输出 {cost.data.output_chars}</span>
      <span>缓存 {cost.data.cache_hits}</span>
      <span>供应商用量记录 {cost.data.provider_usage_count}</span>
      <span>运行 {cost.data.running_jobs}</span>
    </>
  ) : (
    <span>成本面板待加载</span>
  );

  return (
    <footer className={expanded ? 'task-panel task-panel--expanded' : 'task-panel'}>
      <div className="task-panel__bar">
        <div className={`backend-pill backend-pill--${health.isSuccess ? 'success' : health.isError ? 'error' : 'idle'}`}>
          <span className="status-dot" />
          {health.isLoading && '后端检查中'}
          {health.isSuccess && `后端 ${health.data.status}`}
          {health.isError && `后端错误：${(health.error as Error).message}`}
        </div>
        <button type="button" className="task-toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起状态' : `状态 ${tasks.length}`}
        </button>
        {latestTask && (
          <div className={`task-latest task-latest--${latestTask.status}`}>
            <strong>{latestTask.label}</strong>
            <span>{latestTask.detail}</span>
          </div>
        )}
        <div className="cost-dashboard">
          {pausedBudgetJobs.length > 0 && <span className="budget-paused">今日调用额度已暂停 {pausedBudgetJobs.length}</span>}
          {costSummary}
          {jobs.isSuccess && <span>任务 {jobs.data.length}</span>}
        </div>
      </div>
      {expanded && (
        <div className="task-popover" role="dialog" aria-label="运行状态">
          <div className="task-popover__head">
            <div>
              <strong>运行状态</strong>
              <p className="muted">这里只显示最近反馈，不会改变正文布局。</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => setExpanded(false)}>
              关闭
            </button>
          </div>
          <div className="cost-dashboard cost-dashboard--popover">
            {pausedBudgetJobs.length > 0 && <span className="budget-paused">今日调用额度已暂停 {pausedBudgetJobs.length}</span>}
            {costSummary}
            {jobs.isSuccess && <span>任务 {jobs.data.length}</span>}
          </div>
          <div className="task-strip">
            {tasks.map((task) => (
              <div className={`task-entry task-entry--${task.status}`} key={task.id}>
                <strong>{task.label}</strong>
                <span>{task.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </footer>
  );
}
