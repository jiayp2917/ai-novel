// JobList 内部使用的状态汇总映射（只在此处使用，不迁入 lib/）
export const safeJobStatuses = ['succeeded', 'done', 'approved'] as const;
export const failedJobStatuses = ['failed', 'failed_terminal', 'failed_retryable'] as const;