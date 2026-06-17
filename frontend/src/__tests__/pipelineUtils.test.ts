// 覆盖范围：frontend/src/components/pipeline/pipelineUtils.ts 中所有导出的纯函数
// （summarizeRun / numberFromPayload / modeFromPayload / generationModeFromPayload /
//  canPause / canResume / canRetry / canCancel / canDelete / disabledReason /
//  deleteBlockReason / nextStepForRun / groupTasksByChapter /
//  isPausedFailureSummary / numberFromPayloadValue / modeFromPayloadValue /
//  generationModeFromPayloadValue）。
import { describe, it, expect } from 'vitest';
import {
  summarizeRun,
  numberFromPayload,
  modeFromPayload,
  generationModeFromPayload,
  canPause,
  canResume,
  canRetry,
  canCancel,
  canDelete,
  disabledReason,
  deleteBlockReason,
  nextStepForRun,
  groupTasksByChapter,
  isPausedFailureSummary,
  numberFromPayloadValue,
  modeFromPayloadValue,
  generationModeFromPayloadValue,
} from '../components/pipeline/pipelineUtils';
import type { Job, PipelineRun } from '../types';

// 构造最小 PipelineRun mock 的辅助函数：只填被测字段，其余用强制类型断言补齐
function makeRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: 1,
    type: 'pipeline_run',
    status: 'running',
    payload: {},
    result: {},
    error: null,
    child_tasks: [],
    summary: undefined as unknown as PipelineRun['summary'],
    next_step: undefined as unknown as PipelineRun['next_step'],
    report_summary: {
      path: null,
      exists: false,
      generated: false,
      note: '',
    },
    ...overrides,
  } as PipelineRun;
}

function makeTask(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    type: 'write',
    status: 'done',
    payload: {},
    result: null,
    error: null,
    locked_chapter_id: null,
    locked_source_file_id: null,
    ...overrides,
  } as Job;
}

describe('summarizeRun', () => {
  it('有 summary 时直接使用 summary 字段', () => {
    const run = makeRun({
      summary: {
        total_steps: 10,
        completed_steps: 6,
        manual_required_steps: 2,
        failed_or_paused_steps: 1,
        status_label: '运行中',
        can_delete: false,
        delete_block_reason: null,
        failure_summaries: [],
      },
    });
    expect(summarizeRun(run)).toEqual({ total: 10, done: 6, manual: 2, failed: 1 });
  });

  it('无 summary 时按 child_tasks 状态统计 total/done/manual/failed', () => {
    const run = makeRun({
      status: 'manual_required',
      child_tasks: [
        makeTask({ id: 1, status: 'approved' }),
        makeTask({ id: 2, status: 'published' }),
        makeTask({ id: 3, status: 'summarized' }),
        makeTask({ id: 4, status: 'done' }),
        makeTask({ id: 5, status: 'manual_required' }),
        makeTask({ id: 6, status: 'failed_terminal' }),
        makeTask({ id: 7, status: 'failed_retryable' }),
        makeTask({ id: 8, status: 'paused_budget' }),
        makeTask({ id: 9, status: 'running' }),
      ],
    });
    // total=9, done=4(approved/published/summarized/done), manual=1, failed=3
    expect(summarizeRun(run)).toEqual({ total: 9, done: 4, manual: 1, failed: 3 });
  });

  it('child_tasks 为空时返回全 0', () => {
    const run = makeRun({ status: 'running', child_tasks: [] });
    expect(summarizeRun(run)).toEqual({ total: 0, done: 0, manual: 0, failed: 0 });
  });
});

describe('numberFromPayload', () => {
  it('payload[key] 为 number 时返回该值', () => {
    const run = makeRun({ payload: { chunk_size: 2000 } });
    expect(numberFromPayload(run, 'chunk_size', 100)).toBe(2000);
  });

  it('payload[key] 非 number 时返回 fallback', () => {
    const run = makeRun({ payload: { chunk_size: 'abc' } });
    expect(numberFromPayload(run, 'chunk_size', 100)).toBe(100);
  });

  it('payload[key] 缺失时返回 fallback', () => {
    const run = makeRun({ payload: {} });
    expect(numberFromPayload(run, 'missing', 7)).toBe(7);
  });
});

