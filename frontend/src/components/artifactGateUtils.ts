import type { Artifact } from '../types';

export function isManualEditorDraft(artifact: Artifact): boolean {
  return artifact.kind === 'candidate'
    && artifact.metadata.source === 'manual_editor_draft'
    && artifact.metadata.requires_ai_review === false
    && artifact.base_chapter_id !== null;
}

export function validateArtifactContext(
  artifact: Artifact | undefined,
  expected: { baseChapterId?: number; baseSourceFileId?: number; artifactKind: string },
): { valid: boolean; message: string } {
  if (!artifact) {
    return { valid: true, message: '' };
  }
  if (artifact.kind !== expected.artifactKind) {
    return {
      valid: false,
      message: `草稿类型不匹配：当前需要 ${expected.artifactKind}，实际是 ${artifact.kind}。`,
    };
  }
  if (expected.baseChapterId !== undefined && artifact.base_chapter_id !== expected.baseChapterId) {
    return {
      valid: false,
      message: '草稿不属于当前章节，不能在这里检查、查看改动或写回。',
    };
  }
  if (expected.baseSourceFileId !== undefined && artifact.base_source_file_id !== expected.baseSourceFileId) {
    return {
      valid: false,
      message: '提案不属于当前文件，不能在这里检查或查看改动。',
    };
  }
  return { valid: true, message: '' };
}

export function publishBlockReason({
  artifact,
  allowPublish,
  diffReady,
}: {
  artifact: Artifact;
  allowPublish: boolean;
  diffReady: boolean;
}): string | null {
  if (!allowPublish || artifact.kind !== 'candidate') {
    return '设定/章纲提案只能人工采纳，不在这里写回正文。';
  }
  const manualDraft = isManualEditorDraft(artifact);
  if (!manualDraft && !artifact.latest_review) {
    return '草稿还没有检查记录。';
  }
  if (artifact.latest_review && !artifact.latest_review.passed) {
    return artifact.latest_review.manual_required ? '检查结果需要人工判断。' : '检查未通过。';
  }
  if (!diffReady && !artifact.latest_publish) {
    return '尚未查看改动对比。';
  }
  if (artifact.latest_publish) {
    return '这个草稿已经写回过，请保存新的草稿后再写回。';
  }
  return null;
}

export function operationBlockReason({
  artifactId,
  artifact,
  validationValid,
  isLoading,
}: {
  artifactId: number | null;
  artifact: Artifact | undefined;
  validationValid: boolean;
  isLoading: boolean;
}): string | null {
  if (!artifactId) {
    return '请先选择草稿。';
  }
  if (isLoading) {
    return '正在校验草稿归属。';
  }
  if (!artifact) {
    return '草稿不存在或尚未加载完成。';
  }
  if (!validationValid) {
    return '草稿不属于当前章节或当前文件。';
  }
  return null;
}

export function reviewStatus(review: { passed: boolean; manual_required: boolean } | null): string {
  if (!review) {
    return '未检查';
  }
  if (review.passed) {
    return '检查通过';
  }
  return review.manual_required ? '需人工判断' : '需修改';
}

export function reviewLabel(passed: boolean, manualRequired: boolean): string {
  if (passed) {
    return '检查通过';
  }
  return manualRequired ? '需人工判断' : '需修改';
}

export function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 10)}...` : '无';
}
