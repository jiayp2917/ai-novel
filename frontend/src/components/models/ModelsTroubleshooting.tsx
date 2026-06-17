import { useModelCalls } from '../../hooks';
import type { ModelCallRecord } from '../../types';
import { roleLabel, statusLabel, usageSummary } from '../modelViewUtils';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Surface } from '../ui/Surface';
import { formatDate, summarizeModelCallError, sanitizeModelCallError } from './modelsShared';
import type { useModelCallActions } from '../../hooks/useModelCallActions';

type ModelCallActions = ReturnType<typeof useModelCallActions>;

type ModelsTroubleshootingProps = {
  modelCallLimit: number;
  modelCallFailedOnly: boolean;
  setModelCallLimit: (updater: (value: number) => number) => void;
  setModelCallFailedOnly: (updater: (value: boolean) => boolean) => void;
  actions: ModelCallActions;
  onCleanup: () => void;
};

export function ModelsTroubleshooting({
  modelCallLimit,
  modelCallFailedOnly,
  setModelCallLimit,
  setModelCallFailedOnly,
  actions,
  onCleanup,
}: ModelsTroubleshootingProps) {
  const modelCallSummary = useModelCalls(20, false);
  const modelCalls = useModelCalls(modelCallLimit, modelCallFailedOnly);
  const lastCall = modelCallSummary.data?.[0];
  const recentFailedCount = modelCallSummary.data?.filter((call) => call.status === 'failed').length ?? 0;
  const displayedModelCalls = modelCallFailedOnly ? (modelCalls.data ?? []).filter((call) => call.status === 'failed') : (modelCalls.data ?? []);
  const modelCallDisplayCount = displayedModelCalls.length;
  const cleanupPending = actions.clearLogs.isPending;

  return (
    <Surface as="section" variant="paper" className="models-troubleshooting__surface">
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
              setModelCallLimit(() => 20);
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
          <Button variant="danger" onClick={onCleanup} disabled={cleanupPending} loading={cleanupPending}>
            {cleanupPending ? '清理中...' : '清理 30 天前记录'}
          </Button>
        </details>
      </details>
    </Surface>
  );
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
