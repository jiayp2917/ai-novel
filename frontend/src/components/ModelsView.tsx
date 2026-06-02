import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, queryClient } from '../api';
import {
  useCostDashboard,
  useEvents,
  useModelCalls,
  useModelConfig,
  useModelConstraints,
  useModelUsageReport,
  usePublishDecisions,
  useSkills,
} from '../hooks';
import { useWorkbenchStore } from '../store';
import type { EventRecord, ModelCallRecord, ModelConfigRole, ProbeModelPayload, PublishDecisionRecord, SkillInfo } from '../types';
import { ContextBudgetSection, QualityTrendSection } from './ModelQualitySections';
import { roleLabel, statusLabel, taskTypeLabel, usageSummary } from './modelViewUtils';
import { JobList } from './WorkflowActions';

export function ModelsView() {
  const modelConfig = useModelConfig();
  const cost = useCostDashboard();
  const constraints = useModelConstraints();
  const modelCalls = useModelCalls();
  const usageReport = useModelUsageReport();
  const events = useEvents();
  const publishDecisions = usePublishDecisions();
  const skills = useSkills();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const [probeResult, setProbeResult] = useState<ProbeModelPayload | null>(null);

  const probeMutation = useMutation({
    mutationFn: ({ role, temporaryKey }: { role: string; temporaryKey?: string }) =>
      apiRequest<ProbeModelPayload>(`/api/admin/model-config/${role}/probe`, {
        method: 'POST',
        body: JSON.stringify({ temporary_key: temporaryKey || undefined }),
      }),
    onMutate: ({ role }) => pushTask({ label: 'AI 连通测试', status: 'running', detail: `正在测试 ${roleLabel(role)}` }),
    onSuccess: (result) => {
      setProbeResult(result);
      pushTask({ label: 'AI 连通测试', status: 'succeeded', detail: `${roleLabel(result.role)} 可用。` });
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
  const lastCall = modelCalls.data?.[0];
  const recentEvents = (events.data ?? []).slice(0, 8);

  return (
    <main className="content-view models-view">
      <section className="workflow-card models-section models-section--overview">
        <div className="section-title">
          <div>
            <p className="eyebrow">运行概览</p>
            <h2>AI 助手当前是否可用</h2>
            <p className="form-hint">AI 输出去向与安全边界：写作、检查、修订和记忆整理各司其职，正文写回仍需要人工确认。</p>
          </div>
          <span className="chip safe">本地运行</span>
        </div>
        <div className="model-flow-grid">
          <div><strong>AI 写作</strong><span>只生成草稿，不能直接写回正文。</span></div>
          <div><strong>AI 检查</strong><span>只判断草稿是否有问题，不负责改写。</span></div>
          <div><strong>AI 修订</strong><span>只根据批注或检查结果生成新草稿。</span></div>
          <div><strong>记忆整理</strong><span>整理短记忆和上下文，不创作正文。</span></div>
        </div>
        <div className="models-summary-grid">
          <StatusCard label="今日任务" value={`${cost.data?.running_jobs ?? 0} 个运行中`} detail={`后台任务可在下方继续处理。`} />
          <StatusCard label="预算状态" value={pausedCount ? '已暂停' : '正常'} detail={pausedCount ? `${pausedCount} 条调用因预算暂停。` : '未发现预算暂停。'} tone={pausedCount ? 'danger' : 'ok'} />
          <StatusCard label="最近调用" value={lastCall ? statusLabel(lastCall.status) : '暂无'} detail={lastCall ? `${roleLabel(lastCall.role)} · ${formatDate(lastCall.created_at ?? null)}` : '运行 AI 后会出现记录。'} />
        </div>
      </section>

      <section className="workflow-card models-section models-section--connectivity">
        <div className="section-title">
          <div>
            <p className="eyebrow">AI 助手配置</p>
            <h2>按用途配置模型、接口和密钥</h2>
            <p className="form-hint">测试连接会发送一次很短的真实 AI 请求，可能产生少量费用。</p>
          </div>
        </div>
        {modelConfig.data && <p className="form-hint">密钥状态：{modelConfig.data.secret_store.label}。</p>}
        <div className="route-list route-list--config">
          {modelConfig.data?.roles.map((config) => (
            <ModelConfigCard
              config={config}
              key={config.role}
              onProbe={(role, temporaryKey) => probeMutation.mutate({ role, temporaryKey })}
              probePending={probeMutation.isPending}
              pushTask={pushTask}
            />
          ))}
          {modelConfig.isLoading && <p className="muted">正在加载 AI 助手配置...</p>}
        </div>
        {probeResult && (
          <details className="advanced-details" open>
            <summary>查看本次测试排错信息</summary>
            <pre className="json-preview">{JSON.stringify(probeResult, null, 2)}</pre>
          </details>
        )}
      </section>

      <div className="settings-metrics-grid">
        <QualityTrendSection report={usageReport.data} isLoading={usageReport.isLoading} />
        <ContextBudgetSection report={usageReport.data} isLoading={usageReport.isLoading} />
      </div>

      <section className="workflow-card models-section models-section--calls">
        <div className="section-title">
          <div>
            <p className="eyebrow">最近调用</p>
            <h2>AI 请求记录</h2>
            <p className="form-hint">默认展示时间、分工和结果；供应商、用量和原始细节只在排错信息里展开。</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => modelCalls.refetch()}>
            刷新
          </button>
        </div>
        <div className="observability-table observability-table--calls" role="table" aria-label="最近 AI 调用">
          <div className="observability-row observability-row--head" role="row">
            <span>时间</span>
            <span>分工</span>
            <span>状态</span>
            <span>错误摘要</span>
            <span>排错信息</span>
          </div>
          {modelCalls.data?.map((call) => <ModelCallRow call={call} key={call.id} />)}
          {modelCalls.isLoading && <p className="muted">正在加载 AI 调用记录...</p>}
          {!modelCalls.isLoading && !modelCalls.data?.length && <p className="muted">暂无 AI 调用记录。</p>}
        </div>
      </section>

      <div className="models-bottom-grid">
        <section className="workflow-card models-section models-section--tasks">
          <div className="section-title">
            <div>
              <p className="eyebrow">任务队列</p>
              <h2>继续执行或查看暂停原因</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => runJobsMutation.mutate()} disabled={runJobsMutation.isPending}>
              继续执行任务
            </button>
          </div>
          {pausedCount > 0 && <section className="notice danger">AI 调用已暂停。请查看失败原因，确认预算后再继续执行任务。</section>}
          <JobList compact />
        </section>

        <section className="workflow-card models-section models-section--skills">
          <div className="section-title">
            <div>
              <p className="eyebrow">高级日志 / Skills</p>
              <h2>规则片段与运行事件</h2>
            </div>
          </div>
          <details className="advanced-details">
            <summary>查看 Skills</summary>
            <div className="skill-grid">
              {skills.data?.skills.map((skill) => <SkillCard skill={skill} key={skill.path} />)}
              {skills.isLoading && <p className="muted">正在加载 skills...</p>}
              {!skills.isLoading && !skills.data?.skills.length && <p className="muted">尚未配置 skills。</p>}
            </div>
          </details>
          <details className="advanced-details">
            <summary>查看运行事件</summary>
            <div className="observability-list">
              {recentEvents.map((event) => <EventCard event={event} key={event.id} />)}
              {events.isLoading && <p className="muted">正在加载运行事件...</p>}
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
      </div>

      <section className="workflow-card models-section models-section--publish">
        <div className="section-title">
          <div>
            <p className="eyebrow">写回记录</p>
            <h2>备份与改动追踪</h2>
          </div>
        </div>
        <div className="observability-list">
          {publishDecisions.data?.map((decision) => <PublishCard decision={decision} key={decision.id} />)}
          {publishDecisions.isLoading && <p className="muted">正在加载写回记录...</p>}
          {!publishDecisions.isLoading && !publishDecisions.data?.length && <p className="muted">暂无写回记录。</p>}
        </div>
      </section>
    </main>
  );
}

function StatusCard({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail: string; tone?: 'neutral' | 'ok' | 'danger' }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

type TaskPush = (task: { label: string; status: 'running' | 'succeeded' | 'failed'; detail: string }) => void;

function ModelConfigCard({
  config,
  onProbe,
  probePending,
  pushTask,
}: {
  config: ModelConfigRole;
  onProbe: (role: string, temporaryKey?: string) => void;
  probePending: boolean;
  pushTask: TaskPush;
}) {
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(config.provider ?? '');
  const [model, setModel] = useState(config.model ?? '');
  const [baseUrl, setBaseUrl] = useState(config.base_url ?? '');
  const [maxTokens, setMaxTokens] = useState(String(config.max_tokens ?? ''));
  const [secret, setSecret] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest<{ saved: boolean }>(`/api/admin/model-config/${config.role}`, {
        method: 'PATCH',
        body: JSON.stringify({
          provider,
          model,
          base_url: baseUrl,
          max_tokens: Number(maxTokens),
          cheap: config.cheap,
          supports_json: config.supports_json,
        }),
      });
      if (secret.trim()) {
        await apiRequest<{ saved: boolean }>(`/api/admin/model-config/${config.role}/secret`, {
          method: 'POST',
          body: JSON.stringify({ key: secret }),
        });
      }
      return { saved: true };
    },
    onMutate: () => pushTask({ label: '保存模型配置', status: 'running', detail: `正在保存 ${config.label}` }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['model-config'] });
      void queryClient.invalidateQueries({ queryKey: ['model-routes'] });
      pushTask({ label: '保存模型配置', status: 'succeeded', detail: `${config.label} 已保存。` });
      setEditing(false);
      setSecret('');
    },
    onError: (error: Error) => pushTask({ label: '保存模型配置', status: 'failed', detail: error.message }),
  });

  const hasError = Boolean(config.error);
  const secretLabel = config.secret?.label ?? '未知';
  const statusText = hasError ? config.error : config.secret?.status === 'missing' ? '缺少密钥，配置后再测试' : '可测试连接';

  return (
    <article className={`route-card model-config-card ${hasError ? 'model-config-card--error' : ''}`}>
      <div className="model-config-card__head">
        <div>
          <strong>{config.label}</strong>
          <span>{config.purpose}</span>
        </div>
        <span className={`chip ${config.secret?.status === 'missing' || hasError ? 'danger' : 'ok'}`}>{statusText}</span>
      </div>

      <div className="model-config-summary">
        <div><span>模型</span><strong>{config.model ?? '未配置'}</strong></div>
        <div><span>接口地址</span><strong>{friendlyUrl(config.base_url)}</strong></div>
        <div><span>密钥</span><strong>{secretLabel}</strong></div>
        <div><span>配置来源</span><strong>{config.overridden ? '本机自定义' : '默认配置'}</strong></div>
      </div>

      {editing && (
        <div className="model-config-form">
          <label>
            模型
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 kimi-k2.6" />
          </label>
          <label>
            接口地址
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="例如 https://api.moonshot.cn/v1" />
          </label>
          <label className="model-config-form__secret">
            key：加密信息
            <input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="留空则不修改已保存密钥"
              autoComplete="new-password"
            />
          </label>
        </div>
      )}

      <details className="advanced-details">
        <summary>高级设置</summary>
        {editing && (
          <div className="model-config-advanced-form">
            <label>
              供应商
              <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="例如 kimi" />
            </label>
            <label>
              输出上限
              <input value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} inputMode="numeric" />
            </label>
          </div>
        )}
        <small>role：{config.role}</small>
        <small>provider/model：{config.provider ?? '未识别'} / {config.model ?? '未识别'}</small>
        <small>base_url：{config.base_url ?? '暂无地址'}</small>
        <small>api_key_env：{config.api_key_env ?? '未识别'}</small>
        <small>max_tokens：{config.max_tokens ?? '-'}</small>
        <small>JSON 输出：{config.supports_json ? '支持' : '不支持'}</small>
      </details>

      <div className="model-config-actions">
        <button className="secondary-button" type="button" onClick={() => setEditing((current) => !current)}>
          {editing ? '收起编辑' : '编辑配置'}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => onProbe(config.role, editing && secret ? secret : undefined)}
          disabled={probePending || hasError}
        >
          测试连接
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!editing || saveMutation.isPending || hasError}
        >
          {saveMutation.isPending ? '保存中...' : '保存配置'}
        </button>
      </div>
    </article>
  );
}

