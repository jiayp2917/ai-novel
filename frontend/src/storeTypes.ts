import type { ActiveView, InspectorTab, SelectionRange, TaskEntry, ThemeMode, WorkspaceBookmark, WorkspaceStatus } from './types';

export type NavigationOptions = {
  force?: boolean;
};

export type WritingNavigationGuard = () => boolean;

export type WorkbenchState = {
  activeView: ActiveView;
  theme: ThemeMode;
  selectedChapterId: number | null;
  selectedSourceFileId: number | null;
  openChapterTabIds: number[];
  selectedAnnotationId: number | null;
  annotationJumpSignal: number;
  selectedAnnotationIds: number[];
  draftAnnotationSelection: SelectionRange | null | undefined;
  activeArtifactId: number | null;
  selectedChapterVersionId: number | null;
  rightPanelOpen: boolean;
  catalogPanelOpen: boolean;
  writingFullscreen: boolean;
  chapterFilter: string;
  inspectorTab: InspectorTab;
  writingNavigationGuard: WritingNavigationGuard | null;
  taskLog: TaskEntry[];
  workspaceBookmarks: WorkspaceBookmark[];
  recentChapterIds: number[];
  setActiveView: (view: ActiveView, options?: NavigationOptions) => boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSelectedChapterId: (id: number | null, options?: NavigationOptions) => boolean;
  setSelectedSourceFileId: (id: number | null, options?: NavigationOptions) => boolean;
  closeChapterTab: (id: number, options?: NavigationOptions) => boolean;
  setSelectedAnnotationId: (id: number | null) => void;
  jumpToAnnotation: (id: number) => void;
  toggleAnnotationSelection: (id: number) => void;
  selectAnnotationForRevision: (id: number) => void;
  removeAnnotationFromSelection: (id: number) => void;
  clearAnnotationSelection: () => void;
  setDraftAnnotationSelection: (selection: SelectionRange | null | undefined) => void;
  setActiveArtifactId: (id: number | null) => void;
  setSelectedChapterVersionId: (id: number | null, options?: NavigationOptions) => boolean;
  setRightPanelOpen: (open: boolean) => void;
  setCatalogPanelOpen: (open: boolean) => void;
  setWritingFullscreen: (open: boolean) => void;
  setChapterFilter: (value: string) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setWritingNavigationGuard: (guard: WritingNavigationGuard | null) => void;
  pushTask: (entry: Omit<TaskEntry, 'id'>) => void;
  rememberWorkspace: (workspace: WorkspaceStatus, name?: string) => void;
  renameWorkspaceBookmark: (id: string, name: string) => void;
  removeWorkspaceBookmark: (id: string) => void;
  rememberChapter: (id: number) => void;
};
