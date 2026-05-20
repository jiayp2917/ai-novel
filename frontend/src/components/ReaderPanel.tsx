import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';
import {
  useChapters,
  useAnnotations,
  useCatalogStatus,
  useChapterContent,
  useChapterVersionContent,
  useSourceAnnotations,
  useSourceFileContent,
} from '../hooks';
import { useWorkbenchStore } from '../store';
import type { ContextMenuState, SelectionRange } from '../types';
import { sourceKindLabel } from '../utils';
import { ChapterEditor } from './Editor';
import { ReaderContextMenu } from './ReaderContextMenu';
import { ReaderSearchBar, ReaderToolbar } from './ReaderToolbar';
import { placeContextMenu, searchMatchCount } from './readerUtils';

type DraftResponse = {
  version_id?: number;
  chapter_id?: number;
  chapter_no?: number;
  source_file_id?: number;
};

export function ReaderPanel({ variant = 'full' }: { showActions?: boolean; variant?: 'full' | 'writing' }) {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const openChapterTabIds = useWorkbenchStore((state) => state.openChapterTabIds);
  const selectedAnnotationId = useWorkbenchStore((state) => state.selectedAnnotationId);
  const selectedChapterVersionId = useWorkbenchStore((state) => state.selectedChapterVersionId);
  const writingFullscreen = useWorkbenchStore((state) => state.writingFullscreen);
  const setRightPanelOpen = useWorkbenchStore((state) => state.setRightPanelOpen);
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen);
  const catalogPanelOpen = useWorkbenchStore((state) => state.catalogPanelOpen);
  const setCatalogPanelOpen = useWorkbenchStore((state) => state.setCatalogPanelOpen);
  const setWritingFullscreen = useWorkbenchStore((state) => state.setWritingFullscreen);
  const setSelectedChapterId = useWorkbenchStore((state) => state.setSelectedChapterId);
  const setSelectedChapterVersionId = useWorkbenchStore((state) => state.setSelectedChapterVersionId);
  const recentChapterIds = useWorkbenchStore((state) => state.recentChapterIds);
  const closeChapterTab = useWorkbenchStore((state) => state.closeChapterTab);
  const setDraftAnnotationSelection = useWorkbenchStore((state) => state.setDraftAnnotationSelection);
  const setInspectorTab = useWorkbenchStore((state) => state.setInspectorTab);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [editing, setEditing] = useState(false);
  const [draftActive, setDraftActive] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [focusAtEndSignal, setFocusAtEndSignal] = useState(0);
  const [jumpValue, setJumpValue] = useState('');
  const queryClient = useQueryClient();
  const chapters = useChapters();
  const content = useChapterContent(selectedChapterId);
  const versionContent = useChapterVersionContent(selectedChapterId, selectedChapterVersionId);
  const sourceContent = useSourceFileContent(selectedSourceFileId);
  const catalogStatus = useCatalogStatus();
  const chapterAnnotations = useAnnotations(selectedChapterId);
  const sourceAnnotations = useSourceAnnotations(selectedSourceFileId);
  const activeContent = versionContent.data
    ? {
        ...content.data,
        id: versionContent.data.chapter_id,
        title: versionContent.data.title,
        text: versionContent.data.text,
        offset_unit: 'python_code_point' as const,
      }
    : content.data ?? sourceContent.data;
  const activeAnnotations = selectedChapterId ? chapterAnnotations.data ?? [] : sourceAnnotations.data ?? [];
  const title = content.data
    ? `第${content.data.chapter_no}章：${versionContent.data ? `${versionContent.data.title}（历史版本）` : content.data.title}`
    : sourceContent.data?.path ?? '阅读器';
  const kindLabel = content.data ? '正文' : sourceContent.data ? sourceKindLabel(sourceContent.data.kind) : '未选择';
  const activeText = draftActive ? draftText : activeContent?.text || '';
  const matchCount = searchMatchCount(activeText, searchQuery);
  const documentKey = content.data
    ? `chapter:${content.data.id}:${selectedChapterVersionId ?? content.data.current_version_id ?? 'none'}:${draftActive ? 'draft' : 'source'}`
    : sourceContent.data
      ? `source:${sourceContent.data.id}:${draftActive ? 'draft' : 'source'}`
      : 'empty';
  const viewingVersion = Boolean(selectedChapterVersionId && versionContent.data);
  const dirty = Boolean(activeContent && draftActive && draftText !== activeContent.text);
  const isSourceProposal = Boolean(sourceContent.data && sourceContent.data.kind !== 'chapters');
  const isUnparsedChapterSource = Boolean(
    sourceContent.data
    && sourceContent.data.kind === 'chapters'
    && (catalogStatus.data?.unparsed_chapter_files ?? []).includes(sourceContent.data.path),
  );

  const startEditing = () => {
    if (!activeContent) {
      return;
    }
    if (!draftActive) {
      setDraftText(activeContent.text);
      setDraftActive(true);
    }
    setSearchQuery('');
    setSearchIndex(0);
    setEditing(true);
    setFocusAtEndSignal((value) => value + 1);
  };

  const toggleCatalog = () => {
    const next = !catalogPanelOpen;
    setCatalogPanelOpen(next);
    pushTask({ label: next ? '打开目录' : '隐藏目录', status: 'succeeded', detail: next ? '左侧目录已显示。' : '左侧目录已隐藏，正文区域已扩大。' });
  };

  const toggleFullscreen = () => {
    const next = !writingFullscreen;
    setWritingFullscreen(next);
    pushTask({ label: next ? '进入全屏写作' : '退出全屏写作', status: 'succeeded', detail: next ? '已隐藏目录和右侧栏。' : '已恢复标准写作布局。' });
  };

  const toggleRightPanel = () => {
    const next = !rightPanelOpen;
    setRightPanelOpen(next);
    pushTask({ label: next ? '打开右侧栏' : '收起右侧栏', status: 'succeeded', detail: next ? '批注、版本和记忆栏已显示。' : '右侧栏已隐藏，正文区域已扩大。' });
  };

  useEffect(() => {
    setSelection(null);
    setContextMenu(null);
    setDraftAnnotationSelection(undefined);
    setSelectedChapterVersionId(null);
    setEditing(false);
    setDraftActive(false);
    setDraftText('');
    setSearchQuery('');
    setSearchIndex(0);
  }, [selectedChapterId, selectedSourceFileId]);

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

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, []);

  const saveDraftMutation = useMutation({
    mutationFn: () => {
      if (content.data) {
        return apiRequest<DraftResponse>(`/api/chapters/${content.data.id}/draft-candidate`, {
          method: 'POST',
          body: JSON.stringify({ text: activeText }),
        });
      }
      if (sourceContent.data && (sourceContent.data.kind !== 'chapters' || isUnparsedChapterSource)) {
        return apiRequest<DraftResponse>(`/api/source-files/${sourceContent.data.id}/draft-proposal`, {
          method: 'POST',
          body: JSON.stringify({ text: activeText }),
        });
      }
      throw new Error('当前文档不能保存为候选');
    },
    onMutate: () =>
      pushTask({
        label: content.data ? '保存正文版本' : isUnparsedChapterSource ? '保存文件草稿' : '保存提案',
        status: 'running',
        detail: content.data
          ? '正在保存为新的正文版本，不会直接覆盖正式正文。'
          : isUnparsedChapterSource
            ? '正在保存为文件草稿，不会直接覆盖源文件。'
            : '正在保存为提案，不会覆盖源文件。',
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      void queryClient.invalidateQueries({ queryKey: ['chapter-versions'] });
      if (content.data && result.version_id) {
        setRightPanelOpen(true);
        setInspectorTab('history');
        setSelectedChapterVersionId(result.version_id);
        setEditing(false);
        setDraftActive(false);
        setDraftText('');
      }
      pushTask({
        label: content.data ? '保存正文版本' : isUnparsedChapterSource ? '保存文件草稿' : '保存提案',
        status: 'succeeded',
        detail: content.data
          ? '正文版本已保存，可切换查看、发布或删除。'
          : isUnparsedChapterSource
            ? '文件草稿已保存。补充章号和标题并转为章节后，才能进入正文版本流程。'
            : '提案已保存。需要检查和对比时，请到 AI 素材库或 AI 工作台处理。',
      });
    },
    onError: (error: Error) =>
      pushTask({
        label: content.data ? '保存正文版本' : isUnparsedChapterSource ? '保存文件草稿' : '保存提案',
        status: 'failed',
        detail: error.message,
      }),
  });

  const canSaveDraft = Boolean(activeContent && activeText.trim() && (content.data || isSourceProposal || isUnparsedChapterSource));
  const menuSelection = contextMenu?.selection ?? selection;
  const canAnnotateSelection = Boolean(activeContent && !dirty);
  const readerClasses = useMemo(
    () => ['panel', 'reader-panel', editing ? 'reader-panel--editing' : ''].filter(Boolean).join(' '),
    [editing],
  );
  const tabChapters = useMemo(
    () => openChapterTabIds
      .map((id) => chapters.data?.find((chapter) => chapter.id === id))
      .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter)),
    [chapters.data, openChapterTabIds],
  );
  const sortedChapters = useMemo(
    () => [...(chapters.data ?? [])].sort((a, b) => a.chapter_no - b.chapter_no),
    [chapters.data],
  );
  const currentChapterIndex = selectedChapterId === null ? -1 : sortedChapters.findIndex((chapter) => chapter.id === selectedChapterId);
  const previousChapter = currentChapterIndex > 0 ? sortedChapters[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex >= 0 && currentChapterIndex < sortedChapters.length - 1 ? sortedChapters[currentChapterIndex + 1] : null;
  const recentChapters = useMemo(
    () => recentChapterIds
      .map((id) => chapters.data?.find((chapter) => chapter.id === id))
      .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter))
      .slice(0, 5),
    [chapters.data, recentChapterIds],
  );

  const jumpToChapter = () => {
    const normalized = jumpValue.trim();
    if (!normalized) {
      return;
    }
    const numeric = Number.parseInt(normalized, 10);
    const target = sortedChapters.find((chapter) =>
      Number.isFinite(numeric)
        ? chapter.chapter_no === numeric
        : chapter.title.includes(normalized),
    );
    if (!target) {
      pushTask({ label: '章节跳转', status: 'failed', detail: `没有找到“${normalized}”对应的章节。` });
      return;
    }
    setSelectedChapterId(target.id);
    setJumpValue('');
    pushTask({ label: '章节跳转', status: 'succeeded', detail: `已打开第 ${target.chapter_no} 章：${target.title}` });
  };

  return (
    <main className={readerClasses}>
      {variant === 'writing' && tabChapters.length > 0 && (
        <div className="chapter-tabs" aria-label="已打开章节">
          {tabChapters.map((chapter) => (
            <button
              className={chapter.id === selectedChapterId ? 'chapter-tab chapter-tab--active' : 'chapter-tab'}
              key={chapter.id}
              type="button"
              onClick={() => setSelectedChapterId(chapter.id)}
            >
              <span>{String(chapter.chapter_no).padStart(3, '0')}</span>
              <strong>{chapter.title}</strong>
              <em
                role="button"
                tabIndex={0}
                aria-label={`关闭第${chapter.chapter_no}章`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeChapterTab(chapter.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeChapterTab(chapter.id);
                  }
                }}
              >
                ×
              </em>
            </button>
          ))}
        </div>
      )}
      <ReaderToolbar
        variant={variant}
        kindLabel={kindLabel}
        title={title}
        editing={editing}
        draftActive={draftActive}
        activeContentExists={Boolean(activeContent)}
        activeTextLength={activeText.length}
        annotationCount={activeAnnotations.length}
        dirty={dirty}
        viewingVersion={viewingVersion}
        unparsedChapterSource={isUnparsedChapterSource}
        writingFullscreen={writingFullscreen}
        catalogPanelOpen={catalogPanelOpen}
        rightPanelOpen={rightPanelOpen}
        jumpValue={jumpValue}
        previousChapter={previousChapter}
        nextChapter={nextChapter}
        recentChapters={recentChapters}
        canSaveDraft={canSaveDraft}
        savingDraft={saveDraftMutation.isPending}
        onSetEditing={setEditing}
        onStartEditing={startEditing}
        onDiscardDraft={() => {
          setDraftActive(false);
          setDraftText('');
          setEditing(false);
        }}
        onJumpValueChange={setJumpValue}
        onJumpToChapter={jumpToChapter}
        onSelectChapter={setSelectedChapterId}
        onToggleCatalog={toggleCatalog}
        onToggleFullscreen={toggleFullscreen}
        onSaveDraft={() => saveDraftMutation.mutate()}
        onToggleRightPanel={toggleRightPanel}
        onBackToCurrentVersion={() => setSelectedChapterVersionId(null)}
      />
      {(content.error || sourceContent.error || versionContent.error) && (
        <div className="inline-error">
          {(content.error as Error)?.message ?? (sourceContent.error as Error)?.message ?? (versionContent.error as Error)?.message}
        </div>
      )}
      {variant === 'writing' && (
        <ReaderSearchBar
          searchQuery={searchQuery}
          matchCount={matchCount}
          onSearchQueryChange={setSearchQuery}
          onPrevious={() => setSearchIndex((value) => Math.max(0, value - 1))}
          onNext={() => setSearchIndex((value) => (matchCount > 0 ? (value + 1) % matchCount : 0))}
          onClear={() => setSearchQuery('')}
        />
      )}
      <div className="reader-content">
        <ChapterEditor
          content={activeContent ? { text: activeText } : undefined}
          documentKey={documentKey}
          annotations={activeAnnotations}
          selectedAnnotationId={selectedAnnotationId}
          searchQuery={searchQuery}
          searchIndex={searchIndex}
          editable={editing}
          focusAtEndSignal={focusAtEndSignal}
          onSelectionChange={setSelection}
          onTextChange={setDraftText}
          onContextMenu={(menu) => {
            const placedMenu = placeContextMenu(menu);
            setContextMenu(placedMenu);
            setSelection(menu?.selection ?? null);
          }}
        />
      </div>
      <ReaderContextMenu
        menu={contextMenu}
        selection={menuSelection}
        dirty={dirty}
        canAnnotateSelection={canAnnotateSelection}
        canSaveDraft={canSaveDraft}
        savingDraft={saveDraftMutation.isPending}
        onCreateAnnotation={() => {
          setDraftAnnotationSelection(menuSelection);
          setInspectorTab('annotations');
          setRightPanelOpen(true);
          setContextMenu(null);
        }}
        onStartEditing={startEditing}
        onSaveDraft={() => saveDraftMutation.mutate()}
        onOpenSidebar={() => setRightPanelOpen(true)}
      />
    </main>
  );
}
