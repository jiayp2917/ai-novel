import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useWorkbenchStore } from '../store';
import { ChapterEditor } from './Editor';
import { ChapterTabs } from './reader/ChapterTabs';
import { DirtyGuard } from './reader/DirtyGuard';
import { ReaderContextMenu } from './reader/ReaderContextMenu';
import { ReaderHeader } from './reader/ReaderHeader';
import { ReaderSearchBar } from './reader/ReaderSearchBar';
import { useDraftSave } from './reader/useDraftSave';
import { useReaderActions } from './reader/useReaderActions';
import { useReaderNavigation } from './reader/useReaderNavigation';
import { useReaderPanelState } from './reader/useReaderPanelState';
import { placeContextMenu } from './readerUtils';

export function ReaderPanel({ variant = 'full' }: { showActions?: boolean; variant?: 'full' | 'writing' }) {
  const queryClient = useQueryClient();
  const writingFullscreen = useWorkbenchStore((state) => state.writingFullscreen);
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen);
  const catalogPanelOpen = useWorkbenchStore((state) => state.catalogPanelOpen);
  const setSelectedChapterVersionId = useWorkbenchStore((state) => state.setSelectedChapterVersionId);
  const setWritingNavigationGuard = useWorkbenchStore((state) => state.setWritingNavigationGuard);
  const closeChapterTab = useWorkbenchStore((state) => state.closeChapterTab);
  const closeOtherChapterTabs = useWorkbenchStore((state) => state.closeOtherChapterTabs);
  const closeAllChapterTabs = useWorkbenchStore((state) => state.closeAllChapterTabs);
  const setDraftAnnotationSelection = useWorkbenchStore((state) => state.setDraftAnnotationSelection);
  const setInspectorTab = useWorkbenchStore((state) => state.setInspectorTab);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const selectedAnnotationId = useWorkbenchStore((state) => state.selectedAnnotationId);
  const annotationJumpSignal = useWorkbenchStore((state) => state.annotationJumpSignal);

  const panel = useReaderPanelState({ variant });
  // useReaderPanelState 内部已经调用 useReaderState 并把结果作为 detail 暴露。
  // 必须复用这一份实例，不能再单独调用 useReaderState：searchQuery / draftText 等
  // 是 hook 内的本地 useState，调用两次会得到两份互不同步的 state，导致搜索栏写入的
  // 搜索词与编辑器读取的搜索词不是同一份（搜索高亮失效）。
  const state = panel.detail;
  const nav = useReaderNavigation(state.chapters_data);
  const actions = useReaderActions(state);

  const saveDraftMutation = useDraftSave({
    chapter: state.content.data,
    sourceFile: state.sourceContent.data,
    activeText: state.activeText,
    isUnparsedChapterSource: state.isUnparsedChapterSource,
    queryClient,
    onChapterVersionSaved: (versionId) => {
      useWorkbenchStore.getState().setRightPanelOpen(true);
      setInspectorTab('history');
      state.setEditing(false);
      state.setDraftActive(false);
      state.setDraftText('');
      setSelectedChapterVersionId(versionId, { force: true });
    },
  });

  const canSaveDraft = Boolean(state.activeContent && state.activeText.trim() && (state.content.data || state.isSourceProposal || state.isUnparsedChapterSource));
  const menuSelection = state.contextMenu?.selection ?? state.selection;
  const canAnnotateSelection = Boolean(state.activeContent && !state.dirty);

  const readerClasses = useMemo(
    () => ['panel', 'reader-panel', state.editing ? 'reader-panel--editing' : ''].filter(Boolean).join(' '),
    [state.editing],
  );

  const openRightPanel = () => useWorkbenchStore.getState().setRightPanelOpen(true);

  return (
    <main className={readerClasses}>
      <DirtyGuard
        isDirty={state.dirty}
        onConfirm={() =>
          setWritingNavigationGuard(() => window.confirm('当前正文版本还未保存，切换章节或版本会丢失这次修改。是否继续？'))
        }
        onCancel={() => setWritingNavigationGuard(null)}
      />
      {variant === 'writing' && (
        <ChapterTabs
          chapters={nav.tabChapters}
          activeId={state.selectedChapterId}
          onSelect={nav.selectChapter}
          onCloseTab={closeChapterTab}
          onCloseOtherTabs={closeOtherChapterTabs}
          onCloseAllTabs={() => closeAllChapterTabs()}
        />
      )}
      <ReaderHeader
        kindLabel={state.kindLabel}
        title={state.title}
        activeContentExists={Boolean(state.activeContent)}
        activeTextLength={state.activeText.length}
        annotationCount={state.activeAnnotations.length}
        editing={state.editing}
        dirty={state.dirty}
        viewingVersion={state.viewingVersion}
        unparsedChapterSource={state.isUnparsedChapterSource}
        writingFullscreen={writingFullscreen}
        variant={variant}
        catalogPanelOpen={catalogPanelOpen}
        rightPanelOpen={rightPanelOpen}
        draftActive={state.draftActive}
        jumpValue={nav.jumpValue}
        previousChapter={nav.previousChapter}
        nextChapter={nav.nextChapter}
        recentChapters={nav.recentChapters}
        canSaveDraft={canSaveDraft}
        savingDraft={saveDraftMutation.isPending}
        onToggleEdit={actions.startEditing}
        onSetEditing={state.setEditing}
        onDiscardDraft={actions.discardDraft}
        onBackToCurrentVersion={() => setSelectedChapterVersionId(null)}
        onToggleCatalog={actions.toggleCatalog}
        onToggleFullscreen={actions.toggleFullscreen}
        onToggleRightPanel={actions.toggleRightPanel}
        onJumpValueChange={nav.setJumpValue}
        onJumpToChapter={nav.jumpToChapter}
        onSelectChapter={nav.selectChapter}
        onSaveDraft={() => saveDraftMutation.mutate()}
      />
      {(state.content.error || state.sourceContent.error || state.versionContent.error) && (
        <div className="inline-error">
          {(state.content.error as Error)?.message ?? (state.sourceContent.error as Error)?.message ?? (state.versionContent.error as Error)?.message}
        </div>
      )}
      {variant === 'writing' && (
        <ReaderSearchBar
          query={panel.state.search}
          matchCount={state.matchCount}
          onQueryChange={panel.actions.setSearch}
          onPrev={panel.actions.prevMatch}
          onNext={panel.actions.nextMatch}
        />
      )}
      <div className="reader-content">
        <ChapterEditor
          content={state.activeContent ? { text: state.activeText } : undefined}
          documentKey={state.documentKey}
          annotations={state.activeAnnotations}
          selectedAnnotationId={selectedAnnotationId}
          searchQuery={state.searchQuery}
          searchIndex={state.searchIndex}
          editable={state.editing}
          focusAtEndSignal={state.focusAtEndSignal}
          annotationJumpSignal={annotationJumpSignal}
          onSelectionChange={state.setSelection}
          onTextChange={state.setDraftText}
          onAnnotationJumpFailure={(message) => pushTask({ label: '定位批注', status: 'failed', detail: message })}
          onContextMenu={(menu) => {
            const placedMenu = placeContextMenu(menu);
            state.setContextMenu(placedMenu);
            state.setSelection(menu?.selection ?? null);
          }}
        />
      </div>
      <ReaderContextMenu
        menu={state.contextMenu}
        selection={menuSelection}
        dirty={state.dirty}
        canAnnotateSelection={canAnnotateSelection}
        canSaveDraft={canSaveDraft}
        savingDraft={saveDraftMutation.isPending}
        onCreateAnnotation={() => {
          setDraftAnnotationSelection(menuSelection);
          setInspectorTab('annotations');
          openRightPanel();
          state.setContextMenu(null);
        }}
        onStartEditing={actions.startEditing}
        onSaveDraft={() => saveDraftMutation.mutate()}
        onOpenSidebar={openRightPanel}
        onClose={() => state.setContextMenu(null)}
      />
    </main>
  );
}