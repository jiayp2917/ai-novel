import { useEffect, useMemo, useState } from 'react';
import {
  useAnnotations,
  useCatalogStatus,
  useChapterContent,
  useChapterVersionContent,
  useChapters,
  useSourceAnnotations,
  useSourceFileContent,
} from '../../hooks';
import { useWorkbenchStore } from '../../store';
import type { ContextMenuState, SelectionRange } from '../../types';
import { sourceKindLabel } from '../../utils';
import { searchMatchCount } from '../readerUtils';

type UseReaderStateOptions = {
  variant: 'full' | 'writing';
};

export type UseReaderStateResult = ReturnType<typeof useReaderState>;

export function useReaderState({ variant }: UseReaderStateOptions) {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const selectedChapterVersionId = useWorkbenchStore((state) => state.selectedChapterVersionId);
  const setDraftAnnotationSelection = useWorkbenchStore((state) => state.setDraftAnnotationSelection);
  const setSelectedChapterVersionId = useWorkbenchStore((state) => state.setSelectedChapterVersionId);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [editing, setEditing] = useState(false);
  const [draftActive, setDraftActive] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [focusAtEndSignal, setFocusAtEndSignal] = useState(0);
  const chapters = useChapters();
  const content = useChapterContent(selectedChapterId);
  const versionContent = useChapterVersionContent(selectedChapterId, selectedChapterVersionId);
  const sourceContent = useSourceFileContent(selectedSourceFileId);
  const catalogStatus = useCatalogStatus();
  const chapterAnnotations = useAnnotations(selectedChapterId);
  const sourceAnnotations = useSourceAnnotations(selectedSourceFileId);

  const isUnparsedChapterSource = Boolean(
    sourceContent.data
    && sourceContent.data.kind === 'chapters'
    && (catalogStatus.data?.unparsed_chapter_files ?? []).includes(sourceContent.data.path),
  );
  const canShowSourceContent = variant !== 'writing' || isUnparsedChapterSource;
  const activeContent = versionContent.data
    ? {
        ...content.data,
        id: versionContent.data.chapter_id,
        title: versionContent.data.title,
        text: versionContent.data.text,
        offset_unit: 'python_code_point' as const,
      }
    : content.data ?? (canShowSourceContent ? sourceContent.data : undefined);
  const activeAnnotations = selectedChapterId
    ? chapterAnnotations.data ?? []
    : canShowSourceContent
      ? sourceAnnotations.data ?? []
      : [];
  const title = content.data
    ? `第${content.data.chapter_no}章：${versionContent.data ? `${versionContent.data.title}（历史版本）` : content.data.title}`
    : canShowSourceContent && sourceContent.data
      ? sourceContent.data.path
      : variant === 'writing'
        ? '请选择一章正文'
        : '阅读器';
  const kindLabel = content.data
    ? '正文'
    : canShowSourceContent && sourceContent.data
      ? sourceKindLabel(sourceContent.data.kind)
      : '未选择';
  const activeText = draftActive ? draftText : activeContent?.text || '';
  const matchCount = searchMatchCount(activeText, searchQuery);
  const documentKey = useMemo(
    () => content.data
      ? `chapter:${content.data.id}:${selectedChapterVersionId ?? content.data.current_version_id ?? 'none'}`
      : canShowSourceContent && sourceContent.data
        ? `source:${sourceContent.data.id}`
        : 'empty',
    [content.data, canShowSourceContent, sourceContent.data, selectedChapterVersionId],
  );
  const viewingVersion = Boolean(selectedChapterVersionId && versionContent.data);
  const dirty = Boolean(activeContent && draftActive && draftText !== activeContent.text);
  const isSourceProposal = Boolean(canShowSourceContent && sourceContent.data && sourceContent.data.kind !== 'chapters');

  useEffect(() => {
    setSelection(null);
    setDraftAnnotationSelection(undefined);
    setSelectedChapterVersionId(null, { force: true });
    setEditing(false);
    setDraftActive(false);
    setDraftText('');
    setSearchQuery('');
    setSearchIndex(0);
  }, [selectedChapterId, selectedSourceFileId, setDraftAnnotationSelection, setSelectedChapterVersionId]);

  useEffect(() => {
    setEditing(false);
    setDraftActive(false);
    setDraftText('');
    setSearchQuery('');
    setSearchIndex(0);
  }, [selectedChapterVersionId]);

  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery, documentKey]);

  return {
    selectedChapterId,
    selectedSourceFileId,
    chapters,
    content,
    versionContent,
    sourceContent,
    chapters_data: chapters.data,
    activeContent,
    activeAnnotations,
    title,
    kindLabel,
    activeText,
    matchCount,
    documentKey,
    viewingVersion,
    dirty,
    isSourceProposal,
    isUnparsedChapterSource,
    searchQuery,
    setSearchQuery,
    searchIndex,
    setSearchIndex,
    selection,
    setSelection,
    contextMenu,
    setContextMenu,
    editing,
    setEditing,
    draftActive,
    setDraftActive,
    draftText,
    setDraftText,
    focusAtEndSignal,
    setFocusAtEndSignal,
  };
}