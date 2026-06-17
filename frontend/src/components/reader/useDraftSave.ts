import { useMutation, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import { apiRequest } from '../../api';
import { useWorkbenchStore } from '../../store';
import type { ChapterContent, SourceFileContent } from '../../types';

type DraftResponse = {
  version_id?: number;
  chapter_id?: number;
  chapter_no?: number;
  source_file_id?: number;
};

type UseDraftSaveOptions = {
  chapter: ChapterContent | undefined;
  sourceFile: SourceFileContent | undefined;
  activeText: string;
  isUnparsedChapterSource: boolean;
  queryClient: QueryClient;
  onChapterVersionSaved: (versionId: number) => void;
};

type SaveDraftInput = void;

export function useDraftSave({
  chapter,
  sourceFile,
  activeText,
  isUnparsedChapterSource,
  queryClient,
  onChapterVersionSaved,
}: UseDraftSaveOptions): UseMutationResult<DraftResponse, Error, SaveDraftInput> {
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const label = chapter ? '保存正文版本' : isUnparsedChapterSource ? '保存文件草稿' : '保存提案';
  const runningDetail = chapter
    ? '正在保存为新的正文版本，不会直接覆盖正式正文。'
    : isUnparsedChapterSource
      ? '正在保存为文件草稿，不会直接覆盖源文件。'
      : '正在保存为提案，不会覆盖源文件。';

  return useMutation({
    mutationFn: () => {
      if (chapter) {
        return apiRequest<DraftResponse>(`/api/chapters/${chapter.id}/draft-candidate`, {
          method: 'POST',
          body: JSON.stringify({ text: activeText }),
        });
      }
      if (sourceFile && (sourceFile.kind !== 'chapters' || isUnparsedChapterSource)) {
        return apiRequest<DraftResponse>(`/api/source-files/${sourceFile.id}/draft-proposal`, {
          method: 'POST',
          body: JSON.stringify({ text: activeText }),
        });
      }
      throw new Error('当前文档不能保存为候选');
    },
    onMutate: () => pushTask({ label, status: 'running', detail: runningDetail }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['chapter-versions'] });
      if (chapter && result.version_id) {
        onChapterVersionSaved(result.version_id);
      }
      pushTask({
        label,
        status: 'succeeded',
        detail: chapter
          ? '正文版本已保存，可切换查看、发布或删除。'
          : isUnparsedChapterSource
            ? '文件草稿已保存。补充章号和标题并转为章节后，才能进入正文版本流程。'
            : '提案已保存。需要检查和对比时，请到 AI 素材库或 AI 工作台处理。',
      });
    },
    onError: (error: Error) => pushTask({ label, status: 'failed', detail: error.message }),
  });
}