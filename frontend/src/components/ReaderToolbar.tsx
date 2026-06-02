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
  viewingVersion: boolean;
  unparsedChapterSource: boolean;
  writingFullscreen: boolean;
  catalogPanelOpen: boolean;
  rightPanelOpen: boolean;
  jumpValue: string;
  previousChapter: Chapter | null;
  nextChapter: Chapter | null;
  recentChapters: Chapter[];
  canSaveDraft: boolean;
  savingDraft: boolean;
  onSetEditing: (editing: boolean) => void;
  onStartEditing: () => void;
  onDiscardDraft: () => void;
  onJumpValueChange: (value: string) => void;
  onJumpToChapter: () => void;
  onSelectChapter: (chapterId: number) => void;
  onToggleCatalog: () => void;
  onToggleFullscreen: () => void;
  onSaveDraft: () => void;
  onToggleRightPanel: () => void;
  onBackToCurrentVersion: () => void;
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
  viewingVersion,
  unparsedChapterSource,
  writingFullscreen,
  catalogPanelOpen,
  rightPanelOpen,
  jumpValue,
  previousChapter,
  nextChapter,
  recentChapters,
  canSaveDraft,
  savingDraft,
  onSetEditing,
  onStartEditing,
  onDiscardDraft,
  onJumpValueChange,
  onJumpToChapter,
  onSelectChapter,
  onToggleCatalog,
  onToggleFullscreen,
  onSaveDraft,
  onToggleRightPanel,
  onBackToCurrentVersion,
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
            {editing ? '正在编辑正文' : '编辑正文'}
          </button>
          {viewingVersion && (
            <button className="reader-tab" type="button" onClick={onBackToCurrentVersion}>
              回到当前正文
            </button>
          )}
          {draftActive && (
            <button className="reader-tab" type="button" onClick={onDiscardDraft}>
              放弃修改
            </button>
          )}
          <span className="reader-tab">右键工具</span>
        </div>
        {editing && unparsedChapterSource && <p className="form-hint">当前文件还不是可识别章节；保存只会生成文件草稿。请在目录中补充章号和标题后转为章节。</p>}
        {editing && !unparsedChapterSource && <p className="form-hint">当前只是在编辑正文版本；已定位到文末，可直接输入。点击“保存正文版本”会先保存版本，不会直接覆盖正式正文。</p>}
        {viewingVersion && !editing && <p className="form-hint">正在查看历史正文版本。确认无误后请在右侧“版本”里先查看改动，再确认发布。</p>}
      </div>
      <div className="reader-meta">
        <span>{activeContentExists ? `${activeTextLength} 字符` : '等待选择'}</span>
        <span>批注 {annotationCount}</span>
        <span>{viewingVersion ? '历史版本预览' : dirty ? '版本未保存' : '当前正文'}</span>
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
          {unparsedChapterSource ? '保存文件草稿' : '保存正文版本'}
        </button>
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
