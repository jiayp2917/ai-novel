import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail ?? detail;
    } catch {
      // Keep HTTP status fallback.
    }
    throw new Error(localizeApiError(detail));
  }
  return response.json() as Promise<T>;
}

function localizeApiError(detail: string): string {
  const exact: Record<string, string> = {
    'Workspace path does not exist or is not a directory': '工作区路径不存在，或不是文件夹。',
    'Workspace does not contain supported source directories': '工作区内没有识别到旧目录或 content 目录。',
    'Source file not found': '源文件不存在。',
    'Chapter not found': '正文章节不存在。',
    'Chapter has no current version': '章节缺少当前版本，请重新扫描素材库。',
    'Draft text is empty': '草稿内容为空，不能保存候选。',
    'Annotation not found': '批注不存在。',
    'Artifact not found': '候选产物不存在。',
    'Publish requires approved_by_user=true': '发布前必须人工确认。',
    'Publish requires a review': '发布前必须先审核候选。',
    'Review did not pass; force requires force_reason': '审核未通过，强制发布需要理由。',
    'Artifact file is missing': '候选产物文件缺失。',
    'Artifact file hash mismatch': '候选产物校验失败，请重新生成。',
    'Artifact path escapes runtime root': '候选产物路径越界，已阻止。',
    'Chapter candidate must start with a Markdown heading': '正文候选必须以 Markdown 章节标题开头。',
    'Chapter title changed; regenerate candidate or force after review': '章节标题发生变化，请重新生成候选或人工强制处理。',
    'Source file hash changed; rescan and regenerate candidate': '源文件已变化，请重新扫描并重新生成候选。',
    'Only settings and outlines can use source proposals': '只有设定和章纲可以生成源文件提案。',
    'Chapter source files must use chapter draft candidates': '正文源文件请通过章节草稿候选保存。',
    'Unsupported pipeline mode': '不支持的流水线模式。',
    'Invalid chapter range': '章节范围无效。',
    'chunk_size must be positive': '分片大小必须大于 0。',
    'max_fix_rounds must be between 0 and 5': '最大修复轮次必须在 0 到 5 之间。',
    'Pipeline run not found': '流水线任务不存在。',
  };
  return exact[detail] ?? detail;
}
