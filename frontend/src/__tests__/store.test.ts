import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkbenchStore } from '../store';

describe('createNavigationSlice', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      activeView: 'home',
      theme: 'bright',
    });
  });

  it('setActiveView changes activeView', () => {
    const result = useWorkbenchStore.getState().setActiveView('writing');
    expect(result).toBe(true);
    expect(useWorkbenchStore.getState().activeView).toBe('writing');
  });

  it('setActiveView with force bypasses navigation guard', () => {
    useWorkbenchStore.getState().setWritingNavigationGuard(() => false);
    const result = useWorkbenchStore.getState().setActiveView('writing', { force: true });
    expect(result).toBe(true);
    expect(useWorkbenchStore.getState().activeView).toBe('writing');
    useWorkbenchStore.getState().setWritingNavigationGuard(null);
  });

  it('setTheme changes theme', () => {
    useWorkbenchStore.getState().setTheme('anime');
    expect(useWorkbenchStore.getState().theme).toBe('anime');
  });

  it('toggleTheme toggles between bright and anime', () => {
    expect(useWorkbenchStore.getState().theme).toBe('bright');
    useWorkbenchStore.getState().toggleTheme();
    expect(useWorkbenchStore.getState().theme).toBe('anime');
    useWorkbenchStore.getState().toggleTheme();
    expect(useWorkbenchStore.getState().theme).toBe('bright');
  });
});

describe('createDocumentSlice', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      selectedChapterId: null,
      openChapterTabIds: [],
      recentChapterIds: [],
      selectedSourceFileId: null,
      chapterFilter: '',
    });
  });

  it('selectedChapterId starts as null', () => {
    expect(useWorkbenchStore.getState().selectedChapterId).toBeNull();
  });

  it('openChapterTabIds starts empty', () => {
    expect(useWorkbenchStore.getState().openChapterTabIds).toEqual([]);
  });

  it('setSelectedChapterId sets the chapter', () => {
    useWorkbenchStore.getState().setSelectedChapterId(1);
    expect(useWorkbenchStore.getState().selectedChapterId).toBe(1);
    expect(useWorkbenchStore.getState().openChapterTabIds).toContain(1);
  });

  it('closeChapterTab removes the tab', () => {
    useWorkbenchStore.getState().setSelectedChapterId(1);
    useWorkbenchStore.getState().setSelectedChapterId(2);
    useWorkbenchStore.getState().closeChapterTab(2);
    expect(useWorkbenchStore.getState().openChapterTabIds).not.toContain(2);
  });
});

describe('createAnnotationSlice', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      selectedAnnotationId: null,
      annotationJumpSignal: 0,
      selectedAnnotationIds: [],
      draftAnnotationSelection: undefined,
    });
  });

  it('selectedAnnotationId starts as null', () => {
    expect(useWorkbenchStore.getState().selectedAnnotationId).toBeNull();
  });

  it('annotationJumpSignal starts at 0', () => {
    expect(useWorkbenchStore.getState().annotationJumpSignal).toBe(0);
  });

  it('setSelectedAnnotationId sets the id', () => {
    useWorkbenchStore.getState().setSelectedAnnotationId(5);
    expect(useWorkbenchStore.getState().selectedAnnotationId).toBe(5);
  });

  it('jumpToAnnotation increments signal', () => {
    useWorkbenchStore.getState().jumpToAnnotation(10);
    expect(useWorkbenchStore.getState().selectedAnnotationId).toBe(10);
    expect(useWorkbenchStore.getState().annotationJumpSignal).toBe(1);
  });

  it('toggleAnnotationSelection toggles ids', () => {
    useWorkbenchStore.getState().toggleAnnotationSelection(1);
    expect(useWorkbenchStore.getState().selectedAnnotationIds).toContain(1);
    useWorkbenchStore.getState().toggleAnnotationSelection(1);
    expect(useWorkbenchStore.getState().selectedAnnotationIds).not.toContain(1);
  });
});

describe('createArtifactSlice', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      activeArtifactId: null,
      selectedChapterVersionId: null,
    });
  });

  it('activeArtifactId starts as null', () => {
    expect(useWorkbenchStore.getState().activeArtifactId).toBeNull();
  });

  it('setActiveArtifactId sets the id', () => {
    useWorkbenchStore.getState().setActiveArtifactId(42);
    expect(useWorkbenchStore.getState().activeArtifactId).toBe(42);
  });
});

describe('createUiSlice', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      rightPanelOpen: false,
      catalogPanelOpen: true,
    });
  });

  it('rightPanelOpen toggles', () => {
    useWorkbenchStore.getState().setRightPanelOpen(true);
    expect(useWorkbenchStore.getState().rightPanelOpen).toBe(true);
    useWorkbenchStore.getState().setRightPanelOpen(false);
    expect(useWorkbenchStore.getState().rightPanelOpen).toBe(false);
  });

  it('catalogPanelOpen toggles', () => {
    useWorkbenchStore.getState().setCatalogPanelOpen(false);
    expect(useWorkbenchStore.getState().catalogPanelOpen).toBe(false);
  });
});

describe('createTaskFeedbackSlice', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      taskLog: [],
      workspaceBookmarks: [],
    });
  });

  it('pushTask adds a task entry', () => {
    useWorkbenchStore.getState().pushTask({ label: '测试任务', status: 'idle', detail: '测试' });
    const log = useWorkbenchStore.getState().taskLog;
    expect(log).toHaveLength(1);
    expect(log[0].label).toBe('测试任务');
  });

  it('rememberWorkspace adds a bookmark', () => {
    useWorkbenchStore.getState().rememberWorkspace(
      { root: '/test/path', layout: 'content', source_roots: [], detected_counts: {} },
      '测试作品'
    );
    const bookmarks = useWorkbenchStore.getState().workspaceBookmarks;
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].name).toBe('测试作品');
  });
});