describe('modeFromPayload', () => {
  it.each(['review_only', 'generate_missing', 'review_fix', 'full_auto'] as const)(
    '合法 mode %s 原样返回',
    (mode) => {
      const run = makeRun({ payload: { mode } });
      expect(modeFromPayload(run)).toBe(mode);
    },
  );

  it('非法 mode 回退到 review_fix', () => {
    const run = makeRun({ payload: { mode: 'whatever' } });
    expect(modeFromPayload(run)).toBe('review_fix');
  });

  it('缺失 mode 回退到 review_fix', () => {
    const run = makeRun({ payload: {} });
    expect(modeFromPayload(run)).toBe('review_fix');
  });
});

describe('generationModeFromPayload', () => {
  it.each(['quality', 'fast', 'stable'] as const)(
    '合法 generation_mode %s 原样返回',
    (mode) => {
      const run = makeRun({ payload: { generation_mode: mode } });
      expect(generationModeFromPayload(run)).toBe(mode);
    },
  );

  it('非法 generation_mode 回退到 stable', () => {
    const run = makeRun({ payload: { generation_mode: 'turbo' } });
    expect(generationModeFromPayload(run)).toBe('stable');
  });

  it('缺失 generation_mode 回退到 stable', () => {
    const run = makeRun({ payload: {} });
    expect(generationModeFromPayload(run)).toBe('stable');
  });
});

describe('canPause', () => {
  it.each(['paused', 'done', 'failed_terminal', 'manual_required'])(
    '终态/暂停/需人工 status=%s 时返回 false',
    (status) => {
      expect(canPause(makeRun({ status }))).toBe(false);
    },
  );

  it.each(['running', 'pending', 'failed_retryable', 'paused_budget'])(
    '可继续 status=%s 时返回 true',
    (status) => {
      expect(canPause(makeRun({ status }))).toBe(true);
    },
  );
});

describe('canResume', () => {
  it.each(['paused', 'paused_budget'])('status=%s 时返回 true', (status) => {
    expect(canResume(makeRun({ status }))).toBe(true);
  });

  it.each(['running', 'done', 'failed_terminal', 'failed_retryable', 'manual_required'])(
    '非暂停 status=%s 时返回 false',
    (status) => {
      expect(canResume(makeRun({ status }))).toBe(false);
    },
  );
});

describe('canRetry', () => {
  it.each(['failed_retryable', 'paused_budget'])('status=%s 时返回 true', (status) => {
    expect(canRetry(makeRun({ status }))).toBe(true);
  });

  it.each(['running', 'done', 'failed_terminal', 'manual_required', 'paused'])(
    '非可重试 status=%s 时返回 false',
    (status) => {
      expect(canRetry(makeRun({ status }))).toBe(false);
    },
  );
});

describe('canCancel', () => {
  it.each(['done', 'failed_terminal', 'manual_required'])(
    '终态 status=%s 时返回 false',
    (status) => {
      expect(canCancel(makeRun({ status }))).toBe(false);
    },
  );

  it.each(['running', 'pending', 'paused', 'paused_budget', 'failed_retryable'])(
    '可取消 status=%s 时返回 true',
    (status) => {
      expect(canCancel(makeRun({ status }))).toBe(true);
    },
  );
});

describe('canDelete', () => {
  it('summary.can_delete 优先于 status 判定', () => {
    const run = makeRun({
      status: 'running',
      summary: {
        total_steps: 0,
        completed_steps: 0,
        manual_required_steps: 0,
        failed_or_paused_steps: 0,
        status_label: '运行中',
        can_delete: true,
        delete_block_reason: null,
        failure_summaries: [],
      },
    });
    expect(canDelete(run)).toBe(true);
  });

  it.each(['done', 'failed_terminal', 'manual_required'])(
    '无 summary 时终态 status=%s 返回 true',
    (status) => {
      expect(canDelete(makeRun({ status }))).toBe(true);
    },
  );

  it('无 summary 且 status=running 时返回 false', () => {
    expect(canDelete(makeRun({ status: 'running' }))).toBe(false);
  });
});

