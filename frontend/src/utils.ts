import type { Annotation, CatalogStatus, Chapter, HealthPayload, SourceFile, WorkspaceStatus } from './types';

export const ANNOTATION_TYPES = [
  'style',
  'logic',
  'consistency',
  'ai_tone',
  'pacing',
  'character',
  'setting_conflict',
  'outline_drift',
  'typo',
  'example_rewrite',
  'manual_decision',
] as const;

export const SEVERITIES = ['low', 'medium', 'high', 'blocking'] as const;

export function utf16ToCodePointOffset(text: string, utf16Offset: number): number {
  return Array.from(text.slice(0, utf16Offset)).length;
}

export function codePointToUtf16Offset(text: string, codePointOffset: number): number {
  return Array.from(text).slice(0, codePointOffset).join('').length;
}

export function annotationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    style: '文风',
    logic: '逻辑',
    consistency: '一致性',
    ai_tone: 'AI 味',
    pacing: '节奏',
    character: '人物',
    setting_conflict: '设定冲突',
    outline_drift: '偏离章纲',
    typo: '错别字',
    example_rewrite: '示例改写',
    manual_decision: '人工决策',
  };
  return labels[type] ?? type;
}

export function severityLabel(severity: string): string {
  const labels: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
    blocking: '阻断',
  };
  return labels[severity] ?? severity;
}

export function annotationStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    open: '待处理',
    resolved: '已处理',
    ignored: '已忽略',
    needs_relocate: '需重定位',
    learned: '已学习',
  };
  return labels[status] ?? status;
}

export function layoutLabel(layout: WorkspaceStatus['layout'] | undefined): string {
  if (layout === 'legacy') {
    return '旧目录';
  }
  if (layout === 'content') {
    return 'content 目录';
  }
  return '未识别';
}

export function workspaceLocationLabel(location: WorkspaceStatus['workspace_location'] | undefined): string {
  if (location === 'in_repo') {
    return '仓库内旧工作区';
  }
  if (location === 'external') {
    return '外部作品工作区';
  }
  return '未识别';
}

export function groupSourceFiles(files: SourceFile[]) {
  return {
    system: files.filter((file) => file.path.startsWith('00-系统/')),
    settings: files.filter((file) => file.kind === 'settings' && !file.path.startsWith('00-系统/')),
    outlines: files.filter((file) => file.kind === 'outlines'),
    chapters: files.filter((file) => file.kind === 'chapters'),
  };
}

export function volumeName(path: string): string {
  const match = path.match(/02-正文\/([^/]+)/);
  return match?.[1] ?? '正文';
}

export function chaptersByVolume(chapters: Chapter[], sources: SourceFile[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const buckets = new Map<string, Chapter[]>();
  for (const chapter of chapters) {
    const source = sourceById.get(chapter.source_file_id);
    const volume = source ? volumeName(source.path) : '正文';
    buckets.set(volume, [...(buckets.get(volume) ?? []), chapter]);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function unparsedChapterFilesByVolume(paths: string[]) {
  const buckets = new Map<string, string[]>();
  for (const path of paths) {
    const volume = volumeName(path);
    buckets.set(volume, [...(buckets.get(volume) ?? []), path]);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function emptyChapterFoldersByVolume(status: CatalogStatus | undefined) {
  const paths = status?.empty_chapter_folders ?? [];
  return paths
    .map((path) => {
      const match = path.match(/02-正文\/(.+)/);
      return match?.[1] ?? path;
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function chapterMatchesFilter(chapter: Chapter, filter: string): boolean {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const padded = String(chapter.chapter_no).padStart(3, '0');
  return (
    padded.includes(normalized) ||
    String(chapter.chapter_no).includes(normalized) ||
    chapter.title.toLowerCase().includes(normalized)
  );
}

export function sourceKindLabel(kind: SourceFile['kind']): string {
  if (kind === 'settings') {
    return '设定';
  }
  if (kind === 'outlines') {
    return '章纲';
  }
  return '正文';
}

export function workspaceStatusFromHealth(health: HealthPayload | undefined): WorkspaceStatus | undefined {
  return health?.workspace;
}

export function activeAnnotationCount(annotations: Annotation[] | undefined): number {
  return annotations?.length ?? 0;
}
