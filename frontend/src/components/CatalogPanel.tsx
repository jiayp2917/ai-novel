/** 展示设定、章纲与章节目录的统一目录面板组件。 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { apiRequest } from '../api';
import { useCatalogStatus, useChapters, useSources } from '../hooks';
import { useWorkbenchStore } from '../store';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Button } from './ui/Button';
import type { Chapter, CreateSourceFilePayload, CreateSourceFileResult, SourceFile } from '../types';
import {
  chapterMatchesFilter,
  chaptersByVolume,
  emptyChapterFoldersByVolume,
  groupSourceFiles,
  unparsedChapterFilesByVolume,
  volumeName,
} from '../utils';

type CatalogSectionKey = 'settings' | 'outlines' | 'chapters';
type CreateMode = 'settings' | 'outlines' | 'chapter-folder' | 'chapter-file' | 'chapter-markdown';
type CatalogVariant = 'writing' | 'library' | 'ai';

export function CatalogPanel({ variant = 'writing' }: { variant?: CatalogVariant }) {
  const sources = useSources();
  const chapters = useChapters();
  const catalogStatus = useCatalogStatus();
  const showChapterCatalog = variant === 'writing' || variant === 'ai';
  const showSourceCatalog = variant === 'library';
  const showCreateButton = variant !== 'ai';
  const createModes = useMemo<CreateMode[]>(
    () => (variant === 'library' ? ['settings', 'outlines'] : ['chapter-folder', 'chapter-file', 'chapter-markdown']),
    [variant],
  );
  const visibleSourceCount = variant === 'library'
    ? groupedSourceCountPlaceholder(sources.data ?? [])
    : (chapters.data ?? []).length + unparsedSourceCount(sources.data ?? [], catalogStatus.data);
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const selectedSourceFileId = useWorkbenchStore((state) => state.selectedSourceFileId);
  const chapterFilter = useWorkbenchStore((state) => state.chapterFilter);
  const setSelectedChapterId = useWorkbenchStore((state) => state.setSelectedChapterId);
  const setSelectedSourceFileId = useWorkbenchStore((state) => state.setSelectedSourceFileId);
  const setChapterFilter = useWorkbenchStore((state) => state.setChapterFilter);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const queryClient = useQueryClient();
  const grouped = useMemo(() => groupSourceFiles(sources.data ?? []), [sources.data]);
  const unparsedFiles = useMemo(
    () => grouped.chapters.filter((file) => (catalogStatus.data?.unparsed_chapter_files ?? []).includes(file.path)),
    [catalogStatus.data?.unparsed_chapter_files, grouped.chapters],
  );
  const filteredChapters = useMemo(
    () => (chapters.data ?? []).filter((chapter) => chapterMatchesFilter(chapter, chapterFilter)),
    [chapters.data, chapterFilter],
  );
  const volumes = useMemo(() => chaptersByVolume(filteredChapters, sources.data ?? []), [filteredChapters, sources.data]);
  const unparsedVolumes = useMemo(
    () => unparsedChapterFilesByVolume(unparsedFiles.map((file) => file.path)),
    [unparsedFiles],
  );
  const emptyVolumes = useMemo(() => emptyChapterFoldersByVolume(catalogStatus.data), [catalogStatus.data]);
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
    return source ? volumeName(source.path) : '正文';
  }, [selectedChapter, sources.data]);
  const [openSections, setOpenSections] = useState<Record<CatalogSectionKey, boolean>>({
    settings: variant === 'library',
    outlines: variant === 'library',
    chapters: true,
  });
  const [openVolumes, setOpenVolumes] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);

  const invalidateCatalog = () => {
    void queryClient.invalidateQueries({ queryKey: ['workspace'] });
    void queryClient.invalidateQueries({ queryKey: ['health'] });
    void queryClient.invalidateQueries({ queryKey: ['source-files'] });
    void queryClient.invalidateQueries({ queryKey: ['chapters'] });
    void queryClient.invalidateQueries({ queryKey: ['catalog-status'] });
    void queryClient.invalidateQueries({ queryKey: ['memory-items'] });
    void queryClient.invalidateQueries({ queryKey: ['artifacts'] });
  };

  const normalizeMutation = useMutation({
    mutationFn: ({ sourceFileId, chapterNo, title }: { sourceFileId: number; chapterNo: number; title: string }) =>
      apiRequest<CreateSourceFileResult>(`/api/source-files/${sourceFileId}/normalize-chapter`, {
        method: 'POST',
        body: JSON.stringify({ chapter_no: chapterNo, title, confirm_normalize: true }),
      }),
    onMutate: () => pushTask({ label: '规范化章节', status: 'running', detail: '正在把正文 Markdown 转成可识别章节。' }),
    onSuccess: (result) => {
      invalidateCatalog();
      if (result.chapter_id) {
        setSelectedChapterId(result.chapter_id);
      }
      pushTask({ label: '规范化章节', status: 'succeeded', detail: '已生成标准章节标题，目录已刷新。' });
    },
    onError: (error: Error) => pushTask({ label: '规范化章节', status: 'failed', detail: error.message }),
  });

  useEffect(() => {
    if (!selectedSource) {
      return;
    }
    if (selectedSource.kind === 'settings') {
      setOpenSections((current) => ({ ...current, settings: true }));
    } else if (selectedSource.kind === 'outlines') {
      setOpenSections((current) => ({ ...current, outlines: true }));
    } else if (selectedSource.kind === 'chapters') {
      setOpenSections((current) => ({ ...current, chapters: true }));
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

  const sourceByPath = useMemo(() => new Map((sources.data ?? []).map((file) => [file.path, file])), [sources.data]);

  return (
    <aside className="panel catalog-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{variant === 'library' ? 'AI 上下文' : '正文管理'}</p>
          <h2>{variant === 'library' ? 'AI 素材库' : variant === 'ai' ? '章节选择' : '正文目录'}</h2>
        </div>
        <div className="catalog-header-actions">
          <span className="count-badge">{variant === 'library' ? grouped.settings.length + grouped.outlines.length : visibleSourceCount}</span>
          {showCreateButton && (
            <Button variant="secondary" className="catalog-add-button" onClick={() => setShowCreate(true)}>
              新增
            </Button>
          )}
        </div>
      </div>

      <div className="catalog-scroll">
        {showSourceCatalog && (
          <>
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
          </>
        )}

        {showChapterCatalog && (
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
              {chapters.isLoading && <p className="muted"><LoadingSpinner size="sm" /> 正在加载正文...</p>}
              <div className="catalog-subtitle">已识别章节</div>
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

              {(unparsedFiles.length > 0 || emptyVolumes.length > 0) && (
                <div className="catalog-subtitle catalog-subtitle--warn">未识别正文文件</div>
              )}
              {unparsedVolumes.map(([volume, paths]) => {
                const volumeOpen = openVolumes[`unparsed:${volume}`] ?? true;
                return (
                  <div className="volume-group" key={`unparsed:${volume}`}>
                    <CatalogToggle
                      className="volume-title"
                      label={`${volume}（未识别）`}
                      count={paths.length}
                      open={volumeOpen}
                      onToggle={() => toggleVolume(`unparsed:${volume}`)}
                    />
                    {volumeOpen && paths.map((path) => {
                      const file = sourceByPath.get(path);
                      if (!file) {
                        return null;
                      }
                      return (
                        <UnparsedSourceButton
                          key={file.id}
                          file={file}
                          selected={file.id === selectedSourceFileId}
                          normalizing={normalizeMutation.isPending && normalizeMutation.variables?.sourceFileId === file.id}
                          onSelect={() => setSelectedSourceFileId(file.id)}
                          onNormalize={(chapterNo, title) => normalizeMutation.mutate({ sourceFileId: file.id, chapterNo, title })}
                        />
                      );
                    })}
                  </div>
                );
              })}
              {emptyVolumes.map((volume) => (
                <div className="catalog-empty-volume" key={`empty:${volume}`}>
                  <strong>{volume}</strong>
                  <span>此卷还没有可识别章节。</span>
                </div>
              ))}
            </>
          )}
        </section>
        )}
      </div>

      {showCreate && (
        <CreateSourceDialog
          allowedModes={createModes}
          onClose={() => setShowCreate(false)}
          onCreated={(result) => {
            invalidateCatalog();
            if (result.chapter_id) {
              setSelectedChapterId(result.chapter_id);
            } else if (result.source_file_id) {
              setSelectedSourceFileId(result.source_file_id);
            }
            setShowCreate(false);
            pushTask({ label: '新增素材', status: 'succeeded', detail: '素材已创建并完成扫描。' });
          }}
          onError={(error) => pushTask({ label: '新增素材', status: 'failed', detail: error.message })}
        />
      )}
    </aside>
  );
}

function groupedSourceCountPlaceholder(files: SourceFile[]): number {
  const grouped = groupSourceFiles(files);
  return grouped.settings.length + grouped.outlines.length;
}

function unparsedSourceCount(files: SourceFile[], status: { unparsed_chapter_files?: string[] } | undefined): number {
  const unparsed = new Set(status?.unparsed_chapter_files ?? []);
  return files.filter((file) => file.kind === 'chapters' && unparsed.has(file.path)).length;
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

function UnparsedSourceButton({
  file,
  selected,
  normalizing,
  onSelect,
  onNormalize,
}: {
  file: SourceFile;
  selected: boolean;
  normalizing: boolean;
  onSelect: () => void;
  onNormalize: (chapterNo: number, title: string) => void;
}) {
  const [chapterNo, setChapterNo] = useState('');
  const [title, setTitle] = useState('');
  const normalizedNo = Number.parseInt(chapterNo, 10);
  const canNormalize = Number.isFinite(normalizedNo) && normalizedNo > 0 && title.trim().length > 0;
  return (
    <div className={selected ? 'unparsed-row unparsed-row--active' : 'unparsed-row'}>
      <button className="source-row" title={file.path} type="button" onClick={onSelect}>
        {file.path}
      </button>
      <div className="unparsed-row__tools">
        <input aria-label="规范化章号" value={chapterNo} onChange={(event) => setChapterNo(event.target.value)} placeholder="章号" />
        <input aria-label="规范化标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题" />
        <Button
          variant="secondary"
          onClick={() => onNormalize(normalizedNo, title.trim())}
          disabled={!canNormalize || normalizing}
          loading={normalizing}
        >
          {normalizing ? '处理中...' : '转为章节'}
        </Button>
      </div>
    </div>
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

function CreateSourceDialog({
  allowedModes,
  onClose,
  onCreated,
  onError,
}: {
  allowedModes: CreateMode[];
  onClose: () => void;
  onCreated: (result: CreateSourceFileResult) => void;
  onError: (error: Error) => void;
}) {
  const [mode, setMode] = useState<CreateMode>(allowedModes.includes('chapter-file') ? 'chapter-file' : (allowedModes[0] ?? 'settings'));
  const [folder, setFolder] = useState('06卷');
  const [filename, setFilename] = useState('');
  const [chapterNo, setChapterNo] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const formId = useId();
  const modeId = `${formId}-mode`;
  const folderId = `${formId}-folder`;
  const filenameId = `${formId}-filename`;
  const chapterNoId = `${formId}-chapter-no`;
  const titleId = `${formId}-title`;
  const contentId = `${formId}-content`;

  const createFileMutation = useMutation({
    mutationFn: (payload: CreateSourceFilePayload) =>
      apiRequest<CreateSourceFileResult>('/api/source-files/create', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: onCreated,
    onError: (err: Error) => {
      setError(err.message);
      onError(err);
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: (payload: { root: string; folder: string }) =>
      apiRequest<{ path: string; created: boolean; scan: unknown }>('/api/source-folders/create', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => onCreated({ path: result.path, source_file_id: null, chapter_id: null, scan: result.scan as CreateSourceFileResult['scan'] }),
    onError: (err: Error) => {
      setError(err.message);
      onError(err);
    },
  });

  const busy = createFileMutation.isPending || createFolderMutation.isPending;
  const root = modeRoot(mode);
  const parsedChapterNo = Number.parseInt(chapterNo, 10);
  const finalFilename = filename.trim() || defaultFilename(mode, parsedChapterNo, title);
  const canSubmit = mode === 'chapter-folder'
    ? folder.trim().length > 0
    : finalFilename.trim().length > 0 && (mode !== 'chapter-file' || (Number.isFinite(parsedChapterNo) && parsedChapterNo > 0 && title.trim().length > 0));

  const submit = () => {
    setError('');
    if (mode === 'chapter-folder') {
      createFolderMutation.mutate({ root: 'chapters', folder });
      return;
    }
    createFileMutation.mutate({
      root,
      folder: mode === 'chapter-file' || mode === 'chapter-markdown' ? folder : '',
      filename: finalFilename,
      template: mode === 'chapter-file' ? 'chapter' : 'blank',
      title: title.trim() || undefined,
      chapter_no: mode === 'chapter-file' ? parsedChapterNo : null,
      content,
    });
  };
  const clearError = () => setError('');

  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog source-create-dialog" role="dialog" aria-modal="true" aria-labelledby="source-create-title">
        <div className="confirm-dialog__header">
          <span className="confirm-dialog__mark confirm-dialog__mark--publish">新</span>
          <div>
            <h3 id="source-create-title">新增素材</h3>
            <p>新内容会先写入当前作品目录，再刷新素材索引。</p>
          </div>
        </div>
        <div className="source-create-form">
          <label htmlFor={modeId}>
            类型
            <select
              id={modeId}
              value={mode}
              onChange={(event) => {
                clearError();
                setMode(event.target.value as CreateMode);
              }}
            >
              {allowedModes.includes('settings') && <option value="settings">小说设定</option>}
              {allowedModes.includes('outlines') && <option value="outlines">章纲</option>}
              {allowedModes.includes('chapter-folder') && <option value="chapter-folder">正文卷</option>}
              {allowedModes.includes('chapter-file') && <option value="chapter-file">正文章节文件</option>}
              {allowedModes.includes('chapter-markdown') && <option value="chapter-markdown">普通正文 Markdown</option>}
            </select>
          </label>
          {(mode === 'chapter-folder' || mode === 'chapter-file' || mode === 'chapter-markdown') && (
            <label htmlFor={folderId}>
              卷/文件夹
              <input
                id={folderId}
                value={folder}
                onChange={(event) => {
                  clearError();
                  setFolder(event.target.value);
                }}
                placeholder="例如：06卷"
              />
            </label>
          )}
          {mode !== 'chapter-folder' && (
            <label htmlFor={filenameId}>
              文件名
              <input
                id={filenameId}
                value={filename}
                onChange={(event) => {
                  clearError();
                  setFilename(event.target.value);
                }}
                placeholder={defaultFilename(mode, parsedChapterNo, title)}
              />
            </label>
          )}
          {mode === 'chapter-file' && (
            <div className="source-create-grid">
              <label htmlFor={chapterNoId}>
                章号
                <input
                  id={chapterNoId}
                  value={chapterNo}
                  onChange={(event) => {
                    clearError();
                    setChapterNo(event.target.value);
                  }}
                  placeholder="146"
                />
              </label>
              <label htmlFor={titleId}>
                标题
                <input
                  id={titleId}
                  value={title}
                  onChange={(event) => {
                    clearError();
                    setTitle(event.target.value);
                  }}
                  placeholder="新的章节标题"
                />
              </label>
            </div>
          )}
          {mode !== 'chapter-file' && mode !== 'chapter-folder' && (
            <label htmlFor={titleId}>
              标题
              <input
                id={titleId}
                value={title}
                onChange={(event) => {
                  clearError();
                  setTitle(event.target.value);
                }}
                placeholder="可选"
              />
            </label>
          )}
          {mode !== 'chapter-folder' && (
            <label htmlFor={contentId}>
              初始内容
              <textarea
                id={contentId}
                value={content}
                onChange={(event) => {
                  clearError();
                  setContent(event.target.value);
                }}
                placeholder="可留空，稍后再写。"
              />
            </label>
          )}
          {mode === 'chapter-markdown' && <div className="notice warn">普通正文 Markdown 不会直接成为章节；需要补充章号和标题后，才能转为可发布的正文章节。</div>}
          {mode === 'chapter-file' && <div className="notice safe">正文章节文件会自动生成标准标题，扫描后进入章节目录。</div>}
          {error && <div className="inline-error">{error}</div>}
        </div>
        <div className="confirm-dialog__actions">
          <Button
            variant="secondary"
            onClick={() => {
              clearError();
              onClose();
            }}
            disabled={busy}
          >
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit || busy} loading={busy}>
            {busy ? '创建中...' : '创建并扫描'}
          </Button>
        </div>
      </section>
    </div>
  );
}

function modeRoot(mode: CreateMode): CreateSourceFilePayload['root'] {
  if (mode === 'settings') {
    return 'settings';
  }
  if (mode === 'outlines') {
    return 'outlines';
  }
  return 'chapters';
}

function defaultFilename(mode: CreateMode, chapterNo: number, title: string): string {
  if (mode === 'chapter-file' && Number.isFinite(chapterNo) && chapterNo > 0) {
    return `第${String(chapterNo).padStart(3, '0')}章.md`;
  }
  if (mode === 'chapter-markdown') {
    return title.trim() ? `${title.trim()}.md` : '未命名正文.md';
  }
  if (mode === 'outlines') {
    return title.trim() ? `${title.trim()}.md` : '新章纲.md';
  }
  if (mode === 'settings') {
    return title.trim() ? `${title.trim()}.md` : '小说设定.md';
  }
  return '';
}
