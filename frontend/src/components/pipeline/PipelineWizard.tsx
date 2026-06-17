import type { PipelineRunCreatePayload } from '../../types';
import { Button } from '../ui/Button';
import { Surface } from '../ui/Surface';
import {
  generationModeDescriptions,
  generationModeLabels,
  modeDescriptions,
  modeLabels,
} from '../../lib/pipelineLabels';

export interface PipelineWizardProps {
  form: PipelineRunCreatePayload;
  onChange: (form: PipelineRunCreatePayload) => void;
  onCreate: () => void;
  onAdvance: () => void;
  creating: boolean;
  advancing: boolean;
}

export function PipelineWizard({ form, onChange, onCreate, onAdvance, creating, advancing }: PipelineWizardProps) {
  function updateNumber(name: keyof PipelineRunCreatePayload, value: string) {
    const parsed = Number.parseInt(value, 10);
    onChange({ ...form, [name]: Number.isFinite(parsed) ? parsed : 0 });
  }

  return (
    <Surface as="section" variant="paper" className="workflow-card pipeline-wizard__surface">
      <div className="section-title">
        <div>
          <p className="eyebrow">开始前确认</p>
          <h2>按 3 步创建自动任务</h2>
        </div>
        <span className="chip ok">只生成草稿和报告</span>
      </div>
      <div className="pipeline-wizard">
        <label>
          <strong>1. 章节范围</strong>
          <span>建议先用 1-10 章沙盒验证。</span>
          <div className="pipeline-range">
            <input aria-label="起始章节" min={1} type="number" value={form.start_chapter} onChange={(event) => updateNumber('start_chapter', event.target.value)} />
            <span>到</span>
            <input aria-label="结束章节" min={1} type="number" value={form.end_chapter} onChange={(event) => updateNumber('end_chapter', event.target.value)} />
          </div>
        </label>
        <label>
          <strong>2. 选择模式</strong>
          <span>{modeDescriptions[form.mode]}</span>
          <select
            aria-label="执行模式"
            value={form.mode}
            onChange={(event) => onChange({ ...form, mode: event.target.value as PipelineRunCreatePayload['mode'] })}
          >
            {Object.entries(modeLabels).map(([mode, label]) => (
              <option key={mode} value={mode}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <strong>3. 生成稳定性</strong>
          <span>{generationModeDescriptions[form.generation_mode]}</span>
          <select
            aria-label="生成模式"
            value={form.generation_mode}
            onChange={(event) => onChange({ ...form, generation_mode: event.target.value as PipelineRunCreatePayload['generation_mode'] })}
          >
            {Object.entries(generationModeLabels).map(([mode, label]) => (
              <option key={mode} value={mode}>{label}</option>
            ))}
          </select>
        </label>
        <label className="pipeline-mode-card">
          <span>自动流水线固定为预演：只生成草稿、检查结果、改动对比和运行报告，不覆盖正文。</span>
          <span className="checkbox-row">只预演流程，不写回正文</span>
        </label>
        <details className="advanced-details">
          <summary>高级选项</summary>
          <label>
            <strong>分批和修订</strong>
            <span>分片越小越稳，修订轮次越高越耗额度。</span>
            <div className="pipeline-range">
              <input aria-label="每批章节数" min={1} max={20} type="number" value={form.chunk_size} onChange={(event) => updateNumber('chunk_size', event.target.value)} />
              <input aria-label="最大修订轮次" min={0} max={5} type="number" value={form.max_fix_rounds} onChange={(event) => updateNumber('max_fix_rounds', event.target.value)} />
            </div>
          </label>
        </details>
      </div>
      <div className="notice safe">所有 AI 输出都会先进入草稿/候选。正式正文写回仍必须经过发布门；设定和章纲只生成提案。</div>
      <div className="action-row">
        <Button variant="primary" onClick={onCreate} disabled={creating} loading={creating}>
          创建自动流水线
        </Button>
        <Button variant="secondary" onClick={onAdvance} disabled={advancing} loading={advancing}>
          推进一次任务
        </Button>
      </div>
    </Surface>
  );
}
