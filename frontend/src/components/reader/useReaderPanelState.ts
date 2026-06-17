import { useCallback } from 'react';
import { searchMatchCount } from '../readerUtils';
import { useReaderState, type UseReaderStateResult } from './useReaderState';

type UseReaderPanelStateOptions = {
  variant: 'full' | 'writing';
};

export type ReaderPanelState = {
  chapterId: number | null;
  dirty: boolean;
  editMode: boolean;
  search: string;
  matchIndex: number;
};

export type ReaderPanelActions = {
  setDirty: (dirty: boolean) => void;
  toggleEdit: () => void;
  setSearch: (value: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
};

export type UseReaderPanelStateResult = {
  state: ReaderPanelState;
  actions: ReaderPanelActions;
  // 透传给 ReaderPanel 的内部字段
  detail: UseReaderStateResult;
};

export function useReaderPanelState({ variant }: UseReaderPanelStateOptions): UseReaderPanelStateResult {
  // 6 个 store 字段订阅(由 useReaderState 内部完成):
  //   selectedChapterId, selectedSourceFileId, selectedChapterVersionId,
  //   setDraftAnnotationSelection, setSelectedChapterVersionId, setWritingNavigationGuard
  const detail = useReaderState({ variant });
  const matchCount = searchMatchCount(detail.activeText, detail.searchQuery);

  // useEffect 拆分说明:
  //   1) selectedChapterId/selectedSourceFileId 变化 -> 重置选择/草稿/搜索 (useReaderState 内)
  //   2) selectedChapterVersionId 变化        -> 重置编辑态/草稿/搜索 (useReaderState 内)
  //   3) searchQuery 或 documentKey 变化      -> 搜索索引归零 (useReaderState 内)
  //   4) 组件卸载 -> 清空导航守卫 (由 ReaderPanel 自行清理)
  //   5-9) 现有 useReaderState 已聚合以上 3 处副作用,本 hook 不再重复挂载

  const setDirty = useCallback((next: boolean) => {
    if (!detail.activeContent) {
      return;
    }
    if (!next) {
      detail.setDraftActive(false);
      detail.setDraftText('');
      detail.setEditing(false);
      return;
    }
    if (!detail.draftActive) {
      detail.setDraftText(detail.activeContent.text);
      detail.setDraftActive(true);
    }
  }, [detail]);

  const toggleEdit = useCallback(() => {
    if (!detail.activeContent) {
      return;
    }
    if (!detail.draftActive) {
      detail.setDraftText(detail.activeContent.text);
      detail.setDraftActive(true);
    }
    detail.setSearchQuery('');
    detail.setSearchIndex(0);
    detail.setEditing(true);
  }, [detail]);

  const setSearch = useCallback((value: string) => {
    detail.setSearchQuery(value);
    detail.setSearchIndex(0);
  }, [detail]);

  const nextMatch = useCallback(() => {
    detail.setSearchIndex((value) => (matchCount > 0 ? (value + 1) % matchCount : 0));
  }, [detail, matchCount]);

  const prevMatch = useCallback(() => {
    detail.setSearchIndex((value) => Math.max(0, value - 1));
  }, [detail]);

  return {
    state: {
      chapterId: detail.selectedChapterId,
      dirty: detail.dirty,
      editMode: detail.editing,
      search: detail.searchQuery,
      matchIndex: detail.searchIndex,
    },
    actions: {
      setDirty,
      toggleEdit,
      setSearch,
      nextMatch,
      prevMatch,
    },
    detail,
  };
}