function ModelCallRow({ call }: { call: ModelCallRecord }) {
  return (
    <div className={`observability-row status-${call.status}`} role="row">
      <span>{formatDate(call.created_at ?? null)}</span>
      <span>{roleLabel(call.role)}</span>
      <span>{statusLabel(call.status)}{call.cache_hit ? ' / 缓存' : ''}</span>
      <span>{call.error || '无'}</span>
      <span>
        <details className="advanced-details">
          <summary>高级详情</summary>
          <small>调用：#{call.id}</small>
          <small>provider/model：{call.provider}/{call.model}</small>
          <small>输入/输出：{call.input_chars} / {call.output_chars}</small>
          <small>本地用量：{usageSummary(call.usage)}</small>
        </details>
      </span>
    </div>
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

function PublishCard({ decision }: { decision: PublishDecisionRecord }) {
  return (
    <article className="observability-card">
      <div>
        <strong>写回记录</strong>
        <span>{decision.published_at ? '已写回' : '未写回'}</span>
      </div>
      <small>时间：{formatDate(decision.published_at)}</small>
      <details className="advanced-details">
        <summary>高级详情</summary>
        <small>记录：#{decision.id}</small>
        <small>草稿：#{decision.artifact_id}</small>
        <small>改动：{decision.diff_path}</small>
        <small>备份：{decision.backup_path}</small>
        {decision.force && <small>强制写回：{decision.force_reason || '未填写原因'}</small>}
      </details>
    </article>
  );
}

function friendlyUrl(value?: string): string {
  if (!value) {
    return '未配置';
  }
  try {
    const url = new URL(value);
    return url.hostname;
  } catch {
    return value;
  }
}

function formatDate(value: string | null): string {
  if (!value) {
    return '暂无';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
