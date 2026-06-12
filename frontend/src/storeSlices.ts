import type { StateCreator } from 'zustand';
import type { InspectorTab } from './types';
import {
  STORAGE_KEYS,
  initialActiveView,
  initialInspectorTab,
  initialTheme,
  storeJson,
  storeValue,
  storedBoolean,
  storedNumber,
  storedNumberArray,
  storedString,
} from './storePersistence';
import type { WorkbenchState } from './storeTypes';

type SliceCreator = StateCreator<WorkbenchState, [], [], Partial<WorkbenchState>>;

function canNavigate(get: () => WorkbenchState, force?: boolean): boolean {
  if (force) {
    return true;
  }
  return get().writingNavigationGuard?.() ?? true;
}

export const createNavigationSlice: SliceCreator = (set, get) => ({
  activeView: initialActiveView(),
  theme: initialTheme(),
  setActiveView: (view, options) => {
    if (view !== get().activeView && !canNavigate(get, options?.force)) {
      return false;
    }
    storeValue(STORAGE_KEYS.activeView, view);
    set((state) => {
      const next = {
        activeView: view,
        selectedChapterId: view === 'planning' ? null : state.selectedChapterId,
        selectedSourceFileId: view === 'writing' ? null : state.selectedSourceFileId,
        selectedAnnotationId: view === 'planning' || view === 'writing' ? null : state.selectedAnnotationId,
        annotationJumpSignal: view === 'planning' || view === 'writing' ? state.annotationJumpSignal + 1 : state.annotationJumpSignal,
        selectedAnnotationIds: view === 'planning' || view === 'writing' ? [] : state.selectedAnnotationIds,
        draftAnnotationSelection: view === 'planning' || view === 'writing' ? undefined : state.draftAnnotationSelection,
        activeArtifactId: view === 'writing' || view === 'planning' ? state.activeArtifactId : null,
        selectedChapterVersionId: view === 'writing' ? state.selectedChapterVersionId : null,
        rightPanelOpen: view === 'planning' ? true : view === 'writing' ? false : state.rightPanelOpen,
        inspectorTab: view === 'writing' ? 'annotations' as InspectorTab : view === 'planning' ? 'candidates' as InspectorTab : state.inspectorTab,
      };
      storeValue(STORAGE_KEYS.selectedChapterId, next.selectedChapterId);
      storeValue(STORAGE_KEYS.selectedSourceFileId, next.selectedSourceFileId);
      storeValue(STORAGE_KEYS.rightPanelOpen, next.rightPanelOpen);
      storeValue(STORAGE_KEYS.inspectorTab, next.inspectorTab);
      return next;
    });
    return true;
  },
  setTheme: (theme) => {
    storeValue('novel-editor-theme', theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'anime' ? 'bright' : 'anime';
    get().setTheme(next);
  },
});

export const createDocumentSlice: SliceCreator = (set, get) => ({
  selectedChapterId: storedNumber(STORAGE_KEYS.selectedChapterId),
  selectedSourceFileId: storedNumber(STORAGE_KEYS.selectedSourceFileId),
  openChapterTabIds: storedNumberArray(STORAGE_KEYS.openChapterTabIds),
  recentChapterIds: storedNumberArray(STORAGE_KEYS.recentChapterIds),
  chapterFilter: storedString(STORAGE_KEYS.chapterFilter) ?? '',
  setSelectedChapterId: (id, options) => {
    if (id !== get().selectedChapterId && !canNavigate(get, options?.force)) {
      return false;
    }
    storeValue(STORAGE_KEYS.selectedChapterId, id);
    storeValue(STORAGE_KEYS.selectedSourceFileId, null);
    set((state) => {
      const openChapterTabIds = id === null
        ? state.openChapterTabIds
        : [id, ...state.openChapterTabIds.filter((item) => item !== id)].slice(0, 8);
      storeJson(STORAGE_KEYS.openChapterTabIds, openChapterTabIds);
      if (id !== null) {
        const recentChapterIds = [id, ...state.recentChapterIds.filter((item) => item !== id)].slice(0, 8);
        storeJson(STORAGE_KEYS.recentChapterIds, recentChapterIds);
        return {
          selectedChapterId: id,
          selectedSourceFileId: null,
          openChapterTabIds,
          recentChapterIds,
          selectedAnnotationId: null,
          annotationJumpSignal: state.annotationJumpSignal + 1,
          selectedAnnotationIds: [],
          draftAnnotationSelection: undefined,
          activeArtifactId: null,
          selectedChapterVersionId: null,
        };
      }
      return {
        selectedChapterId: id,
        selectedSourceFileId: null,
        openChapterTabIds,
        selectedAnnotationId: null,
        annotationJumpSignal: state.annotationJumpSignal + 1,
        selectedAnnotationIds: [],
        draftAnnotationSelection: undefined,
        activeArtifactId: null,
        selectedChapterVersionId: null,
      };
    });
    return true;
  },
  rememberChapter: (id) =>
    set((state) => {
      const recentChapterIds = [id, ...state.recentChapterIds.filter((item) => item !== id)].slice(0, 8);
      storeJson(STORAGE_KEYS.recentChapterIds, recentChapterIds);
      return { recentChapterIds };
    }),
  setSelectedSourceFileId: (id, options) => {
    if (id !== get().selectedSourceFileId && !canNavigate(get, options?.force)) {
      return false;
    }
    storeValue(STORAGE_KEYS.selectedSourceFileId, id);
    storeValue(STORAGE_KEYS.selectedChapterId, null);
    set({
      selectedSourceFileId: id,
      selectedChapterId: null,
      selectedAnnotationId: null,
      annotationJumpSignal: 0,
      selectedAnnotationIds: [],
      draftAnnotationSelection: undefined,
      activeArtifactId: null,
      selectedChapterVersionId: null,
    });
    return true;
  },
  closeChapterTab: (id, options) => {
    if (get().selectedChapterId === id && !canNavigate(get, options?.force)) {
      return false;
    }
    set((state) => {
      const openChapterTabIds = state.openChapterTabIds.filter((item) => item !== id);
      const selectedChapterId = state.selectedChapterId === id ? openChapterTabIds[0] ?? null : state.selectedChapterId;
      storeJson(STORAGE_KEYS.openChapterTabIds, openChapterTabIds);
      storeValue(STORAGE_KEYS.selectedChapterId, selectedChapterId);
      return {
        openChapterTabIds,
        selectedChapterId,
        selectedAnnotationId: state.selectedChapterId === id ? null : state.selectedAnnotationId,
        selectedAnnotationIds: state.selectedChapterId === id ? [] : state.selectedAnnotationIds,
        draftAnnotationSelection: state.selectedChapterId === id ? undefined : state.draftAnnotationSelection,
        activeArtifactId: state.selectedChapterId === id ? null : state.activeArtifactId,
        selectedChapterVersionId: state.selectedChapterId === id ? null : state.selectedChapterVersionId,
      };
    });
    return true;
  },
  closeOtherChapterTabs: (id, options) => {
    if (!canNavigate(get, options?.force)) {
      return false;
    }
    const keep = get().openChapterTabIds.includes(id) ? id : get().selectedChapterId;
    const openChapterTabIds = keep === null ? [] : [keep];
    storeJson(STORAGE_KEYS.openChapterTabIds, openChapterTabIds);
    if (keep !== null) {
      storeValue(STORAGE_KEYS.selectedChapterId, keep);
    }
    set((state) => ({
      openChapterTabIds,
      selectedChapterId: keep,
      selectedSourceFileId: null,
      selectedAnnotationId: state.selectedChapterId === keep ? state.selectedAnnotationId : null,
      selectedAnnotationIds: state.selectedChapterId === keep ? state.selectedAnnotationIds : [],
      draftAnnotationSelection: state.selectedChapterId === keep ? state.draftAnnotationSelection : undefined,
      activeArtifactId: state.selectedChapterId === keep ? state.activeArtifactId : null,
      selectedChapterVersionId: state.selectedChapterId === keep ? state.selectedChapterVersionId : null,
    }));
    return true;
  },
  closeAllChapterTabs: (options) => {
    if (!canNavigate(get, options?.force)) {
      return false;
    }
    storeJson(STORAGE_KEYS.openChapterTabIds, []);
    storeValue(STORAGE_KEYS.selectedChapterId, null);
    set({
      openChapterTabIds: [],
      selectedChapterId: null,
      selectedAnnotationId: null,
      selectedAnnotationIds: [],
      draftAnnotationSelection: undefined,
      activeArtifactId: null,
      selectedChapterVersionId: null,
    });
    return true;
  },
  setChapterFilter: (value) => {
    storeValue(STORAGE_KEYS.chapterFilter, value);
    set({ chapterFilter: value });
  },
});

export const createAnnotationSlice: SliceCreator = (set) => ({
  selectedAnnotationId: null,
  annotationJumpSignal: 0,
  selectedAnnotationIds: [],
  draftAnnotationSelection: undefined,
  setSelectedAnnotationId: (id) => set({ selectedAnnotationId: id }),
  jumpToAnnotation: (id) =>
    set((state) => ({
      selectedAnnotationId: id,
      annotationJumpSignal: state.annotationJumpSignal + 1,
    })),
  toggleAnnotationSelection: (id) =>
    set((state) => ({
      selectedAnnotationIds: state.selectedAnnotationIds.includes(id)
        ? state.selectedAnnotationIds.filter((item) => item !== id)
        : [...state.selectedAnnotationIds, id],
    })),
  selectAnnotationForRevision: (id) =>
    set((state) => ({
      selectedAnnotationIds: state.selectedAnnotationIds.includes(id)
        ? state.selectedAnnotationIds
        : [...state.selectedAnnotationIds, id],
    })),
  removeAnnotationFromSelection: (id) =>
    set((state) => ({
      selectedAnnotationId: state.selectedAnnotationId === id ? null : state.selectedAnnotationId,
      selectedAnnotationIds: state.selectedAnnotationIds.filter((item) => item !== id),
    })),
  clearAnnotationSelection: () => set({ selectedAnnotationIds: [] }),
  setDraftAnnotationSelection: (selection) => set({ draftAnnotationSelection: selection }),
});

export const createArtifactSlice: SliceCreator = (set, get) => ({
  activeArtifactId: null,
  selectedChapterVersionId: null,
  setActiveArtifactId: (id) => set({ activeArtifactId: id }),
  setSelectedChapterVersionId: (id, options) => {
    if (id !== get().selectedChapterVersionId && !canNavigate(get, options?.force)) {
      return false;
    }
    set({ selectedChapterVersionId: id });
    return true;
  },
});

export const createUiSlice: SliceCreator = (set) => ({
  rightPanelOpen: storedBoolean(STORAGE_KEYS.rightPanelOpen, false),
  catalogPanelOpen: storedBoolean(STORAGE_KEYS.catalogPanelOpen, true),
  writingFullscreen: storedBoolean(STORAGE_KEYS.writingFullscreen, false),
  inspectorTab: initialInspectorTab(),
  writingNavigationGuard: null,
  setRightPanelOpen: (open) => {
    storeValue(STORAGE_KEYS.rightPanelOpen, open);
    set({ rightPanelOpen: open });
  },
  setCatalogPanelOpen: (open) => {
    storeValue(STORAGE_KEYS.catalogPanelOpen, open);
    set({ catalogPanelOpen: open });
  },
  setWritingFullscreen: (open) => {
    storeValue(STORAGE_KEYS.writingFullscreen, open);
    set({ writingFullscreen: open });
  },
  setInspectorTab: (tab) => {
    storeValue(STORAGE_KEYS.inspectorTab, tab);
    set({ inspectorTab: tab });
  },
  setWritingNavigationGuard: (guard) => set({ writingNavigationGuard: guard }),
});

export const createTaskFeedbackSlice: SliceCreator = (set) => ({
  workspaceBookmarks: loadWorkspaceBookmarks(),
  taskLog: [
    {
      id: 1,
      label: '小说编辑器',
      status: 'idle',
      detail: '选择工作区并扫描素材后，可以阅读、批注、生成候选、审核和发布。',
    },
  ],
  pushTask: (entry) =>
    set((state) => ({
      taskLog: [{ ...entry, id: Date.now() }, ...state.taskLog].slice(0, 12),
    })),
  rememberWorkspace: (workspace, name) =>
    set((state) => {
      const id = workspace.root;
      const existing = state.workspaceBookmarks.find((item) => item.id === id);
      const bookmark = {
        id,
        name: name?.trim() || existing?.name || defaultWorkspaceName(workspace.root),
        path: workspace.root,
        layout: workspace.layout,
        lastOpenedAt: new Date().toISOString(),
        counts: workspace.detected_counts ?? {},
      };
      const workspaceBookmarks = [bookmark, ...state.workspaceBookmarks.filter((item) => item.id !== id)].slice(0, 12);
      storeJson(STORAGE_KEYS.workspaceBookmarks, workspaceBookmarks);
      return { workspaceBookmarks };
    }),
  renameWorkspaceBookmark: (id, name) =>
    set((state) => {
      const workspaceBookmarks = state.workspaceBookmarks.map((item) =>
        item.id === id ? { ...item, name: name.trim() || item.name } : item,
      );
      storeJson(STORAGE_KEYS.workspaceBookmarks, workspaceBookmarks);
      return { workspaceBookmarks };
    }),
  removeWorkspaceBookmark: (id) =>
    set((state) => {
      const workspaceBookmarks = state.workspaceBookmarks.filter((item) => item.id !== id);
      storeJson(STORAGE_KEYS.workspaceBookmarks, workspaceBookmarks);
      return { workspaceBookmarks };
    }),
});

function loadWorkspaceBookmarks() {
  const raw = storedString(STORAGE_KEYS.workspaceBookmarks);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is WorkbenchState['workspaceBookmarks'][number] => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const candidate = item as Record<string, unknown>;
        return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.path === 'string';
      })
      .slice(0, 12);
  } catch {
    return [];
  }
}

function defaultWorkspaceName(path: string): string {
  const normalized = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return normalized.at(-1) || '未命名作品';
}
