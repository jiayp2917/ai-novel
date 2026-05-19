import type { ModelUsageReport } from '../types';

export const assistantRoles = [
  { role: 'writer', label: 'AI 写作' },
  { role: 'reviewer', label: 'AI 检查' },
  { role: 'quick_fix', label: 'AI 小修' },
  { role: 'structural_fix', label: '结构修订' },
  { role: 'long_context', label: '记忆整理' },
  { role: 'arbiter', label: '高风险判断' },
];

export function roleLabel(role: string): string {
  const found = assistantRoles.find((item) => item.role === role);
  return found?.label ?? role;
}

export function percent(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0%';
  }
  return `${Math.round(value * 1000) / 10}%`;
}

export function chapterLabel(record: ModelUsageReport['context_budget']['affected_chapters'][number]): string {
  if (record.chapter_no) {
    return `第 ${String(record.chapter_no).padStart(3, '0')} 章${record.chapter_title ? `：${record.chapter_title}` : ''}`;
  }
  if (record.chapter_id) {
    return `章节 #${record.chapter_id}`;
  }
  return `产物 #${record.artifact_id}`;
}

export function taskTypeLabel(taskType: string): string {
  const labels: Record<string, string> = {
    generate_chapter_draft: '生成正文草稿',
    review_chapter_candidate: '检查章节草稿',
    fix_chapter_candidate: '修订章节草稿',
    summarize_published_chapter: '整理章节记忆',
    rebuild_structured_memory: '重建记忆库',
  };
  return labels[taskType] ?? taskType;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    reserved: '已预留',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    paused_budget: '今日调用额度已暂停',
  };
  return labels[status] ?? status;
}

export function usageSummary(usage: Record<string, unknown>): string {
  const total = usage.total_tokens;
  if (typeof total === 'number') {
    return `${total} token`;
  }
  const source = usage.usage_source;
  return typeof source === 'string' ? source : '无';
}
