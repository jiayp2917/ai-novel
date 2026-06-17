import { useCallback } from 'react';
import { useWorkbenchStore } from '../../store';
import type { UseReaderStateResult } from './useReaderState';

export function useReaderActions(state: UseReaderStateResult) {
  const setCatalogPanelOpen = useWorkbenchStore((s) => s.setCatalogPanelOpen);
  const setWritingFullscreen = useWorkbenchStore((s) => s.setWritingFullscreen);
  const setRightPanelOpen = useWorkbenchStore((s) => s.setRightPanelOpen);
  const catalogPanelOpen = useWorkbenchStore((s) => s.catalogPanelOpen);
  const writingFullscreen = useWorkbenchStore((s) => s.writingFullscreen);
  const rightPanelOpen = useWorkbenchStore((s) => s.rightPanelOpen);
  const pushTask = useWorkbenchStore((s) => s.pushTask);

  const startEditing = useCallback(() => {
    if (!state.activeContent) {
      return;
    }
    if (!state.draftActive) {
      state.setDraftText(state.activeContent.text);
      state.setDraftActive(true);
    }
    state.setSearchQuery('');
    state.setSearchIndex(0);
    state.setEditing(true);
    state.setFocusAtEndSignal((value) => value + 1);
  }, [state]);

  const toggleCatalog = useCallback(() => {
    const next = !catalogPanelOpen;
    setCatalogPanelOpen(next);
    pushTask({ label: next ? '打开目录' : '隐藏目录', status: 'succeeded', detail: next ? '左侧目录已显示。' : '左侧目录已隐藏，正文区域已扩大。' });
  }, [catalogPanelOpen, setCatalogPanelOpen, pushTask]);

  const toggleFullscreen = useCallback(() => {
    const next = !writingFullscreen;
    setWritingFullscreen(next);
    pushTask({ label: next ? '进入全屏写作' : '退出全屏写作', status: 'succeeded', detail: next ? '已隐藏目录和右侧栏。' : '已恢复标准写作布局。' });
  }, [writingFullscreen, setWritingFullscreen, pushTask]);

  const toggleRightPanel = useCallback(() => {
    const next = !rightPanelOpen;
    setRightPanelOpen(next);
    pushTask({ label: next ? '打开右侧栏' : '收起右侧栏', status: 'succeeded', detail: next ? '批注、版本和记忆栏已显示。' : '右侧栏已隐藏，正文区域已扩大。' });
  }, [rightPanelOpen, setRightPanelOpen, pushTask]);

  const discardDraft = useCallback(() => {
    state.setDraftActive(false);
    state.setDraftText('');
    state.setEditing(false);
  }, [state]);

  return {
    startEditing,
    toggleCatalog,
    toggleFullscreen,
    toggleRightPanel,
    discardDraft,
  };
}