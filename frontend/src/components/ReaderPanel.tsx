import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api';
import {
  useChapters,
  useAnnotations,
  useChapterContent,
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
  artifact_id: number;
  artifact_path: string;
  artifact_sha256: string;
  chapter_id?: number;
  chapter_no?: number;
  source_file_id?: number;
};

export function ReaderPanel({ variant = 'full' }: { showActions?: boolean; variant?: 'full' | 'writing' }) {
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const openChapterTabIds = useWorkbenchStore((state) => state.openChapterTabIds);
  const selectedAnnotationId = useWorkbenchStore((state) => state.selectedAnnotationId);
  const writingFullscreen = useWorkbenchStore((state) => state.writingFullscreen);
  const setRightPanelOpen = useWorkbenchStore((state) => state.setRightPanelOpen);
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen);
  const catalogPanelOpen = useWorkbenchStore((state) => state.catalogPanelOpen);
  const setCatalogPanelOpen = useWorkbenchStore((state) => state.setCatalogPanelOpen);
  const setWritingFullscreen = useWorkbenchStore((state) => state.setWritingFullscreen);
  const setSelectedChapterId = useWorkbenchStore((state) => state.setSelectedChapterId);
  const recentChapterIds = useWorkbenchStore((state) => state.recentChapterIds);
  const closeChapterTab = useWorkbenchStore((state) => state.closeChapterTab);
  const setDraftAnnotationSelection = useWorkbenchStore((state) => state.setDraftAnnotationSelection);
  const setActiveArtifactId = useWorkbenchStore((state) => state.setActiveArtifactId);
  const setInspectorTab = useWorkbenchStore((state) => state.setInspectorTab);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [editing, setEditing] = useState(false);
  const [draftActive, setDraftActive] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [jumpValue, setJumpValue] = useState('');
  const queryClient = useQueryClient();
  const chapters = useChapters();
  const content = useChapterContent(selectedChapterId);
  const sourceContent = useSourceFileContent(selectedSourceFileId);
  const chapterAnnotations = useAnnotations(selectedChapterId);
  const sourceAnnotations = useSourceAnnotations(selectedSourceFileId);
  const activeContent = content.data ?? sourceContent.data;
  const activeAnnotations = selectedChapterId ? chapterAnnotations.data ?? [] : sourceAnnotations.data ?? [];
  const title = content.data
    ? `第${content.data.chapter_no}章：${content.data.title}`
    : sourceContent.data?.path ?? '阅读器';
  const kindLabel = content.data ? '正文' : sourceContent.data ? sourceKindLabel(sourceContent.data.kind) : '未选择';
  const activeText = draftActive ? draftText : activeContent?.text || '';
  const matchCount = searchMatchCount(activeText, searchQuery);
  const documentKey = content.data
    ? `chapter:${content.data.id}:${content.data.current_version_id ?? 'none'}:${draftActive ? 'draft' : 'source'}`
    : sourceContent.data
      ? `source:${sourceContent.data.id}:${draftActive ? 'draft' : 'source'}`
      : 'empty';
  const dirty = Boolean(activeContent && draftActive && draftText !== activeContent.text);
  const isSourceProposal = Boolean(sourceContent.data && sourceContent.data.kind !== 'chapters');

  const startEditing = () => {
    if (!activeContent) {
      return;
    }
    if (!draftActive) {
      setDraftText(activeContent.text);
      setDraftActive(true);
    }
    setEditing(true);
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
    pushTask({ label: next ? '打开右侧栏' : '收起右侧栏', status: 'succeeded', detail: next ? '批注、候选和记忆栏已显示。' : '右侧栏已隐藏，正文区域已扩大。' });
  };

  useEffect(() => {
    setSelection(null);
    setContextMenu(null);
    setDraftAnnotationSelection(undefined);
    setEditing(false);
    setDraftActive(false);
    setDraftText('');
    setSearchQuery('');
    setSearchIndex(0);
  }, [selectedChapterId, selectedSourceFileId]);

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
      if (sourceContent.data && sourceContent.data.kind !== 'chapters') {
        return apiRequest<DraftResponse>(`/api/source-files/${sourceContent.data.id}/draft-proposal`, {
          method: 'POST',
          body: JSON.stringify({ text: activeText }),
        });
      }
      throw new Error('当前文档不能保存为候选');
    },
    onMutate: () =>
      pushTask({
        label: content.data ? '保存草稿' : '保存提案',
        status: 'running',
        detail: '正在保存到草稿箱，不会覆盖正式正文。',
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      setActiveArtifactId(result.artifact_id);
      pushTask({
        label: content.data ? '保存草稿' : '保存提案',
        status: 'succeeded',
        detail: content.data ? `草稿 #${result.artifact_id} 已保存。需要检查、查看改动或写回时，请到 AI 工作台处理。` : `提案 #${result.artifact_id} 已保存。需要检查和对比时，请到资料库或 AI 工作台处理。`,
      });
    },
    onError: (error: Error) =>
      pushTask({
        label: content.data ? '保存草稿' : '保存提案',
        status: 'failed',
        detail: error.message,
      }),
  });

  const snapshotMutation = useMutation({
    mutationFn: () =>
      apiRequest<DraftResponse>(`/api/chapters/${content.data?.id}/snapshot-candidate`, {
        method: 'POST',
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      setActiveArtifactId(result.artifact_id);
      pushTask({ label: '生成审核快照', status: 'succeeded', detail: `候选 #${result.artifact_id} 已创建。请到 AI 工作台检查或写回。` });
    },
    onError: (error: Error) => pushTask({ label: '生成审核快照', status: 'failed', detail: error.message }),
  });

  const canSaveDraft = Boolean(activeContent && activeText.trim() && (content.data || isSourceProposal));
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
        writingFullscreen={writingFullscreen}
        catalogPanelOpen={catalogPanelOpen}
        rightPanelOpen={rightPanelOpen}
        jumpValue={jumpValue}
        previousChapter={previousChapter}
        nextChapter={nextChapter}
        recentChapters={recentChapters}
        canSaveDraft={canSaveDraft}
        savingDraft={saveDraftMutation.isPending}
        hasChapter={Boolean(content.data)}
        snapshotting={snapshotMutation.isPending}
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
        onSnapshot={() => snapshotMutation.mutate()}
        onToggleRightPanel={toggleRightPanel}
      />
      {(content.error || sourceContent.error) && (
        <div className="inline-error">{(content.error as Error)?.message ?? (sourceContent.error as Error)?.message}</div>
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
        hasChapter={Boolean(content.data)}
        savingDraft={saveDraftMutation.isPending}
        snapshotting={snapshotMutation.isPending}
        onCreateAnnotation={() => {
          setDraftAnnotationSelection(menuSelection);
          setInspectorTab('annotations');
          setRightPanelOpen(true);
          setContextMenu(null);
        }}
        onStartEditing={startEditing}
        onSaveDraft={() => saveDraftMutation.mutate()}
        onSnapshot={() => snapshotMutation.mutate()}
        onOpenSidebar={() => setRightPanelOpen(true)}
      />
    </main>
  );
}
