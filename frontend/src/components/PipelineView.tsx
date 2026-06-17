import { useMemo, useState } from 'react';
import { useChapters, useCostDashboard, usePipelineRuns } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { PipelineRun, PipelineRunCreatePayload } from '../types';
import { Button } from './ui/Button';
import { PipelineDeleteDialog } from './pipeline/PipelineDeleteDialog';
import { PipelineRunDetail } from './pipeline/PipelineRunDetail';
import { PipelineRunList } from './pipeline/PipelineRunList';
import { PipelineWizard } from './pipeline/PipelineWizard';
import {
  generationModeFromPayloadValue,
  modeFromPayloadValue,
  numberFromPayloadValue,
} from './pipeline/pipelineUtils';
import { usePipelineMutations } from './pipeline/usePipelineMutations';

export function PipelineView() {
  const chapters = useChapters();
  const runs = usePipelineRuns();
  const cost = useCostDashboard();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const setActiveView = useWorkbenchStore((state) => state.setActiveView);
  const chapterCount = chapters.data?.length ?? 0;
  const defaultEnd = Math.min(10, Math.max(1, chapterCount || 10));
  const [form, setForm] = useState<PipelineRunCreatePayload>({
    start_chapter: 1,
    end_chapter: defaultEnd,
    mode: 'review_fix',
    chunk_size: 3,
    max_fix_rounds: 2,
    dry_run: true,
    generation_mode: 'stable',
  });
  const m = usePipelineMutations(form, setForm);
  const allRuns = runs.data ?? [];
  const selectedRun = useMemo(
    () => allRuns.find((run) => run.id === m.selectedRunId) ?? allRuns[0] ?? null,
    [allRuns, m.selectedRunId],
  );

  function reuseRun(run: PipelineRun) {
    setForm({
      start_chapter: numberFromPayloadValue(run.payload.start_chapter, 1),
      end_chapter: numberFromPayloadValue(run.payload.end_chapter, defaultEnd),
      mode: modeFromPayloadValue(run.payload.mode),
      chunk_size: numberFromPayloadValue(run.payload.chunk_size, 3),
      max_fix_rounds: numberFromPayloadValue(run.payload.max_fix_rounds, 2),
      dry_run: true,
      generation_mode: generationModeFromPayloadValue(run.payload.generation_mode),
    });
    pushTask({ label: '自动流水线', status: 'succeeded', detail: `已套用流水线 #${run.id} 的设置，可调整后重新创建。` });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <main className="content-view pipeline-workbench">
      <div className="view-header">
        <div>
          <p className="eyebrow">自动流水线</p>
          <h1>批量生成、检查和修订章节草稿</h1>
        </div>
        <div className="action-row">
          <Button variant="secondary" onClick={() => runs.refetch()}>刷新进度</Button>
          <Button variant="secondary" onClick={() => setActiveView('models')}>查看 AI 设置</Button>
        </div>
      </div>

      <section className="workflow-card workflow-card--compact">
        <div className="pipeline-summary">
          <span>已索引正文：{chapterCount} 章</span>
          <span>流水线任务：{runs.data?.length ?? 0}</span>
          <span>AI 用量：{cost.data?.today_model_calls ?? 0} 次</span>
          <span>运行中任务：{cost.data?.running_jobs ?? 0}</span>
        </div>
      </section>

      <PipelineWizard
        form={form}
        onChange={setForm}
        onCreate={() => m.createRun.mutate()}
        onAdvance={() => m.runJobsMutation.mutate()}
        creating={m.createRun.isPending}
        advancing={m.runJobsMutation.isPending}
      />

      <div className="pipeline-detail-grid">
        <PipelineRunList
          runs={allRuns}
          loading={runs.isLoading}
          selectedRunId={selectedRun?.id ?? null}
          onSelect={m.setSelectedRunId}
        />
        <PipelineRunDetail
          run={selectedRun}
          mutating={m.mutateRun.isPending}
          deleting={m.deleteRun.isPending}
          onMutate={(action) => selectedRun && m.mutateRun.mutate({ runId: selectedRun.id, action })}
          onReuse={() => selectedRun && reuseRun(selectedRun)}
          onDelete={() => {
            if (!selectedRun) return;
            m.setDeleteDialogError(null);
            m.setPendingDeleteRun(selectedRun);
          }}
        />
      </div>

      <section className="workflow-card">
        <div className="section-title">
          <div>
            <p className="eyebrow">安全节点</p>
            <h2>自动任务的固定边界</h2>
          </div>
        </div>
        <div className="pipeline-lanes">
          <span>1 选择作品</span>
          <span>2 选择章节范围</span>
          <span>3 选择执行模式</span>
          <span>4 选择生成稳定性</span>
          <span>5 生成草稿/候选</span>
          <span>6 证据约束检查</span>
          <span>7 只修复可修 writer 问题</span>
          <span>8 报告和发布门确认</span>
        </div>
      </section>

      <PipelineDeleteDialog
        run={m.pendingDeleteRun}
        busy={m.deleteRun.isPending}
        error={m.deleteDialogError}
        onCancel={() => {
          if (!m.deleteRun.isPending) {
            m.setDeleteDialogError(null);
            m.setPendingDeleteRun(null);
          }
        }}
        onConfirm={() => {
          if (m.pendingDeleteRun) {
            m.deleteRun.mutate(m.pendingDeleteRun.id);
          }
        }}
      />
    </main>
  );
}
