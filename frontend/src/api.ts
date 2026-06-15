import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
const adminApiToken = import.meta.env.VITE_ADMIN_API_TOKEN ?? '';

export class ApiRequestError extends Error {
  status: number;
  detail: string;

  constructor(message: string, status: number, detail: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...adminHeaders(path),
    ...(init?.headers ?? {}),
  };
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers,
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
    throw new ApiRequestError(localizeApiError(detail), response.status, detail);
  }
  return response.json() as Promise<T>;
}

function adminHeaders(path: string): Record<string, string> {
  if (!adminApiToken || !path.startsWith('/api/')) {
    return {};
  }
  return { Authorization: `Bearer ${adminApiToken}` };
}

function localizeApiError(detail: string): string {
  const exact: Record<string, string> = {
    'Workspace path does not exist or is not a directory': '工作区路径不存在，或不是文件夹。',
    'Workspace does not contain supported source directories': '工作区内没有识别到 content/settings、content/outlines、content/chapters 目录。',
    'Source file not found': '源文件不存在。',
    'Source file already exists': '同名文件已经存在，请换一个文件名。',
    'Folder path already exists as a file': '这个路径已经是文件，不能创建为文件夹。',
    'Filename is required': '请填写文件名。',
    'Folder name is required': '请填写文件夹名称。',
    'Filename must not contain folders': '文件名不能包含文件夹路径。',
    'Folder path contains protected or unsafe parts': '文件夹路径包含不安全内容。',
    'Protected workspace paths cannot be modified': '不能修改 runtime、key 或环境配置等受保护路径。',
    'Protected filename is not allowed': '不能使用受保护的文件名。',
    'Unsupported source root': '不支持的素材目录。',
    'Source root is not available in current workspace': '当前作品没有这个素材目录。',
    'Unsupported source file template': '不支持的文件模板。',
    'Chapter template can only be created under chapter sources': '正文章节只能创建在正文目录下。',
    'Chapter number must be positive': '章号必须大于 0。',
    'Chapter number already exists': '这个章号已经存在，请换一个章号。',
    'Only chapter source files can be normalized': '只有正文 Markdown 文件可以规范化为章节。',
    'Source file already contains recognized chapters': '这个文件已经包含可识别章节，不需要规范化。',
    'Chapter not found': '正文章节不存在。',
    'Chapter has no current version': '章节缺少当前版本，请重新扫描素材库。',
    'Chapter version not found': '正文版本不存在。',
    'Chapter version snapshot is missing': '这个正文版本缺少可查看的正文内容，不能预览或发布。',
    'Chapter version is already current': '这个版本已经是当前正文。',
    'Version publish requires approved_by_user=true': '发布正文版本前必须人工确认。',
    'Chapter version must start with a Markdown heading': '正文版本必须以 Markdown 章节标题开头。',
    'Source file hash changed; rescan before publishing version': '源文件已变化，请重新扫描后再发布正文版本。',
    'Source file hash changed before version publish write': '写入前源文件发生变化，已阻止发布。',
    'Only chapter versions can be published': '只有正文版本可以发布。',
    'Chapter version path escapes runtime root': '正文版本内容路径越界，已阻止。',
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
    'Pipeline run must be stopped or completed before deletion': '这条流水线还不能删除。请先停止，或等它完成后再删除。',
    'Pipeline run has active child tasks; stop it before deletion': '这条流水线仍有正在运行、暂停或可重试的步骤。请先停止后再删除。',
  };
  return exact[detail] ?? detail;
}
