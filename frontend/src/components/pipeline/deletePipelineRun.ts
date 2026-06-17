import { ApiRequestError, apiRequest } from '../../api';

export interface DeletePipelineRunResult {
  deleted: boolean;
  run_id: number;
  deleted_child_tasks: number;
}

export async function deletePipelineRun(runId: number): Promise<DeletePipelineRunResult> {
  try {
    return await apiRequest<DeletePipelineRunResult>(`/api/pipeline/runs/${runId}/delete`, { method: 'POST' });
  } catch (error) {
    if (error instanceof ApiRequestError && [404, 405].includes(error.status)) {
      try {
        return await apiRequest<DeletePipelineRunResult>(`/api/pipeline/runs/${runId}`, { method: 'DELETE' });
      } catch (fallbackError) {
        if (fallbackError instanceof ApiRequestError && [404, 405].includes(fallbackError.status)) {
          throw new Error('删除接口不可用，请重启后端服务后再试。');
        }
        throw fallbackError;
      }
    }
    throw error;
  }
}

export function waitForDeleteFeedback(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 180));
}
