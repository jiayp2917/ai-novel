import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api';
import { useWorkbenchStore } from '../store';
import { useToast } from '../components/ui/Toast';
import type { ModelCallCleanupResult } from '../types';

type RunJobsResult = {
  started: number;
  succeeded: number;
  failed: number;
  jobs: Array<{ id: number; status: string }>;
};

export function useModelCallActions() {
  const queryClient = useQueryClient();
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const { showToast } = useToast();

  const testConnection = useMutation({
    mutationFn: async () => {
      // placeholder: 真实调用见 useModelConfigActions.probeRole，这里保留以保持 API 形状一致
      throw new Error('testConnection 请通过 useModelConfigActions.probeRole 调用。');
    },
    onMutate: () => pushTask({ label: 'AI 连通测试', status: 'running', detail: '正在测试...' }),
    onError: (error: Error) => {
      pushTask({ label: 'AI 连通测试', status: 'failed', detail: error.message });
      showToast(`AI 连通测试失败：${error.message}`, 'error');
    },
  });

  const clearLogs = useMutation({
    mutationFn: () =>
      apiRequest<ModelCallCleanupResult>('/api/jobs/model-calls/cleanup', {
        method: 'POST',
        body: JSON.stringify({ retain_days: 30, failed_only: false, confirm_cleanup: true }),
      }),
    onMutate: () => pushTask({ label: '清理 AI 请求记录', status: 'running', detail: '正在清理 30 天前的排错记录。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['model-calls'] });
      void queryClient.invalidateQueries({ queryKey: ['model-usage-report'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      pushTask({ label: '清理 AI 请求记录', status: 'succeeded', detail: `已清理 ${result.deleted} 条 30 天前记录。` });
    },
    onError: (error: Error) => {
      pushTask({ label: '清理 AI 请求记录', status: 'failed', detail: error.message });
      showToast(`清理 AI 请求记录失败：${error.message}`, 'error');
    },
  });

  const resetStats = useMutation({
    mutationFn: () =>
      apiRequest<RunJobsResult>('/api/jobs/run-once', { method: 'POST' }),
    onMutate: () => pushTask({ label: '继续执行任务', status: 'running', detail: '正在处理待办任务。' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['model-calls'] });
      void queryClient.invalidateQueries({ queryKey: ['model-usage-report'] });
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      pushTask({
        label: '继续执行任务',
        status: result.failed ? 'failed' : 'succeeded',
        detail: `启动 ${result.started} 个任务，完成 ${result.succeeded} 个，失败 ${result.failed} 个。`,
      });
    },
    onError: (error: Error) => {
      pushTask({ label: '继续执行任务', status: 'failed', detail: error.message });
      showToast(`继续执行任务失败：${error.message}`, 'error');
    },
  });

  return {
    testConnection,
    clearLogs,
    resetStats,
  };
}
