import { useEvents, useJobs, useModelConstraints, useSkills } from '../../hooks';
import type { EventRecord, SkillInfo } from '../../types';
import { taskTypeLabel } from '../modelViewUtils';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Surface } from '../ui/Surface';
import { JobList } from '../WorkflowActions';
import type { useModelCallActions } from '../../hooks/useModelCallActions';

type ModelCallActions = ReturnType<typeof useModelCallActions>;

type ModelsSkillsProps = {
  actions: ModelCallActions;
};

export function ModelsSkills({ actions }: ModelsSkillsProps) {
  const skills = useSkills();
  const events = useEvents();
  const constraints = useModelConstraints();
  const jobs = useJobs();
  const recentEvents = (events.data ?? []).slice(0, 8);
  const pausedCount = jobs.data?.filter((job) => job.status === 'paused_budget').length ?? 0;

  return (
    <Surface variant="paper" className="models-skills__surface">
      <section className="workflow-card models-section models-section--tasks">
        <div className="section-title">
          <div>
            <p className="eyebrow">任务队列</p>
            <h2>继续执行或查看暂停原因</h2>
          </div>
          <Button
            variant="secondary"
            onClick={() => actions.resetStats.mutate()}
            disabled={actions.resetStats.isPending}
            loading={actions.resetStats.isPending}
          >
            继续执行任务
          </Button>
        </div>
        {pausedCount > 0 && <section className="notice danger">AI 调用已暂停。请查看失败原因，确认预算后再继续执行任务。</section>}
        <JobList compact />
      </section>

      <section className="workflow-card models-section models-section--skills">
        <div className="section-title">
          <div>
            <p className="eyebrow">排错信息</p>
            <h2>高级日志 / Skills</h2>
          </div>
        </div>
        <details className="advanced-details">
          <summary>查看 Skills</summary>
          <div className="skill-grid">
            {skills.data?.skills.map((skill) => <SkillCard skill={skill} key={skill.path} />)}
            {skills.isLoading && <p className="muted"><LoadingSpinner size="sm" /> 正在加载 skills...</p>}
            {!skills.isLoading && !skills.data?.skills.length && <p className="muted">尚未配置 skills。</p>}
          </div>
        </details>
        <details className="advanced-details">
          <summary>查看运行事件</summary>
          <div className="observability-list">
            {recentEvents.map((event) => <EventCard event={event} key={event.id} />)}
            {events.isLoading && <p className="muted"><LoadingSpinner size="sm" /> 正在加载运行事件...</p>}
            {!events.isLoading && !events.data?.length && <p className="muted">暂无运行事件。</p>}
          </div>
        </details>
        <details className="advanced-details">
          <summary>查看调用边界</summary>
          <div className="model-flow-grid">
            <div><strong>输入上限</strong><span>{constraints.data?.max_input_chars_per_call ?? '-'} 字符</span></div>
            <div><strong>输出上限</strong><span>{constraints.data?.max_output_tokens_per_call ?? '-'} 本地单位</span></div>
            <div><strong>并发</strong><span>{constraints.data?.enable_model_concurrency ? '已启用' : '串行'}</span></div>
            <div><strong>日预算</strong><span>{constraints.data?.daily_max_model_calls ?? '-'} 次</span></div>
          </div>
          <p className="form-hint">{constraints.data?.usage_note ?? '用量统计加载中。'}</p>
        </details>
      </section>
    </Surface>
  );
}

function SkillCard({ skill }: { skill: SkillInfo }) {
  return (
    <article className="skill-card">
      <strong>{skill.name} v{skill.version}</strong>
      <span>{skill.role} · {skill.scope || '通用'}</span>
      <span>{skill.included_in_latest_context ? '参与最近一次记录的上下文' : '最近一次记录的上下文未使用'}</span>
      <small>最近使用：{skill.last_used_at ? new Date(skill.last_used_at).toLocaleString() : '暂无记录'}</small>
      <small>最近任务：{skill.last_used_task_type ? taskTypeLabel(skill.last_used_task_type) : '暂无记录'}</small>
      <details className="advanced-details">
        <summary>高级详情</summary>
        <small>{skill.path}</small>
        <code>{skill.sha256.slice(0, 12)}</code>
      </details>
    </article>
  );
}

function EventCard({ event }: { event: EventRecord }) {
  return (
    <article className="observability-card">
      <div>
        <strong>{event.event_type}</strong>
        <span>{event.entity_type} #{event.entity_id}</span>
      </div>
      <small>{event.created_at ? new Date(event.created_at).toLocaleString() : ''}</small>
      <details className="advanced-details">
        <summary>查看事件详情</summary>
        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      </details>
    </article>
  );
}
