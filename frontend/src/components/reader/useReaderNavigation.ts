import { useMemo, useState } from 'react';
import type { Chapter } from '../../types';
import { useWorkbenchStore } from '../../store';

export function useReaderNavigation(chapters: Chapter[] | undefined) {
  const openChapterTabIds = useWorkbenchStore((state) => state.openChapterTabIds);
  const recentChapterIds = useWorkbenchStore((state) => state.recentChapterIds);
  const selectedChapterId = useWorkbenchStore((state) => state.selectedChapterId);
  const setSelectedChapterId = useWorkbenchStore((state) => state.setSelectedChapterId);
  const pushTask = useWorkbenchStore((state) => state.pushTask);
  const [jumpValue, setJumpValue] = useState('');

  const sortedChapters = useMemo(
    () => [...(chapters ?? [])].sort((a, b) => a.chapter_no - b.chapter_no),
    [chapters],
  );

  const tabChapters = useMemo(
    () => openChapterTabIds
      .map((id) => chapters?.find((chapter) => chapter.id === id))
      .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter)),
    [chapters, openChapterTabIds],
  );

  const currentChapterIndex = selectedChapterId === null
    ? -1
    : sortedChapters.findIndex((chapter) => chapter.id === selectedChapterId);
  const previousChapter = currentChapterIndex > 0 ? sortedChapters[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex >= 0 && currentChapterIndex < sortedChapters.length - 1
    ? sortedChapters[currentChapterIndex + 1]
    : null;
  const recentChapters = useMemo(
    () => recentChapterIds
      .map((id) => chapters?.find((chapter) => chapter.id === id))
      .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter))
      .slice(0, 5),
    [chapters, recentChapterIds],
  );

  const selectChapter = (chapterId: number) => setSelectedChapterId(chapterId);

  const jumpToChapter = () => {
    const normalized = jumpValue.trim();
    if (!normalized) {
      return;
    }
    const numeric = Number.parseInt(normalized, 10);
    const target = sortedChapters.find((chapter) =>
      Number.isFinite(numeric)
        ? chapter.chapter_no === numeric
        : chapter.title.includes(normalized),
    );
    if (!target) {
      pushTask({ label: '章节跳转', status: 'failed', detail: `没有找到"${normalized}"对应的章节。` });
      return;
    }
    if (selectChapter(target.id)) {
      setJumpValue('');
      pushTask({ label: '章节跳转', status: 'succeeded', detail: `已打开第 ${target.chapter_no} 章：${target.title}` });
    }
  };

  return {
    tabChapters,
    previousChapter,
    nextChapter,
    recentChapters,
    jumpValue,
    setJumpValue,
    jumpToChapter,
    selectChapter,
  };
}