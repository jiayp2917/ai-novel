import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, queryClient } from '../../api';
import { useToast } from '../ui/Toast';
import { useWorkbenchStore } from '../../store';
import type { PipelineRun, PipelineRunCreatePayload } from '../../types';
import { nextStepForRun, statusText, summarizeRun } from './pipelineUtils';
import { deletePipelineRun, waitForDeleteFeedback, type DeletePipelineRunResult } from './deletePipelineRun';

export type MutateAction = 'pause' | 'resume' | 'retry' | 'cancel';

export interface PipelineMutations {
  form: PipelineRunCreatePayload;
  setForm: (next: PipelineRunCreatePayload) => void;
  selectedRunId: number | null;
  setSelectedRunId: (id: number | null) => void;
  pendingDeleteRun: PipelineRun | null;
  setPendingDeleteRun: (run: PipelineRun | null) => void;
  deleteDialogError: string | null;
  setDeleteDialogError: (message: string | null) => void;

  createRun: { isPending: boolean; mutate: () => void };
  mutateRun: { isPending: boolean; mutate: (params: { runId: number; action: MutateAction }) => void };
  deleteRun: { isPending: boolean; mutate: (runId: number) => void };
  runJobsMutation: { isPending: boolean; mutate: () => void };
}

export function usePipelineMutations(form: PipelineRunCreatePayload, setForm: (next: PipelineRunCreatePayload) => void): Omit<PipelineMutations, 'form' | 'setForm'> & { setForm: (next: PipelineRunCreatePayload) => void; form: PipelineRunCreatePayload } {
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const { showToast } = useToast();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [pendingDeleteRun, setPendingDeleteRun] = useState<PipelineRun | null>(null);
  const [deleteDialogError, setDeleteDialogError] = useState<string | null>(null);

  const createRun = useMutation({
    mutationFn: () =>
      apiRequest<PipelineRun>('/api/pipeline/runs', {
        method: 'POST',
        body: JSON.stringify({ ...form, dry_run: true }),
      }),
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      pushTask({ label: '自动流水线', status: 'succeeded', detail: `已创建第 ${form.start_chapter}-${form.end_chapter} 章任务。` });
    },
    onError: (error: Error) => {
      pushTask({ label: '自动流水线', status: 'failed', detail: error.message });
      showToast(`创建流水线任务失败：${error.message}`, 'error');
    },
  });

  const mutateRun = useMutation({
    mutationFn: ({ runId, action }: { runId: number; action: MutateAction }) =>
      apiRequest<PipelineRun>(`/api/pipeline/runs/${runId}/${action}`, { method: 'POST' }),
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      pushTask({
        label: '自动流水线',
        status: 'succeeded',
        detail: `流水线 #${run.id}：${statusText(run.status)}。${nextStepForRun(run, summarizeRun(run)).text}`,
      });
    },
    onError: (error: Error) => {
      pushTask({ label: '自动流水线', status: 'failed', detail: error.message });
      showToast(`操作流水线失败：${error.message}`, 'error');
    },
  });

  const deleteRun = useMutation({
    mutationFn: async (runId: number): Promise<DeletePipelineRunResult> => {
      const [result] = await Promise.all([deletePipelineRun(runId), waitForDeleteFeedback()]);
      return result;
    },
    onMutate: (runId) => {
      setDeleteDialogError(null);
      pushTask({ label: '删除流水线记录', status: 'running', detail: `正在删除流水线 #${runId} 的任务记录。` });
    },
    onSuccess: (result) => {
      setPendingDeleteRun(null);
      setDeleteDialogError(null);
      setSelectedRunId(null);
      queryClient.setQueryData<PipelineRun[]>(['pipeline-runs'], (current) =>
        current ? current.filter((run) => run.id !== result.run_id) : current,
      );
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      pushTask({
        label: '删除流水线记录',
        status: 'succeeded',
        detail: `已删除流水线 #${result.run_id} 和 ${result.deleted_child_tasks} 个步骤记录。草稿、报告和日志已保留。`,
      });
    },
    onError: (error: Error) => {
      setDeleteDialogError(error.message);
      pushTask({ label: '删除流水线记录', status: 'failed', detail: error.message });
      showToast(`删除流水线记录失败：${error.message}`, 'error');
    },
  });

  const runJobsMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ started: number; succeeded: number; failed: number }>('/api/jobs/run-once', { method: 'POST' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-dashboard'] });
      pushTask({
        label: '推进自动流水线',
        status: result.failed ? 'failed' : 'succeeded',
        detail: `本次启动 ${result.started} 个任务，完成 ${result.succeeded} 个，失败 ${result.failed} 个。`,
      });
    },
    onError: (error: Error) => {
      pushTask({ label: '推进自动流水线', status: 'failed', detail: error.message });
      showToast(`推进自动流水线失败：${error.message}`, 'error');
    },
  });

  return {
    form,
    setForm,
    selectedRunId,
    setSelectedRunId,
    pendingDeleteRun,
    setPendingDeleteRun,
    deleteDialogError,
    setDeleteDialogError,
    createRun,
    mutateRun,
    deleteRun,
    runJobsMutation,
  };
}
