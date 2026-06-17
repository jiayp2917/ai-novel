import type { PipelineRunCreatePayload } from '../types';

// 流水线创建模式
export const modeLabels: Record<PipelineRunCreatePayload['mode'], string> = {
  review_only: '只检查已有草稿',
  generate_missing: '只补齐缺失草稿',
  review_fix: '检查并生成修订草稿',
  full_auto: '全自动生成、检查、修订',
};

export const modeDescriptions: Record<PipelineRunCreatePayload['mode'], string> = {
  review_only: '适合已经有草稿，只想批量检查问题。',
  generate_missing: '适合缺章或短稿，只生成候选，不自动写回。',
  review_fix: '适合已有草稿，希望系统检查后按问题生成修订候选。',
  full_auto: '适合沙盒预演完整链路；本界面不会直接写回正文。',
};

// 生成稳定性
export const generationModeLabels: Record<PipelineRunCreatePayload['generation_mode'], string> = {
  stable: '稳定省钱',
  quality: '质量优先',
  fast: '速度优先',
};

export const generationModeDescriptions: Record<PipelineRunCreatePayload['generation_mode'], string> = {
  stable: '短 skill、低随机性、单候选，优先减少漂移和 token 消耗。',
  quality: '增加检查和复审成本，适合关键章节。',
  fast: '更快生成草稿，主要由人工承担审核。',
};

// 流水线 / 任务 通用状态
export const statusLabels: Record<string, string> = {
  planned: '等待开始',
  queued: '等待执行',
  running: '执行中',
  context_built: '上下文已准备',
  draft_generated: '草稿已生成',
  local_validated: '本地规则已通过',
  reviewed: '已检查',
  fixing: '正在修订',
  approved: '可进入写回确认',
  published: '已写回',
  summarized: '记忆已整理',
  done: '已完成',
  paused: '已暂停',
  manual_required: '需要人工判断',
  paused_budget: 'AI 调用已暂停',
  failed_retryable: '失败，可重试',
  failed_terminal: '已终止',
  succeeded: '已完成',
  failed: '失败',
};

// 任务类型（章节 + 设定 + 草稿 + 记忆）
export const taskLabels: Record<string, string> = {
  revise_from_annotations: '按批注修订草稿',
  test_budget_resume: '预算暂停恢复测试',
  pipeline_run: '自动流水线',
  generate_chapter_draft: '生成章节草稿',
  review_chapter_candidate: '检查章节草稿',
  fix_chapter_candidate: '修订章节草稿',
  publish_chapter_candidate: '确认写回正文',
  summarize_published_chapter: '整理章节记忆',
  rebuild_structured_memory: '重建记忆库',
};

// 流水线操作按钮的提示文本
export const runOperationHelp: Record<string, string> = {
  pause: '暂停后不会继续领取新步骤；已完成的草稿、检查报告会保留。',
  resume: '恢复后任务会回到待处理状态，需要点击“推进一次任务”继续。',
  retry: '只适用于失败可重试或额度暂停的任务；重试后需要再次推进任务。',
  cancel: '停止后不能继续，只能复用相同设置重新创建一条流水线。',
  delete: '只删除这条流水线的任务记录，不删除草稿、报告、模型日志或正文。',
};

// 任务状态 chip 颜色
export type JobTone = 'safe' | 'danger' | 'blue' | 'purple';

const SAFE_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'done', 'approved']);
const DANGER_STATUSES: ReadonlySet<string> = new Set(['failed', 'failed_terminal', 'failed_retryable', 'paused_budget']);

export function jobTone(status: string): JobTone {
  if (SAFE_STATUSES.has(status)) {
    return 'safe';
  }
  if (DANGER_STATUSES.has(status)) {
    return 'danger';
  }
  if (status === 'running') {
    return 'blue';
  }
  return 'purple';
}

// 任务状态的中文显示
export function jobStatusLabel(status: string): string {
  return statusLabels[status] ?? `未知状态：${status}`;
}

// 任务状态对应的“下一步”提示
export const jobNextStepLabels: Record<string, string> = {
  queued: '点击“继续执行任务”推进队列。',
  running: '等待当前任务完成。',
  succeeded: '查看生成草稿、评审或写回记录。',
  done: '查看结果或进入下一步。',
  approved: '已通过，可继续后续流程。',
  manual_required: '需要人工检查草稿或处理提示。',
  failed: '查看失败原因后重试或调整配置。',
  failed_terminal: '需要修复配置或输入后重新创建任务。',
  failed_retryable: '可以在模型页继续执行或重试。',
  paused_budget: '检查预算和模型配置后继续执行。',
};

export function jobNextStep(status: string): string {
  return jobNextStepLabels[status] ?? '查看高级详情确认下一步。';
}

// 任务类型的中文显示（统一来源：覆盖 job / pipeline / model_call 共享的 taskType）
export function jobTypeLabel(type: string): string {
  return taskLabels[type] ?? `未知任务：${type}`;
}
