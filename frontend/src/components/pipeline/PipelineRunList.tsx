import { useState } from 'react';
import type { PipelineRun, PipelineRunCreatePayload } from '../../types';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Surface } from '../ui/Surface';
import { modeLabels } from '../../lib/pipelineLabels';
import {
  RUN_LIST_LIMIT,
  modeFromPayload,
  nextStepForRun,
  statusText,
  summarizeRun,
} from './pipelineUtils';

export interface PipelineRunListProps {
  runs: PipelineRun[];
  loading: boolean;
  selectedRunId: number | null;
  onSelect: (runId: number) => void;
}

export function PipelineRunList({ runs, loading, selectedRunId, onSelect }: PipelineRunListProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? runs : runs.slice(0, RUN_LIST_LIMIT);
  const hasOverflow = runs.length > RUN_LIST_LIMIT;

  return (
    <Surface as="section" variant="paper" className="workflow-card pipeline-run-list__surface">
      <div className="section-title">
        <div>
          <p className="eyebrow">任务列表</p>
          <h2>最近自动任务</h2>
        </div>
      </div>
      <p className="muted">点击左侧任务查看详情。默认显示最近 {RUN_LIST_LIMIT} 条；已完成、已终止或需人工判断的任务不会继续运行。</p>
      <div className="pipeline-run-list">
        {visible.map((run) => {
          const summary = summarizeRun(run);
          const step = nextStepForRun(run, summary);
          return (
            <Surface
              as="button"
              variant="paper"
              className={`pipeline-run-item pipeline-run-item__surface ${selectedRunId === run.id ? 'is-active' : ''}`}
              key={run.id}
            >
              <button
                className="pipeline-run-item__inner"
                type="button"
                onClick={() => onSelect(run.id)}
              >
                <strong>#{run.id} {modeLabels[modeFromPayload(run) as PipelineRunCreatePayload['mode']] ?? run.payload.mode}</strong>
                <span>第 {String(run.payload.start_chapter)}-{String(run.payload.end_chapter)} 章 · {statusText(run.status)}</span>
                <small>{summary.done}/{summary.total} 个步骤完成 · {summary.manual} 个需人工判断 · {summary.failed} 个失败</small>
                <small aria-hidden="true">{step.label}：{step.text}</small>
              </button>
            </Surface>
          );
        })}
        {loading && <p className="muted"><LoadingSpinner size="sm" /> 正在加载自动任务...</p>}
        {!loading && !runs.length && <p className="muted">还没有自动流水线任务。</p>}
      </div>
      {hasOverflow && (
        <Button variant="secondary" className="pipeline-list-toggle" onClick={() => setShowAll((value) => !value)}>
          {showAll ? `收起到最近 ${RUN_LIST_LIMIT} 条` : `显示全部 ${runs.length} 条`}
        </Button>
      )}
    </Surface>
  );
}
