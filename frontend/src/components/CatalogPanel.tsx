import { useEffect, useMemo, useState } from 'react';
import { useChapters, useSources } from '../hooks';
import { useWorkbenchStore } from '../store';
import type { Chapter, SourceFile } from '../types';
import { chapterMatchesFilter, chaptersByVolume, groupSourceFiles } from '../utils';

type CatalogSectionKey = 'system' | 'settings' | 'outlines' | 'chapters';

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
  const selectedSource = useMemo(
    () => (sources.data ?? []).find((file) => file.id === selectedSourceFileId),
    [selectedSourceFileId, sources.data],
  );
  const selectedChapter = useMemo(
    () => (chapters.data ?? []).find((chapter) => chapter.id === selectedChapterId),
    [chapters.data, selectedChapterId],
  );
  const selectedChapterVolume = useMemo(() => {
    if (!selectedChapter) {
      return null;
    }
    const source = (sources.data ?? []).find((file) => file.id === selectedChapter.source_file_id);
    const match = source?.path.match(/02-正文\/([^/]+)/);
    return match?.[1] ?? '正文';
  }, [selectedChapter, sources.data]);
  const [openSections, setOpenSections] = useState<Record<CatalogSectionKey, boolean>>({
    system: false,
    settings: false,
    outlines: false,
    chapters: true,
  });
  const [openVolumes, setOpenVolumes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!selectedSource) {
      return;
    }
    if (selectedSource.path.startsWith('00-系统/')) {
      setOpenSections((current) => ({ ...current, system: true }));
    } else if (selectedSource.kind === 'settings') {
      setOpenSections((current) => ({ ...current, settings: true }));
    } else if (selectedSource.kind === 'outlines') {
      setOpenSections((current) => ({ ...current, outlines: true }));
    }
  }, [selectedSource]);

  useEffect(() => {
    if (!selectedChapterVolume) {
      return;
    }
    setOpenSections((current) => ({ ...current, chapters: true }));
    setOpenVolumes((current) => ({ ...current, [selectedChapterVolume]: true }));
  }, [selectedChapterVolume]);

  useEffect(() => {
    if (chapterFilter.trim()) {
      setOpenSections((current) => ({ ...current, chapters: true }));
      setOpenVolumes(Object.fromEntries(volumes.map(([volume]) => [volume, true])));
    }
  }, [chapterFilter, volumes]);

  const toggleSection = (key: CatalogSectionKey) => {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  };

  const toggleVolume = (volume: string) => {
    setOpenVolumes((current) => ({ ...current, [volume]: !(current[volume] ?? volume === selectedChapterVolume) }));
  };

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
        <SourceSection
          count={grouped.system.length}
          files={grouped.system}
          label="系统设定"
          open={openSections.system}
          emptyText="尚未索引系统设定。"
          selectedSourceFileId={selectedSourceFileId}
          onToggle={() => toggleSection('system')}
          onSelectSource={setSelectedSourceFileId}
        />

        <SourceSection
          count={grouped.settings.length}
          files={grouped.settings}
          label="小说设定"
          open={openSections.settings}
          emptyText="尚未索引小说设定。"
          selectedSourceFileId={selectedSourceFileId}
          onToggle={() => toggleSection('settings')}
          onSelectSource={setSelectedSourceFileId}
        />

        <SourceSection
          count={grouped.outlines.length}
          files={grouped.outlines}
          label="章纲"
          open={openSections.outlines}
          emptyText="尚未索引章纲。"
          selectedSourceFileId={selectedSourceFileId}
          onToggle={() => toggleSection('outlines')}
          onSelectSource={setSelectedSourceFileId}
        />

        <section className="catalog-section catalog-section--chapters">
          <CatalogToggle
            label="正文"
            count={(chapters.data ?? []).length}
            open={openSections.chapters}
            onToggle={() => toggleSection('chapters')}
          />
          {openSections.chapters && (
            <>
              <label className="catalog-filter">
                <span>过滤章节</span>
                <input
                  value={chapterFilter}
                  onChange={(event) => setChapterFilter(event.target.value)}
                  placeholder="章号或标题"
                />
              </label>
              {chapters.isLoading && <p className="muted">正在加载正文...</p>}
              {volumes.map(([volume, items], index) => {
                const volumeOpen = openVolumes[volume] ?? (volume === selectedChapterVolume || (!selectedChapterVolume && index === 0));
                return (
                  <div className="volume-group" key={volume}>
                    <CatalogToggle
                      className="volume-title"
                      label={volume}
                      count={items.length}
                      open={volumeOpen}
                      onToggle={() => toggleVolume(volume)}
                    />
                    {volumeOpen && items.map((chapter) => (
                      <ChapterButton
                        chapter={chapter}
                        key={chapter.id}
                        selected={chapter.id === selectedChapterId}
                        onClick={() => setSelectedChapterId(chapter.id)}
                      />
                    ))}
                  </div>
                );
              })}
              {!chapters.isLoading && (chapters.data ?? []).length === 0 && <p className="muted">尚未索引正文。</p>}
              {!chapters.isLoading && (chapters.data ?? []).length > 0 && filteredChapters.length === 0 && (
                <p className="muted">没有匹配的章节。</p>
              )}
            </>
          )}
        </section>
      </div>
    </aside>
  );
}

function SourceSection({
  label,
  count,
  open,
  files,
  emptyText,
  selectedSourceFileId,
  onToggle,
  onSelectSource,
}: {
  label: string;
  count: number;
  open: boolean;
  files: SourceFile[];
  emptyText: string;
  selectedSourceFileId: number | null;
  onToggle: () => void;
  onSelectSource: (id: number) => void;
}) {
  return (
    <section className="catalog-section">
      <CatalogToggle label={label} count={count} open={open} onToggle={onToggle} />
      {open && (
        <>
          {files.length === 0 && <p className="muted">{emptyText}</p>}
          {files.map((file) => (
            <SourceButton key={file.id} file={file} selected={file.id === selectedSourceFileId} onClick={() => onSelectSource(file.id)} />
          ))}
        </>
      )}
    </section>
  );
}

function CatalogToggle({
  label,
  count,
  open,
  className = 'catalog-toggle',
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  className?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className={open ? 'catalog-arrow catalog-arrow--open' : 'catalog-arrow'}>›</span>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function SourceButton({ file, selected, onClick }: { file: SourceFile; selected: boolean; onClick: () => void }) {
  return (
    <button className={selected ? 'source-row source-row--active' : 'source-row'} title={file.path} type="button" onClick={onClick}>
      {file.path}
    </button>
  );
}

function ChapterButton({ chapter, selected, onClick }: { chapter: Chapter; selected: boolean; onClick: () => void }) {
  return (
    <button
      className={selected ? 'chapter-row chapter-row--active' : 'chapter-row'}
      type="button"
      onClick={onClick}
    >
      <span>{String(chapter.chapter_no).padStart(3, '0')}</span>
      <strong>{chapter.title}</strong>
    </button>
  );
}
