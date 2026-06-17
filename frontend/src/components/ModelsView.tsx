import { useState } from 'react';
import { useJobs, useModelConfig, useModelUsageReport } from '../hooks';
import { useModelConfigActions } from '../hooks/useModelConfigActions';
import { useModelCallActions } from '../hooks/useModelCallActions';
import type { ProbeModelPayload } from '../types';
import { ContextBudgetSection, QualityTrendSection } from './ModelQualitySections';
import { ModelsBackup } from './models/ModelsBackup';
import { ModelsOverview } from './models/ModelsOverview';
import { ModelsProfiles } from './models/ModelsProfiles';
import { ModelsRoleAssignments } from './models/ModelsRoleAssignments';
import { ModelsSkills } from './models/ModelsSkills';
import { ModelsTroubleshooting } from './models/ModelsTroubleshooting';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { ConfirmDialog } from './ui/Dialog';

export function ModelsView() {
  const modelConfig = useModelConfig();
  const jobs = useJobs();
  const usageReport = useModelUsageReport();
  const [modelCallLimit, setModelCallLimit] = useState(20);
  const [modelCallFailedOnly, setModelCallFailedOnly] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeModelPayload | null>(null);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const pausedCount = jobs.data?.filter((job) => job.status === 'paused_budget').length ?? 0;

  const configActions = useModelConfigActions();
  const callActions = useModelCallActions();

  const handleProbe = (role: string, temporaryKey?: string) => {
    configActions.probeRole({ role, temporaryKey }, (result) => setProbeResult(result));
  };

  return (
    <main className="content-view models-view">
      <ModelsOverview pausedCount={pausedCount} />

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
              <ModelsProfiles profiles={modelConfig.data.profiles} actions={configActions} />
              <ModelsRoleAssignments
                profiles={modelConfig.data.profiles}
                roles={modelConfig.data.roles}
                actions={configActions}
                onProbe={handleProbe}
                probePending={false}
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

      <ModelsTroubleshooting
        modelCallLimit={modelCallLimit}
        modelCallFailedOnly={modelCallFailedOnly}
        setModelCallLimit={setModelCallLimit}
        setModelCallFailedOnly={setModelCallFailedOnly}
        actions={callActions}
        onCleanup={() => setCleanupConfirmOpen(true)}
      />

      <ModelsSkills actions={callActions} />

      <ModelsBackup />

      <ConfirmDialog
        paper
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
          callActions.clearLogs.mutate();
        }}
      />
    </main>
  );
}
