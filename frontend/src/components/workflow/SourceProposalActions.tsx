import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import { useArtifacts } from '../../hooks';
import { useWorkbenchStore } from '../../store';
import type { Artifact, SourceFile } from '../../types';
import { ArtifactGate } from '../ArtifactGate';

export function SourceProposalActions({
  sourceFileId,
  sourceKind,
}: {
  sourceFileId: number;
  sourceKind: SourceFile['kind'];
}) {
  const [artifactId, setArtifactId] = useState<number | null>(null);
  const [diffText, setDiffText] = useState('');
  const [writingCardChapterNo, setWritingCardChapterNo] = useState('1');
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const selectedAnnotationIds = useWorkbenchStore((state) => state.selectedAnnotationIds);
  const proposals = useArtifacts({ baseSourceFileId: sourceFileId, kind: 'proposal' });
  const queryClient = useQueryClient();
  const selectedArtifact = (proposals.data ?? []).find((artifact) => artifact.id === artifactId);
  const selectedProposalChapterNo = suggestedChapterNo(selectedArtifact);
  const chapterNo = normalizedChapterNo(writingCardChapterNo, selectedProposalChapterNo);
  const canGenerateWorkProfile = sourceKind === 'settings';
  const canGenerateWritingCard = sourceKind === 'outlines';
  const canConfirmWorkProfile = selectedArtifact ? isWorkProfileProposal(selectedArtifact) && selectedArtifact.metadata.canonical !== true : false;
  const canConfirmWritingCard = selectedArtifact ? isWritingCardProposal(selectedArtifact) && selectedArtifact.metadata.canonical !== true : false;

  useEffect(() => {
    if (selectedArtifact && isWritingCardProposal(selectedArtifact)) {
      setWritingCardChapterNo(String(selectedProposalChapterNo));
    }
  }, [selectedArtifact, selectedProposalChapterNo]);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ artifact_id: number; artifact_path: string; artifact_sha256: string }>(
        `/api/source-files/${sourceFileId}/generate-proposal`,
        { method: 'POST', body: JSON.stringify({ annotation_ids: selectedAnnotationIds }) },
      ),
    onMutate: () =>
      pushTask({
        label: '生成设定/章纲提案',
        status: 'running',
        detail: selectedAnnotationIds.length
          ? `按 ${selectedAnnotationIds.length} 条批注生成提案，不自动覆盖源文件。`
          : '未勾选批注，将使用当前源文件全部可用批注生成提案。',
      }),
    onSuccess: (result) => {
      setArtifactId(result.artifact_id);
      setDiffText('');
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      pushTask({ label: '生成设定/章纲提案', status: 'succeeded', detail: '提案已创建，可查看对比后人工采纳。' });
    },
    onError: (error: Error) => pushTask({ label: '生成设定/章纲提案', status: 'failed', detail: error.message }),
  });

  const workProfileMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ artifact_id: number; artifact_path: string; artifact_sha256: string }>(
        `/api/source-files/${sourceFileId}/generate-work-profile`,
        { method: 'POST', body: JSON.stringify({ force: false }) },
      ),
    onMutate: () =>
      pushTask({
        label: '生成作品档案提案',
        status: 'running',
        detail: '正在从设定文件整理作品档案提案，确认前不会进入正式上下文。',
      }),
    onSuccess: (result) => {
      setArtifactId(result.artifact_id);
      setDiffText('');
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      pushTask({ label: '生成作品档案提案', status: 'succeeded', detail: '作品档案提案已创建，请查看后再确认。' });
    },
    onError: (error: Error) => pushTask({ label: '生成作品档案提案', status: 'failed', detail: error.message }),
  });

  const writingCardMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ artifact_id: number; artifact_path: string; artifact_sha256: string; chapter_no: number }>(
        `/api/source-files/${sourceFileId}/generate-writing-card`,
        {
          method: 'POST',
          body: JSON.stringify({ chapter_no: chapterNo, generation_mode: 'stable', force: false }),
        },
      ),
    onMutate: () =>
      pushTask({
        label: '生成单章写作卡',
        status: 'running',
        detail: `正在生成第 ${chapterNo} 章写作卡，确认前不会进入 writer 上下文。`,
      }),
    onSuccess: (result) => {
      setArtifactId(result.artifact_id);
      setDiffText('');
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      pushTask({ label: '生成单章写作卡', status: 'succeeded', detail: `第 ${result.chapter_no} 章写作卡提案已创建。` });
    },
    onError: (error: Error) => pushTask({ label: '生成单章写作卡', status: 'failed', detail: error.message }),
  });

  const confirmWorkProfileMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ memory_id: number; memory_kind: string; confirmed: boolean }>(
        `/api/source-files/work-profiles/${artifactId}/confirm`,
        { method: 'POST' },
      ),
    onMutate: () => pushTask({ label: '确认作品档案', status: 'running', detail: `正在确认提案 #${artifactId}。` }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      pushTask({ label: '确认作品档案', status: 'succeeded', detail: `已写入 ${result.memory_kind} 记忆 #${result.memory_id}。` });
    },
    onError: (error: Error) => pushTask({ label: '确认作品档案', status: 'failed', detail: error.message }),
  });

  const confirmWritingCardMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ memory_id: number; memory_kind: string; chapter_no: number; confirmed: boolean }>(
        `/api/source-files/writing-cards/${artifactId}/confirm`,
        { method: 'POST' },
      ),
    onMutate: () => pushTask({ label: '确认写作卡', status: 'running', detail: `正在确认提案 #${artifactId}。` }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
      pushTask({
        label: '确认写作卡',
        status: 'succeeded',
        detail: `第 ${result.chapter_no} 章写作卡已写入 ${result.memory_kind} 记忆 #${result.memory_id}。`,
      });
    },
    onError: (error: Error) => pushTask({ label: '确认写作卡', status: 'failed', detail: error.message }),
  });

  return (
    <section className="workflow-card">
      <div className="section-title">
        <div>
          <p className="eyebrow">设定 / 章纲提案</p>
          <h2>{artifactId ? '当前提案已创建' : '只生成提案，不直接覆盖'}</h2>
        </div>
      </div>
      <p className="form-hint">AI 素材库只负责设定和章纲资料。提案可检查、查看改动，但不会通过正文写回按钮覆盖源文件。</p>
      <div className="action-row">
        <button type="button" className="secondary-button" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          生成提案
        </button>
      </div>
      {(canGenerateWorkProfile || canGenerateWritingCard) && (
        <details className="advanced-details">
          <summary>高级生成操作</summary>
          <div className="action-row">
            {canGenerateWorkProfile && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => workProfileMutation.mutate()}
                disabled={workProfileMutation.isPending}
              >
                生成作品档案
              </button>
            )}
            {canGenerateWritingCard && (
              <>
                <label className="inline-field">
                  <span>章号</span>
                  <input
                    aria-label="写作卡章号"
                    min={1}
                    type="number"
                    value={writingCardChapterNo}
                    onChange={(event) => setWritingCardChapterNo(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => writingCardMutation.mutate()}
                  disabled={writingCardMutation.isPending}
                >
                  生成第 {chapterNo} 章写作卡
                </button>
              </>
            )}
          </div>
        </details>
      )}
      {(canConfirmWorkProfile || canConfirmWritingCard) && (
        <div className="action-row">
          {canConfirmWorkProfile && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => confirmWorkProfileMutation.mutate()}
              disabled={confirmWorkProfileMutation.isPending}
            >
              确认为作品档案
            </button>
          )}
          {canConfirmWritingCard && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => confirmWritingCardMutation.mutate()}
              disabled={confirmWritingCardMutation.isPending}
            >
              确认为写作卡
            </button>
          )}
          <span className="form-hint">确认后才会进入 AI 写作上下文；普通素材提案仍保持人工采纳。</span>
        </div>
      )}
      {selectedArtifact?.metadata.canonical === true && (
        <p className="form-hint">已确认为 {confirmedProposalLabel(selectedArtifact)}，AI 写作时会读取这份记忆。</p>
      )}
      <ArtifactGate
        artifactId={artifactId}
        setArtifactId={setArtifactId}
        diffText={diffText}
        setDiffText={setDiffText}
        baseSourceFileId={sourceFileId}
        artifactKind="proposal"
        allowPublish={false}
      />
    </section>
  );
}

function isWorkProfileProposal(artifact: Artifact): boolean {
  return artifact.metadata.purpose === 'work_profile_proposal';
}

function isWritingCardProposal(artifact: Artifact): boolean {
  return artifact.metadata.purpose === 'chapter_writing_card';
}

function confirmedProposalLabel(artifact: Artifact): string {
  if (isWorkProfileProposal(artifact)) {
    return '作品档案';
  }
  if (isWritingCardProposal(artifact)) {
    return '单章写作卡';
  }
  return '上下文素材';
}

function suggestedChapterNo(artifact: Artifact | undefined): number {
  const raw = artifact?.metadata.chapter_no;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 1;
}

function normalizedChapterNo(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}