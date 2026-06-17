import type { PipelineRun } from '../../types';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { deleteBlockReason, summarizeRun } from './pipelineUtils';

export interface PipelineDeleteDialogProps {
  run: PipelineRun | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PipelineDeleteDialog({ run, busy, error, onCancel, onConfirm }: PipelineDeleteDialogProps) {
  if (!run) {
    return null;
  }
  const summary = summarizeRun(run);
  const blockedReason = deleteBlockReason(run);
  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onCancel}
      title="确认删除流水线记录"
      mark="删"
      markVariant="delete"
      className="pipeline-delete-dialog"
    >
      <p>
        删除流水线 #{run.id} 的任务列表和 {summary.total} 个步骤记录？这不会删除草稿、报告、模型日志或正文。
      </p>
      <div className="notice danger">删除后列表中不再显示这条任务；已生成的产物仍保留在运行记录中。</div>
      {blockedReason && <div className="notice danger" role="alert">{blockedReason}</div>}
      {error && <div className="notice danger" role="alert">{error}</div>}
      <div className="confirm-dialog__actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          取消
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy || Boolean(blockedReason)} loading={busy}>
          {busy ? '删除中...' : '确认删除'}
        </Button>
      </div>
    </Dialog>
  );
}
