import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api';
import { useAnnotationInsights } from '../hooks';
import { useWorkbenchStore } from '../store';

type LearnAnnotationsResponse = {
  created: number;
  insight_ids: number[];
  learnable_annotations?: number;
  message?: string;
};

export function InsightPanel() {
  const insights = useAnnotationInsights();
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);

  const learnMutation = useMutation({
    mutationFn: () =>
      apiRequest<LearnAnnotationsResponse>('/api/annotations/learn', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onMutate: () => pushTask({ label: '学习批注', status: 'running', detail: '正在从已解决批注中提取可复用规则。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['annotation-insights'] });
      pushTask({ label: '学习批注', status: result.created > 0 ? 'succeeded' : 'idle', detail: result.message ?? `已生成 ${result.created} 条规则。` });
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
          {learnMutation.isPending ? '学习中...' : '学习已解决批注'}
        </button>
      </div>
      <p className="form-hint">只会学习状态为“已解决”的批注。新建批注需要先在批注页标记为已解决，才会沉淀成记忆规则。</p>
      {learnMutation.data?.message && (
        <p className={learnMutation.data.created > 0 ? 'form-hint' : 'form-hint form-hint--error'}>{learnMutation.data.message}</p>
      )}
      {learnMutation.error && <p className="form-hint form-hint--error">{learnMutation.error.message}</p>}
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