describe('disabledReason', () => {
  it('resume 返回恢复相关中文说明', () => {
    expect(disabledReason('resume', makeRun())).toBe('只有已暂停或额度暂停的任务可以恢复。');
  });

  it('retry 返回重试相关中文说明', () => {
    expect(disabledReason('retry', makeRun())).toBe('只有可重试失败或额度暂停的任务可以重试。');
  });

  it('delete 返回删除相关中文说明', () => {
    expect(disabledReason('delete', makeRun())).toBe('只能删除已完成、已终止或需人工处理的记录。');
  });

  it('pause 返回暂停相关中文说明', () => {
    expect(disabledReason('pause', makeRun())).toBe('已结束或需人工处理的任务不能暂停。');
  });

  it('cancel 返回停止相关中文说明', () => {
    expect(disabledReason('cancel', makeRun())).toBe('已结束或需人工处理的任务不能停止。');
  });
});

describe('deleteBlockReason', () => {
  it('summary.delete_block_reason 优先返回', () => {
    const run = makeRun({
      status: 'running',
      summary: {
        total_steps: 0,
        completed_steps: 0,
        manual_required_steps: 0,
        failed_or_paused_steps: 0,
        status_label: '运行中',
        can_delete: true,
        delete_block_reason: '被引用中',
        failure_summaries: [],
      },
    });
    expect(deleteBlockReason(run)).toBe('被引用中');
  });

  it('summary 缺失 delete_block_reason 但 canDelete 为真时返回 null', () => {
    const run = makeRun({
      status: 'done',
      summary: {
        total_steps: 0,
        completed_steps: 0,
        manual_required_steps: 0,
        failed_or_paused_steps: 0,
        status_label: '已完成',
        can_delete: true,
        delete_block_reason: null,
        failure_summaries: [],
      },
    });
    expect(deleteBlockReason(run)).toBeNull();
  });

  it('canDelete 为假且无 summary.delete_block_reason 时返回 disabledReason(delete)', () => {
    const run = makeRun({ status: 'running' });
    expect(deleteBlockReason(run)).toBe('只能删除已完成、已终止或需人工处理的记录。');
  });
});

describe('nextStepForRun', () => {
  const emptySummary = { total: 0, done: 0, manual: 0, failed: 0 };

  it('run.next_step 优先返回', () => {
    const run = makeRun({
      next_step: { label: '自定义', text: '自定义说明', tone: 'info' },
    });
    expect(nextStepForRun(run, emptySummary)).toEqual({
      label: '自定义',
      text: '自定义说明',
      tone: 'info',
    });
  });

  it('status=done 返回"已完成"', () => {
    const step = nextStepForRun(makeRun({ status: 'done' }), emptySummary);
    expect(step.label).toBe('已完成');
    expect(step.tone).toBe('ok');
    expect(step.text).toContain('查看报告');
  });

  it('status=manual_required 返回"需要人工处理"', () => {
    const step = nextStepForRun(makeRun({ status: 'manual_required' }), emptySummary);
    expect(step.label).toBe('需要人工处理');
    expect(step.tone).toBe('warn');
  });

  it('summary.manual>0 时即便 status 非 manual_required 也返回"需要人工处理"', () => {
    const step = nextStepForRun(makeRun({ status: 'running' }), { total: 5, done: 3, manual: 1, failed: 0 });
    expect(step.label).toBe('需要人工处理');
    expect(step.tone).toBe('warn');
  });

  it('status=failed_terminal 返回"已停止"', () => {
    const step = nextStepForRun(makeRun({ status: 'failed_terminal' }), emptySummary);
    expect(step.label).toBe('已停止');
    expect(step.tone).toBe('danger');
  });

  it('status=failed_retryable 返回"可重试"', () => {
    const step = nextStepForRun(makeRun({ status: 'failed_retryable' }), emptySummary);
    expect(step.label).toBe('可重试');
    expect(step.tone).toBe('danger');
  });

  it('status=paused_budget 返回"额度暂停"', () => {
    const step = nextStepForRun(makeRun({ status: 'paused_budget' }), emptySummary);
    expect(step.label).toBe('额度暂停');
    expect(step.tone).toBe('warn');
  });

  it('status=paused 返回"已暂停"', () => {
    const step = nextStepForRun(makeRun({ status: 'paused' }), emptySummary);
    expect(step.label).toBe('已暂停');
    expect(step.tone).toBe('info');
  });

  it('summary.failed>0 且无匹配 status 时返回"有步骤失败"', () => {
    const step = nextStepForRun(makeRun({ status: 'running' }), { total: 5, done: 3, manual: 0, failed: 2 });
    expect(step.label).toBe('有步骤失败');
    expect(step.tone).toBe('danger');
  });

  it('其余默认返回"下一步"', () => {
    const step = nextStepForRun(makeRun({ status: 'running' }), { total: 5, done: 3, manual: 0, failed: 0 });
    expect(step.label).toBe('下一步');
    expect(step.tone).toBe('info');
    expect(step.text).toContain('推进一次任务');
  });
});

