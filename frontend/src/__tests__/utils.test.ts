import { describe, it, expect } from 'vitest';
import {
  annotationTypeLabel,
  severityLabel,
  groupSourceFiles,
  volumeName,
  chaptersByVolume,
  chapterMatchesFilter,
  sourceKindLabel,
  activeAnnotationCount,
} from '../utils';
import type { Chapter, SourceFile } from '../types';

describe('annotationTypeLabel', () => {
  it('returns Chinese label for known types', () => {
    expect(annotationTypeLabel('style')).toBe('文风');
    expect(annotationTypeLabel('logic')).toBe('逻辑');
    expect(annotationTypeLabel('typo')).toBe('错别字');
  });

  it('returns raw string for unknown types', () => {
    expect(annotationTypeLabel('unknown')).toBe('unknown');
  });
});

describe('severityLabel', () => {
  it('returns Chinese label for known severities', () => {
    expect(severityLabel('low')).toBe('低');
    expect(severityLabel('medium')).toBe('中');
    expect(severityLabel('high')).toBe('高');
    expect(severityLabel('blocking')).toBe('阻断');
  });

  it('returns raw string for unknown severities', () => {
    expect(severityLabel('critical')).toBe('critical');
  });
});

describe('groupSourceFiles', () => {
  it('groups files by kind and path prefix', () => {
    const files: SourceFile[] = [
      { id: 1, path: 'content/settings/config.md', kind: 'settings', active: true },
      { id: 2, path: 'content/settings/world.md', kind: 'settings', active: true },
      { id: 3, path: 'content/outlines/vol1.md', kind: 'outlines', active: true },
      { id: 4, path: 'content/chapters/vol1/chapter.md', kind: 'chapters', active: true },
    ];
    const result = groupSourceFiles(files);
    expect(result.settings).toHaveLength(2);
    expect(result.outlines).toHaveLength(1);
    expect(result.chapters).toHaveLength(1);
  });
});

describe('volumeName', () => {
  it('extracts volume from path', () => {
    expect(volumeName('content/chapters/第一卷/chapter.md')).toBe('第一卷');
  });

  it('returns default for paths without volume', () => {
    expect(volumeName('other/path.md')).toBe('正文');
  });
});

describe('chaptersByVolume', () => {
  it('groups chapters by volume', () => {
    const sources: SourceFile[] = [
      { id: 1, path: 'content/chapters/第一卷/ch1.md', kind: 'chapters', active: true },
      { id: 2, path: 'content/chapters/第二卷/ch2.md', kind: 'chapters', active: true },
    ];
    const chapters: Chapter[] = [
      { id: 1, chapter_no: 1, title: '第一章', source_file_id: 1, current_version_id: null, active: true },
      { id: 2, chapter_no: 2, title: '第二章', source_file_id: 2, current_version_id: null, active: true },
    ];
    const result = chaptersByVolume(chapters, sources);
    expect(result).toHaveLength(2);
  });
});

describe('chapterMatchesFilter', () => {
  const chapter: Chapter = { id: 1, chapter_no: 5, title: '风云际会', source_file_id: 1, current_version_id: null, active: true };

  it('matches by chapter number (padded)', () => {
    expect(chapterMatchesFilter(chapter, '005')).toBe(true);
  });

  it('matches by chapter number (raw)', () => {
    expect(chapterMatchesFilter(chapter, '5')).toBe(true);
  });

  it('matches by title', () => {
    expect(chapterMatchesFilter(chapter, '风云')).toBe(true);
  });

  it('does not match unrelated filter', () => {
    expect(chapterMatchesFilter(chapter, 'xyz')).toBe(false);
  });

  it('matches everything with empty filter', () => {
    expect(chapterMatchesFilter(chapter, '')).toBe(true);
  });
});

describe('sourceKindLabel', () => {
  it('returns correct labels', () => {
    expect(sourceKindLabel('settings')).toBe('设定');
    expect(sourceKindLabel('outlines')).toBe('章纲');
    expect(sourceKindLabel('chapters')).toBe('正文');
  });
});

describe('activeAnnotationCount', () => {
  it('returns count for non-empty array', () => {
    expect(activeAnnotationCount([{}, {}] as any)).toBe(2);
  });

  it('returns 0 for undefined', () => {
    expect(activeAnnotationCount(undefined)).toBe(0);
  });
});
