import type { Chapter } from '../types';

type ReaderToolbarProps = {
  variant: 'full' | 'writing';
  kindLabel: string;
  title: string;
  editing: boolean;
  draftActive: boolean;
  activeContentExists: boolean;
  activeTextLength: number;
  annotationCount: number;
  dirty: boolean;
  writingFullscreen: boolean;
  catalogPanelOpen: boolean;
  rightPanelOpen: boolean;
  jumpValue: string;
  previousChapter: Chapter | null;
  nextChapter: Chapter | null;
  recentChapters: Chapter[];
  canSaveDraft: boolean;
  savingDraft: boolean;
  hasChapter: boolean;
  snapshotting: boolean;
  onSetEditing: (editing: boolean) => void;
  onStartEditing: () => void;
  onDiscardDraft: () => void;
  onJumpValueChange: (value: string) => void;
  onJumpToChapter: () => void;
  onSelectChapter: (chapterId: number) => void;
  onToggleCatalog: () => void;
  onToggleFullscreen: () => void;
  onSaveDraft: () => void;
  onSnapshot: () => void;
  onToggleRightPanel: () => void;
};

export function ReaderToolbar({
  variant,
  kindLabel,
  title,
  editing,
  draftActive,
  activeContentExists,
  activeTextLength,
  annotationCount,
  dirty,
  writingFullscreen,
  catalogPanelOpen,
  rightPanelOpen,
  jumpValue,
  previousChapter,
  nextChapter,
  recentChapters,
  canSaveDraft,
  savingDraft,
  hasChapter,
  snapshotting,
  onSetEditing,
  onStartEditing,
  onDiscardDraft,
  onJumpValueChange,
  onJumpToChapter,
  onSelectChapter,
  onToggleCatalog,
  onToggleFullscreen,
  onSaveDraft,
  onSnapshot,
  onToggleRightPanel,
}: ReaderToolbarProps) {
  return (
    <div className="reader-header reader-header--workspace">
      <div>
        <p className="eyebrow">{kindLabel}</p>
        <h1>{title}</h1>
        <div className="reader-tabs">
          <button className={!editing ? 'reader-tab reader-tab--active' : 'reader-tab'} type="button" onClick={() => onSetEditing(false)}>
            阅读
          </button>
          <button className={editing ? 'reader-tab reader-tab--active' : 'reader-tab'} type="button" onClick={onStartEditing} disabled={!activeContentExists}>
            {editing ? '正在编辑草稿' : '编辑草稿'}
          </button>
          {draftActive && (
            <button className="reader-tab" type="button" onClick={onDiscardDraft}>
              放弃草稿
            </button>
          )}
          <span className="reader-tab">右键工具</span>
        </div>
        {editing && <p className="form-hint">当前只是在编辑草稿；点击“保存草稿”会进入草稿箱，不会直接覆盖正式正文。</p>}
      </div>
      <div className="reader-meta">
        <span>{activeContentExists ? `${activeTextLength} 字符` : '等待选择'}</span>
        <span>批注 {annotationCount}</span>
        <span>{dirty ? '草稿未保存' : '源文件未改动'}</span>
        {variant === 'writing' && <span>{writingFullscreen ? '全屏写作' : '标准布局'}</span>}
        {variant === 'writing' && (
          <div className="chapter-jump">
            <button type="button" className="icon-button" onClick={() => previousChapter && onSelectChapter(previousChapter.id)} disabled={!previousChapter}>
              上一章
            </button>
            <input
              aria-label="跳转章节"
              value={jumpValue}
              onChange={(event) => onJumpValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onJumpToChapter();
                }
              }}
              placeholder="章号/标题"
            />
            <button type="button" className="icon-button" onClick={onJumpToChapter}>
              跳转
            </button>
            <button type="button" className="icon-button" onClick={() => nextChapter && onSelectChapter(nextChapter.id)} disabled={!nextChapter}>
              下一章
            </button>
          </div>
        )}
        {variant === 'writing' && recentChapters.length > 0 && (
          <div className="recent-chapters" aria-label="最近打开章节">
            {recentChapters.map((chapter) => (
              <button type="button" className="reader-tab" key={chapter.id} onClick={() => onSelectChapter(chapter.id)}>
                {String(chapter.chapter_no).padStart(3, '0')}
              </button>
            ))}
          </div>
        )}
        {variant === 'writing' && (
          <button type="button" className="icon-button" onClick={onToggleCatalog}>
            {catalogPanelOpen ? '隐藏目录' : '打开目录'}
          </button>
        )}
        {variant === 'writing' && (
          <button type="button" className="icon-button" onClick={onToggleFullscreen}>
            {writingFullscreen ? '退出全屏' : '全屏写作'}
          </button>
        )}
        <button type="button" className="icon-button" onClick={onSaveDraft} disabled={!canSaveDraft || savingDraft}>
          保存草稿
        </button>
        {hasChapter && (
          <button type="button" className="icon-button" onClick={onSnapshot} disabled={snapshotting}>
            审核快照
          </button>
        )}
        <button type="button" className="icon-button" onClick={onToggleRightPanel}>
          {rightPanelOpen ? '收起侧栏' : '打开侧栏'}
        </button>
      </div>
    </div>
  );
}

export function ReaderSearchBar({
  searchQuery,
  matchCount,
  onSearchQueryChange,
  onPrevious,
  onNext,
  onClear,
}: {
  searchQuery: string;
  matchCount: number;
  onSearchQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClear: () => void;
}) {
  return (
    <div className="reader-searchbar">
      <label>
        正文搜索
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="输入要查找的文字"
        />
      </label>
      <span>{searchQuery.trim() ? `匹配 ${matchCount} 处` : '未搜索'}</span>
      <button type="button" className="secondary-button" onClick={onPrevious} disabled={matchCount === 0}>
        上一处
      </button>
      <button type="button" className="secondary-button" onClick={onNext} disabled={matchCount === 0}>
        下一处
      </button>
      {searchQuery && (
        <button type="button" className="secondary-button" onClick={onClear}>
          清除
        </button>
      )}
    </div>
  );
}
