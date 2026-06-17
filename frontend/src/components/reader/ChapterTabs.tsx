import type { Chapter } from '../../types';

type ChapterTabsProps = {
  chapters: Chapter[];
  activeId: number | null;
  onSelect: (chapterId: number) => void;
  onCloseTab: (chapterId: number) => void;
  onCloseOtherTabs: (chapterId: number) => void;
  onCloseAllTabs: () => void;
};

export function ChapterTabs({
  chapters,
  activeId,
  onSelect,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
}: ChapterTabsProps) {
  if (chapters.length === 0) {
    return null;
  }

  return (
    <div className="reader-chapter-tabs chapter-tabs-bar">
      <div className="chapter-tabs" aria-label="已打开章节">
        {chapters.map((chapter) => (
          <div
            className={chapter.id === activeId ? 'chapter-tab chapter-tab--active' : 'chapter-tab'}
            key={chapter.id}
          >
            <button className="chapter-tab__select" type="button" onClick={() => onSelect(chapter.id)}>
              <span>{String(chapter.chapter_no).padStart(3, '0')}</span>
              <strong>{chapter.title}</strong>
            </button>
            <button
              className="chapter-tab__close"
              type="button"
              aria-label={`关闭第${chapter.chapter_no}章`}
              onClick={() => onCloseTab(chapter.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="chapter-tabs__actions" aria-label="章节标签操作">
        <span>{chapters.length} 个标签</span>
        <button type="button" className="secondary-button" onClick={() => activeId !== null && onCloseTab(activeId)}>
          关闭当前
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => activeId !== null && onCloseOtherTabs(activeId)}
          disabled={activeId === null || chapters.length <= 1}
        >
          关闭其他
        </button>
        <button type="button" className="secondary-button" onClick={onCloseAllTabs}>
          关闭全部
        </button>
      </div>
    </div>
  );
}