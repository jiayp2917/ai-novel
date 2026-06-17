import { usePublishDecisions } from '../../hooks';
import type { PublishDecisionRecord } from '../../types';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Surface } from '../ui/Surface';
import { formatDate } from './modelsShared';

export function ModelsBackup() {
  const publishDecisions = usePublishDecisions();
  return (
    <Surface as="section" variant="paper" className="models-backup__surface">
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
    </Surface>
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
