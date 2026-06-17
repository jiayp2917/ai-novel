import { Surface } from '../ui/Surface';

type ReaderSearchBarProps = {
  query: string;
  matchCount: number;
  onQueryChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
};

export function ReaderSearchBar({
  query,
  matchCount,
  onQueryChange,
  onPrev,
  onNext,
}: ReaderSearchBarProps) {
  return (
    <Surface variant="paper" className="reader-searchbar reader-searchbar__surface">
      <label>
        正文搜索
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="输入要查找的文字"
        />
      </label>
      <span>{query.trim() ? `匹配 ${matchCount} 处` : '未搜索'}</span>
      <button type="button" className="secondary-button" onClick={onPrev} disabled={matchCount === 0}>
        上一处
      </button>
      <button type="button" className="secondary-button" onClick={onNext} disabled={matchCount === 0}>
        下一处
      </button>
      {query && (
        <button type="button" className="secondary-button" onClick={() => onQueryChange('')}>
          清除
        </button>
      )}
    </Surface>
  );
}