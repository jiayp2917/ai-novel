import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, queryClient } from '../api';
import {
  useChapters,
  useCostDashboard,
  useEvents,
  useModelCalls,
  useModelConstraints,
  useModelRoutes,
  usePublishDecisions,
  useSkills,
  useSources,
} from '../hooks';
import { useWorkbenchStore } from '../store';
import type { ProbeModelPayload } from '../types';
import { JobList } from './WorkflowActions';

const probeRoles = ['writer', 'reviewer', 'fixer', 'quick_fix', 'outliner', 'structural_fix', 'memory', 'long_context', 'arbiter'];

export function ModelsView() {
  const routes = useModelRoutes();
  const cost = useCostDashboard();
  const constraints = useModelConstraints();
  const modelCalls = useModelCalls();
  const events = useEvents();
  const publishDecisions = usePublishDecisions();
  const chapters = useChapters();
  const sources = useSources();
  const skills = useSkills();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const [probeResult, setProbeResult] = useState<ProbeModelPayload | null>(null);
  const [probeConfirmed, setProbeConfirmed] = useState(false);

  const probeMutation = useMutation({
    mutationFn: (role: string) =>
      apiRequest<ProbeModelPayload>('/api/admin/probe-model', {
        method: 'POST',
        body: JSON.stringify({ role }),
      }),
    onMutate: (role) => pushTask({ label: '模型探测', status: 'running', detail: `正在探测 ${role}` }),
    onSuccess: (result) => {
      setProbeResult(result);
      pushTask({ label: '模型探测', status: 'succeeded', detail: `${result.role} -> ${result.provider}/${result.model}` });
    },
    onError: (error: Error) => pushTask({ label: '模型探测', status: 'failed', detail: error.message }),
  });

  const runJobsMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ started: number; succeeded: number; failed: number; jobs: Array<{ id: number; status: string }> }>(
        '/api/jobs/run-once',
        { method: 'POST' },
      ),
    onMutate: () => pushTask({ label: '运行任务队列', status: 'running', detail: '正在执行已排队任务。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      pushTask({
        label: '运行任务队列',
        status: result.failed ? 'failed' : 'succeeded',
        detail: `启动 ${result.started}，成功 ${result.succeeded}，失败 ${result.failed}。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '运行任务队列', status: 'failed', detail: error.message }),
  });

  return (
    <main className="content-view">
      <div className="view-header">
        <div>
          <p className="eyebrow">模型 / 任务</p>
          <h1>模型路由、连通性与成本</h1>
        </div>
      </div>

      <section className="workflow-card workflow-card--compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">调用边界</p>
            <h2>模型调用独立于正文编写界面</h2>
          </div>
        </div>
        <div className="model-flow-grid">
          <div><strong>输入</strong><span>当前章节、相关记忆、批注或设定/章纲片段。</span></div>
          <div><strong>预算</strong><span>调用前控制上下文长度，探测需要手动确认。</span></div>
          <div><strong>输出</strong><span>正文进入候选池，设定和章纲进入提案池。</span></div>
          <div><strong>记录</strong><span>保留模型、耗时、输入输出字符、usage 与错误。</span></div>
        </div>
      </section>

      <ModelTaskComposer chapterCount={chapters.data?.length ?? 0} sourceCount={sources.data?.length ?? 0} onNavigate={setActiveView} />

      <div className="dashboard-grid">
        <section className="metric-card"><span>今日调用</span><strong>{cost.data?.today_model_calls ?? 0}</strong></section>
        <section className="metric-card"><span>输入字符</span><strong>{cost.data?.input_chars ?? 0}</strong></section>
        <section className="metric-card"><span>输出字符</span><strong>{cost.data?.output_chars ?? 0}</strong></section>
        <section className="metric-card"><span>缓存命中</span><strong>{cost.data?.cache_hits ?? 0}</strong></section>
      </div>

      <section className="workflow-card workflow-card--compact">
        <div className="section-title">
          <div>
            <p className="eyebrow">约束配置</p>
            <h2>当前调用边界</h2>
          </div>
        </div>
        <div className="model-flow-grid">
          <div>
            <strong>输入上限</strong>
            <span>{constraints.data?.max_input_chars_per_call ?? '-'} 字符</span>
          </div>
          <div>
            <strong>输出上限</strong>
            <span>{constraints.data?.max_output_tokens_per_call ?? '-'} token</span>
          </div>
          <div>
            <strong>并发</strong>
            <span>
              {constraints.data?.enable_model_concurrency ? '已启用' : '串行'}，writer {constraints.data?.writer_max_concurrency ?? '-'} / reviewer{' '}
              {constraints.data?.reviewer_max_concurrency ?? '-'} / memory {constraints.data?.memory_max_concurrency ?? '-'}
            </span>
          </div>
          <div>
            <strong>日预算</strong>
            <span>
              {constraints.data?.daily_max_model_calls ?? '-'} 次 / {constraints.data?.daily_max_estimated_cost ?? '-'} 估算单位
            </span>
          </div>
          <div>
            <strong>思考模式</strong>
            <span>Kimi {constraints.data?.kimi_thinking_mode ?? '-'} / GLM {constraints.data?.glm_thinking_mode ?? '-'}</span>
          </div>
          <div>
            <strong>usage 来源</strong>
            <span>供应商 {cost.data?.provider_usage_count ?? 0} / 缓存 {cost.data?.cache_usage_count ?? 0}</span>
          </div>
        </div>
        <p className="form-hint">{constraints.data?.usage_note ?? 'usage 统计加载中。'}</p>
      </section>

      <div className="split-grid">
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">路由矩阵</p>
              <h2>当前岗位模型</h2>
            </div>
          </div>
          <div className="token-warning-box">
            <strong>真实调用提醒</strong>
            <p>探测会向供应商发送短请求，可能消耗 token。日志中的 token 只是可见下限，最终以供应商控制台为准。</p>
            <label className="token-confirm">
              <input type="checkbox" checked={probeConfirmed} onChange={(event) => setProbeConfirmed(event.target.checked)} />
              我确认本页“探测”会调用真实模型
            </label>
          </div>
          <div className="route-list">
            {Object.entries(routes.data?.routes ?? {}).map(([role, route]) => (
              <article className="route-card" key={role}>
                <div>
                  <strong>{role}</strong>
                  <span>{route.error ?? `${route.provider} / ${route.model}`}</span>
                </div>
                <small>{route.base_url}</small>
                <button className="secondary-button" type="button" onClick={() => probeMutation.mutate(role)} disabled={!probeConfirmed || probeMutation.isPending || Boolean(route.error)}>
                  探测
                </button>
              </article>
            ))}
            {routes.isLoading && <p className="muted">正在加载模型路由...</p>}
          </div>
          <div className="action-row">
            {probeRoles.map((role) => (
              <button className="secondary-button" type="button" key={role} onClick={() => probeMutation.mutate(role)} disabled={!probeConfirmed || probeMutation.isPending}>
                探测 {role}
              </button>
            ))}
          </div>
          {probeResult && <pre className="json-preview">{JSON.stringify(probeResult, null, 2)}</pre>}
        </section>

        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">任务队列</p>
              <h2>模型输出去向</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => runJobsMutation.mutate()} disabled={runJobsMutation.isPending}>
              运行任务队列
            </button>
          </div>
          <div className="model-output-map">
            <span>正文改写：候选池、审核中心、发布门。</span>
            <span>设定/章纲：提案池、人工采纳。</span>
            <span>记忆扫描：短记忆库、上下文预览。</span>
          </div>
          <JobList compact />
        </section>
      </div>

      <section className="workflow-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">Skills</p>
            <h2>按岗位加载的规则片段</h2>
          </div>
        </div>
        <div className="skill-grid">
          {skills.data?.skills.map((skill) => (
            <article className="skill-card" key={skill.path}>
              <strong>{skill.name} v{skill.version}</strong>
              <span>{skill.role} · {skill.scope || '通用'}</span>
              <small>{skill.path}</small>
              <code>{skill.sha256.slice(0, 12)}</code>
            </article>
          ))}
          {skills.isLoading && <p className="muted">正在加载 skills...</p>}
          {!skills.isLoading && !skills.data?.skills.length && <p className="muted">尚未配置 skills。</p>}
        </div>
      </section>

      <section className="workflow-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">模型调用明细</p>
            <h2>最近模型调用与失败原因</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => modelCalls.refetch()}>
            刷新
          </button>
        </div>
        <div className="observability-table" role="table" aria-label="最近模型调用">
          <div className="observability-row observability-row--head" role="row">
            <span>调用</span>
            <span>岗位</span>
            <span>模型</span>
            <span>状态</span>
            <span>输入/输出</span>
            <span>usage</span>
            <span>错误</span>
          </div>
          {modelCalls.data?.map((call) => (
            <div className={`observability-row status-${call.status}`} role="row" key={call.id}>
              <span>#{call.id}</span>
              <span>{call.role}</span>
              <span>{call.provider}/{call.model}</span>
              <span>{statusLabel(call.status)}{call.cache_hit ? ' / 缓存' : ''}</span>
              <span>{call.input_chars} / {call.output_chars}</span>
              <span>{usageSummary(call.usage)}</span>
              <span>{call.error || '无'}</span>
            </div>
          ))}
          {modelCalls.isLoading && <p className="muted">正在加载模型调用记录...</p>}
          {!modelCalls.isLoading && !modelCalls.data?.length && <p className="muted">暂无模型调用记录。</p>}
        </div>
      </section>

      <div className="split-grid">
        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">发布决策</p>
              <h2>备份与 diff 追踪</h2>
            </div>
          </div>
          <div className="observability-list">
            {publishDecisions.data?.map((decision) => (
              <article className="observability-card" key={decision.id}>
                <div>
                  <strong>发布 #{decision.id}</strong>
                  <span>artifact #{decision.artifact_id} · {decision.published_at ? '已写回' : '未写回'}</span>
                </div>
                <small>diff: {decision.diff_path}</small>
                <small>backup: {decision.backup_path}</small>
                {decision.force && <small>强制发布：{decision.force_reason || '未填写原因'}</small>}
              </article>
            ))}
            {publishDecisions.isLoading && <p className="muted">正在加载发布决策...</p>}
            {!publishDecisions.isLoading && !publishDecisions.data?.length && <p className="muted">暂无发布决策。</p>}
          </div>
        </section>

        <section className="workflow-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">运行事件</p>
              <h2>状态推进与回滚记录</h2>
            </div>
          </div>
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
        </section>
      </div>
    </main>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    reserved: '已预留',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    paused_budget: '预算暂停',
  };
  return labels[status] ?? status;
}

function usageSummary(usage: Record<string, unknown>): string {
  const source = typeof usage.usage_source === 'string' ? usage.usage_source : '未知';
  const total = usage.total_tokens ?? usage.total ?? usage.tokens;
  return total === undefined ? source : `${source} / ${String(total)}`;
}

function ModelTaskComposer({
  chapterCount,
  sourceCount,
  onNavigate,
}: {
  chapterCount: number;
  sourceCount: number;
  onNavigate: (view: 'writing' | 'planning' | 'review' | 'pipeline') => void;
}) {
  return (
    <section className="workflow-card model-task-composer">
      <div className="section-title">
        <div>
          <p className="eyebrow">任务入口</p>
          <h2>按创作目标选择模型工作流</h2>
        </div>
      </div>
      <div className="model-task-grid">
        <button type="button" onClick={() => onNavigate('writing')}>
          <strong>正文候选</strong>
          <span>打开章节后编辑草稿、右键批注、保存候选。</span>
          <em>{chapterCount} 章可用</em>
        </button>
        <button type="button" onClick={() => onNavigate('planning')}>
          <strong>设定/章纲提案</strong>
          <span>只生成 proposal，不直接覆盖源文件。</span>
          <em>{sourceCount} 个源文件</em>
        </button>
        <button type="button" onClick={() => onNavigate('review')}>
          <strong>候选审核</strong>
          <span>审核角色只输出证据约束 JSON。</span>
          <em>进入审核中心</em>
        </button>
        <button type="button" onClick={() => onNavigate('pipeline')}>
          <strong>自动流水线</strong>
          <span>按章节范围创建可追踪任务。</span>
          <em>查看规划</em>
        </button>
      </div>
    </section>
  );
}