describe('groupTasksByChapter', () => {
  it('chapter_no 为 number 时按 padStart(3,0) 分组并保持插入顺序', () => {
    const tasks = [
      makeTask({ id: 1, payload: { chapter_no: 5 } }),
      makeTask({ id: 2, payload: { chapter_no: 5 } }),
      makeTask({ id: 3, payload: { chapter_no: 12 } }),
      makeTask({ id: 4, payload: { chapter_no: 123 } }),
    ];
    const result = groupTasksByChapter(tasks);
    expect(result.map(([k]) => k)).toEqual(['005', '012', '123']);
    expect(result[0][1]).toHaveLength(2);
    expect(result[1][1]).toHaveLength(1);
    expect(result[2][1]).toHaveLength(1);
  });

  it('chapter_no 非 number 时归入"未知"分组', () => {
    const tasks = [
      makeTask({ id: 1, payload: { chapter_no: 'abc' } }),
      makeTask({ id: 2, payload: {} }),
      makeTask({ id: 3, payload: { chapter_no: null } }),
      makeTask({ id: 4, payload: { chapter_no: 7 } }),
    ];
    const result = groupTasksByChapter(tasks);
    expect(result.map(([k]) => k)).toEqual(['未知', '007']);
    expect(result[0][1]).toHaveLength(3);
    expect(result[1][1]).toHaveLength(1);
  });

  it('空数组返回空数组', () => {
    expect(groupTasksByChapter([])).toEqual([]);
  });
});

describe('isPausedFailureSummary', () => {
  function makeFailure(overrides: { status?: string; reason?: string } = {}) {
    return {
      job_id: 1,
      chapter_no: null,
      task_type: 'write',
      task_label: '写作',
      status: overrides.status ?? 'failed',
      status_label: '失败',
      reason: overrides.reason ?? '',
      next_step: '',
    };
  }

  it('status==="paused" 时返回 true', () => {
    expect(isPausedFailureSummary(makeFailure({ status: 'paused' }))).toBe(true);
  });

  it('reason 含 "paused by user"（忽略大小写）返回 true', () => {
    expect(isPausedFailureSummary(makeFailure({ reason: 'Paused By User' }))).toBe(true);
  });

  it('reason 含 "用户暂停" 返回 true', () => {
    expect(isPausedFailureSummary(makeFailure({ reason: '某用户暂停操作' }))).toBe(true);
  });

  it('reason 含 "手动暂停" 返回 true', () => {
    expect(isPausedFailureSummary(makeFailure({ reason: '因故手动暂停' }))).toBe(true);
  });

  it('普通失败原因返回 false', () => {
    expect(isPausedFailureSummary(makeFailure({ status: 'failed_terminal', reason: '模型超时' }))).toBe(false);
  });
});

describe('numberFromPayloadValue', () => {
  it('number 原样返回', () => {
    expect(numberFromPayloadValue(42, 0)).toBe(42);
  });

  it('非 number 返回 fallback', () => {
    expect(numberFromPayloadValue('x', 9)).toBe(9);
    expect(numberFromPayloadValue(undefined, 9)).toBe(9);
    expect(numberFromPayloadValue(null, 9)).toBe(9);
  });
});

describe('modeFromPayloadValue', () => {
  it.each(['review_only', 'generate_missing', 'review_fix', 'full_auto'] as const)(
    '合法 mode %s 原样返回',
    (mode) => {
      expect(modeFromPayloadValue(mode)).toBe(mode);
    },
  );

  it('非法值回退到 review_fix', () => {
    expect(modeFromPayloadValue('whatever')).toBe('review_fix');
    expect(modeFromPayloadValue(undefined)).toBe('review_fix');
  });
});

describe('generationModeFromPayloadValue', () => {
  it.each(['quality', 'fast', 'stable'] as const)('合法值 %s 原样返回', (mode) => {
    expect(generationModeFromPayloadValue(mode)).toBe(mode);
  });

  it('非法值回退到 stable', () => {
    expect(generationModeFromPayloadValue('turbo')).toBe('stable');
    expect(generationModeFromPayloadValue(null)).toBe('stable');
  });
});
