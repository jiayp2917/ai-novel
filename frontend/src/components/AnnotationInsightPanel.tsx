import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api';
import { useAnnotationInsights } from '../hooks';
import { useWorkbenchStore } from '../store';

export function InsightPanel() {
  const insights = useAnnotationInsights();
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);

  const learnMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ created: number; insight_ids: number[] }>('/api/annotations/learn', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onMutate: () => pushTask({ label: '学习批注', status: 'running', detail: '正在提取可复用规则。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['annotation-insights'] });
      pushTask({ label: '学习批注', status: 'succeeded', detail: `已生成 ${result.created} 条规则。` });
    },
    onError: (error: Error) => pushTask({ label: '学习批注', status: 'failed', detail: error.message }),
  });

  return (
    <section className="insight-panel">
      <div className="insight-header">
        <div>
          <p className="eyebrow">已学习规则</p>
          <h3>批注洞察</h3>
        </div>
        <button className="secondary-button" type="button" onClick={() => learnMutation.mutate()} disabled={learnMutation.isPending}>
          学习
        </button>
      </div>
      <div className="insight-list">
        {insights.isLoading && <p className="muted">正在加载规则...</p>}
        {(insights.data ?? []).map((insight) => (
          <article className={insight.enabled ? 'insight-card' : 'insight-card insight-card--disabled'} key={insight.id}>
            <div className="insight-card__top">
              <strong>{insight.kind}</strong>
              <span>置信度 {insight.confidence.toFixed(2)}</span>
            </div>
            <p>{insight.content}</p>
          </article>
        ))}
        {!insights.isLoading && (insights.data ?? []).length === 0 && <p className="muted">暂无已学习规则。</p>}
      </div>
    </section>
  );
}
