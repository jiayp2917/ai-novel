import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, queryClient } from '../api';
import {
  useCostDashboard,
  useEvents,
  useModelCalls,
  useModelConstraints,
  useModelRoutes,
  useModelUsageReport,
  usePublishDecisions,
  useSkills,
} from '../hooks';
import { useWorkbenchStore } from '../store';
import type { ProbeModelPayload } from '../types';
import { ContextBudgetSection, QualityTrendSection, RoleUsageSection } from './ModelQualitySections';
import { assistantRoles, roleLabel, statusLabel, taskTypeLabel, usageSummary } from './modelViewUtils';
import { JobList } from './WorkflowActions';

export function ModelsView() {
  const routes = useModelRoutes();
  const cost = useCostDashboard();
  const constraints = useModelConstraints();
  const modelCalls = useModelCalls();
  const usageReport = useModelUsageReport();
  const events = useEvents();
  const publishDecisions = usePublishDecisions();
  const skills = useSkills();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const [probeResult, setProbeResult] = useState<ProbeModelPayload | null>(null);
  const [probeConfirmed, setProbeConfirmed] = useState(false);

  const probeMutation = useMutation({
    mutationFn: (role: string) =>
      apiRequest<ProbeModelPayload>('/api/admin/probe-model', {
        method: 'POST',
        body: JSON.stringify({ role }),
      }),
    onMutate: (role) => pushTask({ label: 'AI 连通测试', status: 'running', detail: `正在测试 ${role}` }),
    onSuccess: (result) => {
      setProbeResult(result);
      pushTask({ label: 'AI 连通测试', status: 'succeeded', detail: `${roleLabel(result.role)} 可用：${result.provider}/${result.model}` });
    },
    onError: (error: Error) => pushTask({ label: 'AI 连通测试', status: 'failed', detail: error.message }),
  });

  const runJobsMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ started: number; succeeded: number; failed: number; jobs: Array<{ id: number; status: string }> }>(
        '/api/jobs/run-once',
        { method: 'POST' },
      ),
    onMutate: () => pushTask({ label: '继续执行任务', status: 'running', detail: '正在处理待办任务。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['model-calls'] });
      void queryClient.invalidateQueries({ queryKey: ['model-usage-report'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      pushTask({
        label: '继续执行任务',
        status: result.failed ? 'failed' : 'succeeded',
        detail: `启动 ${result.started} 个任务，完成 ${result.succeeded} 个，失败 ${result.failed} 个。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '继续执行任务', status: 'failed', detail: error.message }),
  });

  const pausedCount = modelCalls.data?.filter((call) => call.status === 'paused_budget').length ?? 0;

  return (
    <main className="content-view">
      <div className="view-header">
        <div>
          <p className="eyebrow">AI 助手 / 任务</p>
          <h1>AI 分工、待办任务与调用记录</h1>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="metric-card"><span>今日调用</span><strong>{cost.data?.today_model_calls ?? 0}</strong></section>
        <section className="metric-card"><span>输入字符</span><strong>{cost.data?.input_chars ?? 0}</strong></section>
        <section className="metric-card"><span>输出字符</span><strong>{cost.data?.output_chars ?? 0}</strong></section>
        <section className="metric-card"><span>缓存命中</span><strong>{cost.data?.cache_hits ?? 0}</strong></section>
      </div>

      {pausedCount > 0 && (
        <section className="notice danger">
          今日调用额度已暂停。请查看下方失败原因，确认预算后再点击“继续执行任务”。
        </section>
      )}

      <section className="workflow-card workflow-card--compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">AI 输出去向</p>
            <h2>写作、检查、修订和记忆整理分开处理</h2>
          </div>
        </div>
        <div className="model-flow-grid">
          <div><strong>AI 写作</strong><span>只生成草稿，不能直接写回正文。</span></div>
          <div><strong>AI 检查</strong><span>只判断草稿是否有问题，不负责改写。</span></div>
          <div><strong>AI 修订</strong><span>只根据批注或检查结果生成新草稿。</span></div>
          <div><strong>记忆整理</strong><span>整理短记忆和上下文，不创作正文。</span></div>
        </div>
      </section>

      <QualityTrendSection report={usageReport.data} isLoading={usageReport.isLoading} />
      <RoleUsageSection report={usageReport.data} isLoading={usageReport.isLoading} />
      <ContextBudgetSection report={usageReport.data} isLoading={usageReport.isLoading} />

      <div className="split-grid">
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">AI 分工</p>
              <h2>当前可用助手</h2>
            </div>
          </div>
          <div className="token-warning-box">
            <strong>真实调用提醒</strong>
            <p>连通测试会向供应商发送短请求，可能产生少量调用费用。本地记录只是可见下限，真实消耗以供应商控制台为准。</p>
            <label className="token-confirm">
              <input type="checkbox" checked={probeConfirmed} onChange={(event) => setProbeConfirmed(event.target.checked)} />
              我确认“连通测试”会调用真实 AI
            </label>
          </div>
          <div className="route-list">
            {assistantRoles.map(({ role, label }) => {
              const route = routes.data?.routes?.[role];
              return (
                <article className="route-card" key={role}>
                  <div>
                    <strong>{label}</strong>
                    <span>{route?.error ?? '已配置，可测试连通'}</span>
                  </div>
                  <details className="advanced-details">
                    <summary>查看模型配置</summary>
                    <small>{route?.provider ?? '未识别'} / {route?.model ?? '未识别'}</small>
                    <small>{route?.base_url ?? '暂无地址'}</small>
                  </details>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => probeMutation.mutate(role)}
                    disabled={!probeConfirmed || probeMutation.isPending || Boolean(route?.error)}
                  >
                    连通测试
                  </button>
                </article>
              );
            })}
            {routes.isLoading && <p className="muted">正在加载 AI 分工...</p>}
          </div>
          {probeResult && (
            <details className="advanced-details" open>
              <summary>查看本次测试详情</summary>
              <pre className="json-preview">{JSON.stringify(probeResult, null, 2)}</pre>
            </details>
          )}
        </section>

        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">待办任务</p>
              <h2>继续执行或查看暂停原因</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => runJobsMutation.mutate()} disabled={runJobsMutation.isPending}>
              继续执行任务
            </button>
          </div>
          <JobList compact />
        </section>
      </div>

      <section className="workflow-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">高级观测</p>
            <h2>最近 AI 调用</h2>
            <p className="form-hint">本地记录仅供排错，真实消耗以供应商控制台为准。</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => modelCalls.refetch()}>
            刷新
          </button>
        </div>
        <div className="observability-table" role="table" aria-label="最近 AI 调用">
          <div className="observability-row observability-row--head" role="row">
            <span>调用</span>
            <span>分工</span>
            <span>AI</span>
            <span>状态</span>
            <span>输入/输出</span>
              <span>本地用量</span>
            <span>错误</span>
          </div>
          {modelCalls.data?.map((call) => (
            <div className={`observability-row status-${call.status}`} role="row" key={call.id}>
              <span>#{call.id}</span>
              <span>{roleLabel(call.role)}</span>
              <span>{call.provider}/{call.model}</span>
              <span>{statusLabel(call.status)}{call.cache_hit ? ' / 缓存' : ''}</span>
              <span>{call.input_chars} / {call.output_chars}</span>
              <span>{usageSummary(call.usage)}</span>
              <span>{call.error || '无'}</span>
            </div>
          ))}
          {modelCalls.isLoading && <p className="muted">正在加载 AI 调用记录...</p>}
          {!modelCalls.isLoading && !modelCalls.data?.length && <p className="muted">暂无 AI 调用记录。</p>}
        </div>
      </section>

      <div className="split-grid">
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">写回记录</p>
              <h2>备份与改动追踪</h2>
            </div>
          </div>
          <div className="observability-list">
            {publishDecisions.data?.map((decision) => (
              <article className="observability-card" key={decision.id}>
                <div>
                  <strong>写回 #{decision.id}</strong>
                  <span>草稿 #{decision.artifact_id} · {decision.published_at ? '已写回' : '未写回'}</span>
                </div>
                <small>改动：{decision.diff_path}</small>
                <small>备份：{decision.backup_path}</small>
                {decision.force && <small>强制写回：{decision.force_reason || '未填写原因'}</small>}
              </article>
            ))}
            {publishDecisions.isLoading && <p className="muted">正在加载写回记录...</p>}
            {!publishDecisions.isLoading && !publishDecisions.data?.length && <p className="muted">暂无写回记录。</p>}
          </div>
        </section>

        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">高级详情</p>
              <h2>规则片段与运行事件</h2>
            </div>
          </div>
          <details className="advanced-details">
            <summary>查看 Skills</summary>
            <div className="skill-grid">
              {skills.data?.skills.map((skill) => (
                <article className="skill-card" key={skill.path}>
                  <strong>{skill.name} v{skill.version}</strong>
                  <span>{skill.role} · {skill.scope || '通用'}</span>
                  <span>{skill.included_in_latest_context ? '参与最近一次记录的上下文' : '最近一次记录的上下文未使用'}</span>
                  <small>最近使用：{skill.last_used_at ? new Date(skill.last_used_at).toLocaleString() : '暂无记录'}</small>
                  <small>最近任务：{skill.last_used_task_type ? taskTypeLabel(skill.last_used_task_type) : '暂无记录'}</small>
                  <small>{skill.path}</small>
                  <code>{skill.sha256.slice(0, 12)}</code>
                </article>
              ))}
              {skills.isLoading && <p className="muted">正在加载 skills...</p>}
              {!skills.isLoading && !skills.data?.skills.length && <p className="muted">尚未配置 skills。</p>}
            </div>
          </details>
          <details className="advanced-details">
            <summary>查看运行事件</summary>
            <div className="observability-list">
              {events.data?.map((event) => (
                <article className="observability-card" key={event.id}>
                  <div>
                    <strong>{event.event_type}</strong>
                    <span>{event.entity_type} #{event.entity_id}</span>
                  </div>
                  <small>{event.created_at ? new Date(event.created_at).toLocaleString() : ''}</small>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </article>
              ))}
              {events.isLoading && <p className="muted">正在加载运行事件...</p>}
              {!events.isLoading && !events.data?.length && <p className="muted">暂无运行事件。</p>}
            </div>
          </details>
          <details className="advanced-details">
            <summary>查看调用边界</summary>
            <div className="model-flow-grid">
              <div><strong>输入上限</strong><span>{constraints.data?.max_input_chars_per_call ?? '-'} 字符</span></div>
              <div><strong>输出上限</strong><span>{constraints.data?.max_output_tokens_per_call ?? '-'} token</span></div>
              <div><strong>并发</strong><span>{constraints.data?.enable_model_concurrency ? '已启用' : '串行'}</span></div>
              <div><strong>日预算</strong><span>{constraints.data?.daily_max_model_calls ?? '-'} 次</span></div>
            </div>
            <p className="form-hint">{constraints.data?.usage_note ?? '用量统计加载中。'}</p>
          </details>
        </section>
      </div>
    </main>
  );
}
