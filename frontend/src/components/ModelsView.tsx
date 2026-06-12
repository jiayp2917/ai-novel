import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import type {
  EventRecord,
  ModelCallCleanupResult,
  ModelCallRecord,
  ModelConfigRole,
  ModelProfile,
  ProbeModelPayload,
  PublishDecisionRecord,
  SkillInfo,
} from '../types';
import { ContextBudgetSection, QualityTrendSection } from './ModelQualitySections';
import { roleLabel, statusLabel, taskTypeLabel, usageSummary } from './modelViewUtils';
import { JobList } from './WorkflowActions';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/Dialog';
import { LoadingSpinner } from './ui/LoadingSpinner';

export function ModelsView() {
  const modelConfig = useModelConfig();
  const cost = useCostDashboard();
  const constraints = useModelConstraints();
  const [modelCallLimit, setModelCallLimit] = useState(20);
  const [modelCallFailedOnly, setModelCallFailedOnly] = useState(false);
  const modelCallSummary = useModelCalls(20, false);
  const modelCalls = useModelCalls(modelCallLimit, modelCallFailedOnly);
  const usageReport = useModelUsageReport();
  const events = useEvents();
  const publishDecisions = usePublishDecisions();
  const skills = useSkills();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const [probeResult, setProbeResult] = useState<ProbeModelPayload | null>(null);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);

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

  const cleanupModelCallsMutation = useMutation({
    mutationFn: () =>
      apiRequest<ModelCallCleanupResult>('/api/jobs/model-calls/cleanup', {
        method: 'POST',
        body: JSON.stringify({ retain_days: 30, failed_only: false, confirm_cleanup: true }),
      }),
    onMutate: () => pushTask({ label: '清理 AI 请求记录', status: 'running', detail: '正在清理 30 天前的排错记录。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['model-calls'] });
      void queryClient.invalidateQueries({ queryKey: ['model-usage-report'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      pushTask({ label: '清理 AI 请求记录', status: 'succeeded', detail: `已清理 ${result.deleted} 条 30 天前记录。` });
    },
    onError: (error: Error) => pushTask({ label: '清理 AI 请求记录', status: 'failed', detail: error.message }),
  });

  const handleCleanupModelCalls = () => {
    setCleanupConfirmOpen(true);
  };

  const pausedCount = modelCallSummary.data?.filter((call) => call.status === 'paused_budget').length ?? 0;
  const lastCall = modelCallSummary.data?.[0];
  const recentFailedCount = modelCallSummary.data?.filter((call) => call.status === 'failed').length ?? 0;
  const displayedModelCalls = modelCallFailedOnly ? (modelCalls.data ?? []).filter((call) => call.status === 'failed') : (modelCalls.data ?? []);
  const modelCallDisplayCount = displayedModelCalls.length;
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
            <h2>模型档案与角色分配</h2>
            <p className="form-hint">先维护可用模型，再把写作、检查、修订等角色分配到对应模型。测试连接会发送一次很短的真实 AI 请求。</p>
          </div>
        </div>
        {modelConfig.data && <p className="form-hint">密钥状态：{modelConfig.data.secret_store.label}。</p>}
        <div className="model-config-workspace">
          {modelConfig.data && (
            <>
              <ModelProfilePanel profiles={modelConfig.data.profiles} pushTask={pushTask} />
              <RoleAssignmentPanel
                profiles={modelConfig.data.profiles}
                roles={modelConfig.data.roles}
                onProbe={(role, temporaryKey) => probeMutation.mutate({ role, temporaryKey })}
                probePending={probeMutation.isPending}
                pushTask={pushTask}
              />
            </>
          )}
          {modelConfig.isLoading && <p className="muted"><LoadingSpinner size="sm" /> 正在加载 AI 助手配置...</p>}
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
        <details className="call-records-panel">
          <summary>
            <div>
              <p className="eyebrow">排错信息</p>
              <h2>AI 请求排错记录</h2>
              <p className="form-hint">平时不用展开；连接失败、费用异常或 AI 无响应时再查看。</p>
            </div>
            <div className="call-records-summary">
              <span>最近：{lastCall ? `${roleLabel(lastCall.role)} · ${statusLabel(lastCall.status)}` : '暂无记录'}</span>
              <span>失败：{recentFailedCount} 条</span>
              <span>当前显示：{modelCallDisplayCount} / {modelCallLimit} 条</span>
            </div>
          </summary>
          <div className="call-records-toolbar">
            <Button
              variant="secondary"
              onClick={() => {
                setModelCallFailedOnly((value) => !value);
                setModelCallLimit(20);
              }}
            >
              {modelCallFailedOnly ? '显示全部' : '只看失败'}
            </Button>
            <Button variant="secondary" onClick={() => modelCalls.refetch()}>
              刷新
            </Button>
            <Button
              variant="secondary"
              onClick={() => setModelCallLimit((value) => Math.min(value + 20, 200))}
              disabled={modelCallLimit >= 200}
            >
              查看更多
            </Button>
            <span className="form-hint">{modelCallFailedOnly ? '当前只显示失败请求。' : '默认只显示最近 20 条。'}</span>
          </div>
          <div className="observability-table observability-table--calls" role="table" aria-label="最近 AI 调用">
            <div className="observability-row observability-row--head" role="row">
              <span>时间</span>
              <span>分工</span>
              <span>状态</span>
              <span>错误摘要</span>
              <span>排错信息</span>
            </div>
            {displayedModelCalls.map((call) => <ModelCallRow call={call} key={call.id} />)}
            {modelCalls.isLoading && <p className="muted"><LoadingSpinner size="sm" /> 正在加载 AI 请求记录...</p>}
            {!modelCalls.isLoading && !displayedModelCalls.length && <p className="muted">暂无符合条件的 AI 请求记录。</p>}
          </div>
          <details className="advanced-details call-records-cleanup">
            <summary>高级清理</summary>
            <p className="form-hint">只清理 30 天前的 AI 请求排错记录，不影响正文、草稿、审核、改动对比、备份或发布记录。</p>
            <Button variant="danger" onClick={handleCleanupModelCalls} disabled={cleanupModelCallsMutation.isPending} loading={cleanupModelCallsMutation.isPending}>
              {cleanupModelCallsMutation.isPending ? '清理中...' : '清理 30 天前记录'}
            </Button>
          </details>
        </details>
      </section>

      <div className="models-bottom-grid">
        <section className="workflow-card models-section models-section--tasks">
          <div className="section-title">
            <div>
              <p className="eyebrow">任务队列</p>
              <h2>继续执行或查看暂停原因</h2>
            </div>
            <Button variant="secondary" onClick={() => runJobsMutation.mutate()} disabled={runJobsMutation.isPending} loading={runJobsMutation.isPending}>
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
      </div>

      <section className="workflow-card models-section models-section--publish">
        <div className="section-title">
          <div>
            <p className="eyebrow">排错信息</p>
            <h2>备份与改动追踪</h2>
          </div>
        </div>
        <div className="observability-list">
          {publishDecisions.data?.map((decision) => <PublishCard decision={decision} key={decision.id} />)}
          {publishDecisions.isLoading && <p className="muted"><LoadingSpinner size="sm" /> 正在加载写回记录...</p>}
          {!publishDecisions.isLoading && !publishDecisions.data?.length && <p className="muted">暂无写回记录。</p>}
        </div>
      </section>
      <ConfirmDialog
        open={cleanupConfirmOpen}
        onClose={() => setCleanupConfirmOpen(false)}
        title="清理 AI 请求记录"
        message="将清理 30 天前的 AI 请求排错记录。不会删除正文、草稿、审核、改动对比、备份或发布记录。"
        confirmLabel="确认清理"
        confirmVariant="danger"
        mark="!"
        markVariant="delete"
        onConfirm={() => {
          setCleanupConfirmOpen(false);
          cleanupModelCallsMutation.mutate();
        }}
      />
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

function ModelProfilePanel({ profiles, pushTask }: { profiles: ModelProfile[]; pushTask: TaskPush }) {
  const [creating, setCreating] = useState(false);
  const defaultProfile = profiles[0];

  return (
    <section className="model-profile-panel">
      <div className="compact-title">
        <div>
          <p className="eyebrow">第一步</p>
          <h3>模型档案</h3>
        </div>
        <Button variant="secondary" onClick={() => setCreating((value) => !value)}>
          {creating ? '收起新增' : '新增模型'}
        </Button>
      </div>
      {creating && (
        <ModelProfileCard
          profile={profileDraft(defaultProfile)}
          mode="create"
          pushTask={pushTask}
          onDone={() => setCreating(false)}
        />
      )}
      <div className="model-profile-list">
        {profiles.map((profile) => (
          <ModelProfileCard profile={profile} key={profile.id} mode="edit" pushTask={pushTask} />
        ))}
      </div>
    </section>
  );
}

function ModelProfileCard({
  profile,
  mode,
  pushTask,
  onDone,
}: {
  profile: ModelProfile;
  mode: 'create' | 'edit';
  pushTask: TaskPush;
  onDone?: () => void;
}) {
  const [editing, setEditing] = useState(mode === 'create');
  const [name, setName] = useState(profile.name);
  const [provider, setProvider] = useState(profile.provider);
  const [model, setModel] = useState(profile.model);
  const [baseUrl, setBaseUrl] = useState(profile.base_url);
  const [apiKeyEnv, setApiKeyEnv] = useState(profile.api_key_env);
  const [maxTokens, setMaxTokens] = useState(String(profile.max_tokens));
  const [secret, setSecret] = useState('');
  const canEdit = mode === 'create' || !profile.built_in;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canEdit) {
        throw new Error('内置模型档案不能直接修改，请先新增自定义模型。');
      }
      const path = mode === 'create' ? '/api/admin/model-profiles' : `/api/admin/model-profiles/${profile.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const result = await apiRequest<{ saved: boolean; profile: ModelProfile }>(path, {
        method,
        body: JSON.stringify({
          name,
          provider,
          model,
          base_url: baseUrl,
          api_key_env: apiKeyEnv,
          max_tokens: Number(maxTokens),
          cheap: profile.cheap,
          supports_json: profile.supports_json,
        }),
      });
      if (secret.trim()) {
        await apiRequest<{ saved: boolean }>(`/api/admin/model-profiles/${result.profile.id}/secret`, {
          method: 'POST',
          body: JSON.stringify({ key: secret }),
        });
      }
      return result.profile;
    },
    onMutate: () => pushTask({ label: '保存模型档案', status: 'running', detail: `正在保存 ${name || '模型档案'}。` }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['model-config'] });
      void queryClient.invalidateQueries({ queryKey: ['model-routes'] });
      pushTask({ label: '保存模型档案', status: 'succeeded', detail: `${saved.name} 已保存。` });
      setEditing(false);
      setSecret('');
      onDone?.();
    },
    onError: (error: Error) => pushTask({ label: '保存模型档案', status: 'failed', detail: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest<{ deleted: boolean }>(`/api/admin/model-profiles/${profile.id}`, { method: 'DELETE' }),
    onMutate: () => pushTask({ label: '删除模型档案', status: 'running', detail: `正在删除 ${profile.name}。` }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['model-config'] });
      pushTask({ label: '删除模型档案', status: 'succeeded', detail: `${profile.name} 已删除。` });
    },
    onError: (error: Error) => pushTask({ label: '删除模型档案', status: 'failed', detail: error.message }),
  });

  const secretLabel = profile.secret?.label ?? '未知';
  const canDelete = mode === 'edit' && !profile.built_in;

  return (
    <article className="route-card model-profile-card">
      <div className="model-config-card__head">
        <div>
          <strong>{profile.name}</strong>
          <span>{profile.provider_label ?? profile.provider} · {profile.model}</span>
        </div>
        <span className={`chip ${profile.secret?.status === 'missing' ? 'danger' : 'ok'}`}>{profile.built_in ? '内置模板' : profile.secret?.status === 'missing' ? '缺少密钥' : '可使用'}</span>
      </div>
      <div className="model-config-summary">
        <div><span>模型</span><strong>{profile.model || '未配置'}</strong></div>
        <div><span>接口地址</span><strong>{friendlyUrl(profile.base_url)}</strong></div>
        <div><span>密钥</span><strong>{secretLabel}</strong></div>
      </div>
      {editing && canEdit && (
        <div className="model-config-form">
          <label>
            档案名称
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Agnes 主力写作" />
          </label>
          <label>
            模型
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 agnes-2.0-flash" />
          </label>
          <label>
            接口地址
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="例如 https://apihub.agnes-ai.com/v1" />
          </label>
          <label>
            密钥环境变量
            <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value)} placeholder="例如 AGNES_API_KEY" />
          </label>
          <label className="model-config-form__secret">
            加密保存密钥
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
        {editing && canEdit && (
          <div className="model-config-advanced-form">
            <label>
              供应商
              <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="例如 agnes" />
            </label>
            <label>
              输出上限
              <input value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} inputMode="numeric" />
            </label>
          </div>
        )}
        <small>provider/model：{profile.provider} / {profile.model}</small>
        <small>base_url：{profile.base_url}</small>
        <small>api_key_env：{profile.api_key_env}</small>
        <small>max_tokens：{profile.max_tokens}</small>
        <small>JSON 输出：{profile.supports_json ? '支持' : '不支持'}</small>
      </details>
      <div className="model-config-actions">
        <Button variant="secondary" onClick={() => setEditing((value) => !value)} disabled={!canEdit || (mode === 'create' && saveMutation.isPending)}>
          {profile.built_in ? '内置只读' : editing ? '收起编辑' : '编辑档案'}
        </Button>
        <Button variant="primary" onClick={() => saveMutation.mutate()} disabled={!editing || saveMutation.isPending} loading={saveMutation.isPending}>
          {mode === 'create' ? '保存新模型' : '保存档案'}
        </Button>
        {canDelete && (
          <Button variant="danger" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} loading={deleteMutation.isPending}>
            删除档案
          </Button>
        )}
      </div>
    </article>
  );
}

function RoleAssignmentPanel({
  profiles,
  roles,
  onProbe,
  probePending,
  pushTask,
}: {
  profiles: ModelProfile[];
  roles: ModelConfigRole[];
  onProbe: (role: string, temporaryKey?: string) => void;
  probePending: boolean;
  pushTask: TaskPush;
}) {
  return (
    <section className="role-assignment-panel">
      <div className="compact-title">
        <div>
          <p className="eyebrow">第二步</p>
          <h3>角色分配</h3>
        </div>
      </div>
      <div className="role-assignment-list">
        {roles.map((role) => (
          <RoleAssignmentRow
            key={role.role}
            role={role}
            profiles={profiles}
            onProbe={onProbe}
            probePending={probePending}
            pushTask={pushTask}
          />
        ))}
      </div>
    </section>
  );
}

function RoleAssignmentRow({
  role,
  profiles,
  onProbe,
  probePending,
  pushTask,
}: {
  role: ModelConfigRole;
  profiles: ModelProfile[];
  onProbe: (role: string, temporaryKey?: string) => void;
  probePending: boolean;
  pushTask: TaskPush;
}) {
  const [profileId, setProfileId] = useState(role.profile_id ?? profiles[0]?.id ?? '');

  useEffect(() => {
    setProfileId(role.profile_id ?? profiles[0]?.id ?? '');
  }, [profiles, role.profile_id]);

  const assignMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ saved: boolean }>(`/api/admin/model-role-assignments/${role.role}`, {
        method: 'PATCH',
        body: JSON.stringify({ profile_id: profileId }),
      }),
    onMutate: () => pushTask({ label: '分配模型角色', status: 'running', detail: `正在为 ${role.label} 分配模型。` }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['model-config'] });
      void queryClient.invalidateQueries({ queryKey: ['model-routes'] });
      pushTask({ label: '分配模型角色', status: 'succeeded', detail: `${role.label} 的模型已更新。` });
    },
    onError: (error: Error) => pushTask({ label: '分配模型角色', status: 'failed', detail: error.message }),
  });

  const assigned = profiles.find((profile) => profile.id === profileId);
  const hasError = Boolean(role.error);
  const changed = profileId !== role.profile_id;

  return (
    <article className={`role-assignment-row ${hasError ? 'model-config-card--error' : ''}`}>
      <div>
        <strong>{role.label}</strong>
        <span>{role.purpose}</span>
      </div>
      <label>
        使用模型
        <select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={hasError}>
          {profiles.map((profile) => (
            <option value={profile.id} key={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <div className="role-assignment-row__meta">
        <span>{assigned ? `${assigned.provider_label ?? assigned.provider} · ${assigned.model}` : role.error ?? '未分配模型'}</span>
        <span>{assigned?.secret?.label ?? role.secret?.label ?? '密钥状态未知'}</span>
      </div>
      <div className="model-config-actions">
        <Button variant="primary" onClick={() => assignMutation.mutate()} disabled={!changed || assignMutation.isPending || hasError} loading={assignMutation.isPending}>
          保存分配
        </Button>
        <Button variant="secondary" onClick={() => onProbe(role.role)} disabled={probePending || hasError}>
          测试此角色
        </Button>
      </div>
    </article>
  );
}

function profileDraft(base?: ModelProfile): ModelProfile {
  return {
    id: 'new-profile',
    name: '',
    provider: base?.provider ?? 'agnes',
    provider_label: base?.provider_label ?? 'Agnes AI',
    model: base?.model ?? 'agnes-2.0-flash',
    base_url: base?.base_url ?? 'https://apihub.agnes-ai.com/v1',
    api_key_env: base?.api_key_env ?? 'AGNES_API_KEY',
    max_tokens: base?.max_tokens ?? 4096,
    cheap: base?.cheap ?? false,
    supports_json: base?.supports_json ?? true,
    built_in: false,
    secret: base?.secret,
  };
}

function ModelCallRow({ call }: { call: ModelCallRecord }) {
  const errorSummary = summarizeModelCallError(call.error);
  const sanitizedError = sanitizeModelCallError(call.error);
  return (
    <div className={`observability-row status-${call.status}`} role="row">
      <span>{formatDate(call.created_at ?? null)}</span>
      <span>{roleLabel(call.role)}</span>
      <span>{statusLabel(call.status)}{call.cache_hit ? ' / 缓存' : ''}</span>
      <span className="model-call-error-summary">{errorSummary}</span>
      <span>
        <details className="advanced-details">
          <summary>高级详情</summary>
          <small>调用：#{call.id}</small>
          <small>provider/model：{call.provider}/{call.model}</small>
          <small>输入/输出：{call.input_chars} / {call.output_chars}</small>
          <small>本地用量：{usageSummary(call.usage)}</small>
          <small>错误：{sanitizedError}</small>
        </details>
      </span>
    </div>
  );
}

function summarizeModelCallError(error?: string | null): string {
  if (!error) {
    return '无';
  }
  const normalized = error.toLowerCase();
  if (normalized.includes('missing api key') || normalized.includes('api_key') || normalized.includes('api key env')) {
    return '缺少密钥配置';
  }
  if (normalized.includes('authentication') || normalized.includes('invalid') || normalized.includes('unauthorized') || normalized.includes('401')) {
    return '密钥验证失败';
  }
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return '请求超时';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many') || normalized.includes('429')) {
    return '请求过多，稍后再试';
  }
  if (normalized.includes('budget')) {
    return '预算限制，已暂停';
  }
  if (error.includes('测试连接失败') || normalized.includes('network') || normalized.includes('connection') || normalized.includes('fetch')) {
    return '连接失败';
  }
  if (normalized.includes('json')) {
    return '响应格式异常';
  }
  return '请求失败，可展开排错信息';
}

function sanitizeModelCallError(error?: string | null): string {
  if (!error) {
    return '无';
  }
  return error
    .replace(/(api\s*key\s*[:=]\s*)[^\s"',}]+/gi, '$1已隐藏')
    .replace(/(api_key\s*[:=]\s*)[^\s"',}]+/gi, '$1已隐藏')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/gi, '$1已隐藏')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-已隐藏')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, 'token-已隐藏');
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
