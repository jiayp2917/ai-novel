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

  return (
    <footer className={expanded ? 'task-panel task-panel--expanded' : 'task-panel'}>
      <div className={`backend-pill backend-pill--${health.isSuccess ? 'success' : health.isError ? 'error' : 'idle'}`}>
        <span className="status-dot" />
        {health.isLoading && '后端检查中'}
        {health.isSuccess && `后端 ${health.data.status}`}
        {health.isError && `后端错误：${(health.error as Error).message}`}
      </div>
      <button type="button" className="task-toggle" onClick={() => setExpanded((value) => !value)}>
        {expanded ? '收起状态' : `状态 ${tasks.length}`}
      </button>
      {!expanded && latestTask && (
        <div className={`task-latest task-latest--${latestTask.status}`}>
          <strong>{latestTask.label}</strong>
          <span>{latestTask.detail}</span>
        </div>
      )}
      <div className="cost-dashboard">
        {cost.isSuccess ? (
          <>
            <span>调用 {cost.data.today_model_calls}</span>
            <span>成本 {cost.data.today_estimated_cost.toFixed(6)}</span>
            <span>输入 {cost.data.input_chars}</span>
            <span>输出 {cost.data.output_chars}</span>
            <span>缓存 {cost.data.cache_hits}</span>
            <span>真实usage {cost.data.provider_usage_count}</span>
            <span>运行 {cost.data.running_jobs}</span>
          </>
        ) : (
          <span>成本面板待加载</span>
        )}
        {jobs.isSuccess && <span>任务 {jobs.data.length}</span>}
      </div>
      {expanded && (
        <div className="task-strip">
          {tasks.map((task) => (
            <div className={`task-entry task-entry--${task.status}`} key={task.id}>
              <strong>{task.label}</strong>
              <span>{task.detail}</span>
            </div>
          ))}
        </div>
      )}
    </footer>
  );
}
