import { useCostDashboard, useModelCalls } from '../../hooks';
import { roleLabel, statusLabel } from '../modelViewUtils';
import { Surface } from '../ui/Surface';
import { formatDate, statusCardClass } from './modelsShared';

type StatusTone = 'neutral' | 'ok' | 'danger';

type StatusCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: StatusTone;
};

function StatusCard({ label, value, detail, tone = 'neutral' }: StatusCardProps) {
  return (
    <article className={statusCardClass(tone)}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

type ModelsOverviewProps = {
  pausedCount: number;
};

export function ModelsOverview({ pausedCount }: ModelsOverviewProps) {
  const cost = useCostDashboard();
  const modelCallSummary = useModelCalls(20, false);
  const pausedCallCount = modelCallSummary.data?.filter((call) => call.status === 'paused_budget').length ?? 0;
  const lastCall = modelCallSummary.data?.[0];

  return (
    <Surface as="section" variant="paper" className="models-overview__surface">
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
        <StatusCard label="今日任务" value={`${cost.data?.running_jobs ?? 0} 个运行中`} detail="后台任务可在下方继续处理。" />
        <StatusCard
          label="预算状态"
          value={pausedCount || pausedCallCount ? '已暂停' : '正常'}
          detail={pausedCount ? `${pausedCount} 个任务因预算暂停。` : pausedCallCount ? `${pausedCallCount} 条调用因预算暂停。` : '未发现预算暂停。'}
          tone={pausedCount || pausedCallCount ? 'danger' : 'ok'}
        />
        <StatusCard
          label="最近调用"
          value={lastCall ? statusLabel(lastCall.status) : '暂无'}
          detail={lastCall ? `${roleLabel(lastCall.role)} · ${formatDate(lastCall.created_at ?? null)}` : '运行 AI 后会出现记录。'}
        />
      </div>
    </Surface>
  );
}
