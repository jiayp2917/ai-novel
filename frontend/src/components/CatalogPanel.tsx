import { useMemo } from 'react';
import { useChapters, useSources } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { SourceFile } from '../types';
import { chapterMatchesFilter, chaptersByVolume, groupSourceFiles } from '../utils';

export function CatalogPanel() {
  const sources = useSources();
  const chapters = useChapters();
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const chapterFilter = useWorkbenchStore((state) => state.chapterFilter);
  const setSelectedChapterId = useWorkbenchStore((state) => state.setSelectedChapterId);
  const setSelectedSourceFileId = useWorkbenchStore((state) => state.setSelectedSourceFileId);
  const setChapterFilter = useWorkbenchStore((state) => state.setChapterFilter);
  const grouped = useMemo(() => groupSourceFiles(sources.data ?? []), [sources.data]);
  const filteredChapters = useMemo(
    () => (chapters.data ?? []).filter((chapter) => chapterMatchesFilter(chapter, chapterFilter)),
    [chapters.data, chapterFilter],
  );
  const volumes = useMemo(() => chaptersByVolume(filteredChapters, sources.data ?? []), [filteredChapters, sources.data]);

  return (
    <aside className="panel catalog-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">资源管理器</p>
          <h2>项目素材库</h2>
        </div>
        <span className="count-badge">{(sources.data ?? []).length}</span>
      </div>

      <div className="catalog-scroll">
        <section className="catalog-section">
          <h3>系统设定 <span>{grouped.system.length}</span></h3>
          {grouped.system.length === 0 && <p className="muted">尚未索引系统设定。</p>}
          {grouped.system.map((file) => (
            <SourceButton key={file.id} file={file} selected={file.id === selectedSourceFileId} onClick={() => setSelectedSourceFileId(file.id)} />
          ))}
        </section>

        <section className="catalog-section">
          <h3>小说设定 <span>{grouped.settings.length}</span></h3>
          {grouped.settings.length === 0 && <p className="muted">尚未索引小说设定。</p>}
          {grouped.settings.map((file) => (
            <SourceButton key={file.id} file={file} selected={file.id === selectedSourceFileId} onClick={() => setSelectedSourceFileId(file.id)} />
          ))}
        </section>

        <section className="catalog-section">
          <h3>章纲 <span>{grouped.outlines.length}</span></h3>
          {grouped.outlines.length === 0 && <p className="muted">尚未索引章纲。</p>}
          {grouped.outlines.map((file) => (
            <SourceButton key={file.id} file={file} selected={file.id === selectedSourceFileId} onClick={() => setSelectedSourceFileId(file.id)} />
          ))}
        </section>

        <section className="catalog-section catalog-section--chapters">
          <h3>正文 <span>{(chapters.data ?? []).length}</span></h3>
          <label className="catalog-filter">
            <span>过滤章节</span>
            <input
              value={chapterFilter}
              onChange={(event) => setChapterFilter(event.target.value)}
              placeholder="章号或标题"
            />
          </label>
          {chapters.isLoading && <p className="muted">正在加载正文...</p>}
          {volumes.map(([volume, items]) => (
            <div className="volume-group" key={volume}>
              <div className="volume-title">{volume}<span>{items.length}</span></div>
              {items.map((chapter) => (
                <button
                  className={chapter.id === selectedChapterId ? 'chapter-row chapter-row--active' : 'chapter-row'}
                  key={chapter.id}
                  type="button"
                  onClick={() => setSelectedChapterId(chapter.id)}
                >
                  <span>{String(chapter.chapter_no).padStart(3, '0')}</span>
                  <strong>{chapter.title}</strong>
                </button>
              ))}
            </div>
          ))}
          {!chapters.isLoading && (chapters.data ?? []).length === 0 && <p className="muted">尚未索引正文。</p>}
          {!chapters.isLoading && (chapters.data ?? []).length > 0 && filteredChapters.length === 0 && (
            <p className="muted">没有匹配的章节。</p>
          )}
        </section>
      </div>
    </aside>
  );
}

function SourceButton({ file, selected, onClick }: { file: SourceFile; selected: boolean; onClick: () => void }) {
  return (
    <button className={selected ? 'source-row source-row--active' : 'source-row'} title={file.path} type="button" onClick={onClick}>
      {file.path}
    </button>
  );
}
