import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api';
import type {
  Annotation,
  AnnotationInsight,
  Artifact,
  ArtifactText,
  CatalogStatus,
  Chapter,
  ChapterContent,
  ChapterVersionContent,
  ChapterVersion,
  CostDashboard,
  EventRecord,
  HealthPayload,
  Job,
  MemoryItem,
  ModelCallRecord,
  ModelConfigPayload,
  ModelUsageReport,
  ModelRoutesPayload,
  ModelConstraints,
  PipelineRun,
  PublishDecisionRecord,
  SkillsPayload,
  SourceFile,
  SourceFileContent,
  WorkspaceStatus,
} from './types';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiRequest<HealthPayload>('/health'),
    retry: false,
  });
}

export function useWorkspace() {
  return useQuery({
    queryKey: ['workspace'],
    queryFn: () => apiRequest<WorkspaceStatus>('/api/workspace'),
    retry: false,
  });
}

export function useSources() {
  return useQuery({
    queryKey: ['source-files'],
    queryFn: () => apiRequest<SourceFile[]>('/api/source-files'),
  });
}

export function useChapters() {
  return useQuery({
    queryKey: ['chapters'],
    queryFn: () => apiRequest<Chapter[]>('/api/chapters'),
  });
}

export function useCatalogStatus() {
  return useQuery({
    queryKey: ['catalog-status'],
    queryFn: () => apiRequest<CatalogStatus>('/api/library/catalog-status'),
  });
}

export function useChapterContent(chapterId: number | null) {
  return useQuery({
    queryKey: ['chapter-content', chapterId],
    queryFn: () => apiRequest<ChapterContent>(`/api/chapters/${chapterId}/content`),
    enabled: chapterId !== null,
  });
}

export function useChapterVersions(chapterId: number | null) {
  return useQuery({
    queryKey: ['chapter-versions', chapterId],
    queryFn: () => apiRequest<ChapterVersion[]>(`/api/chapters/${chapterId}/versions`),
    enabled: chapterId !== null,
  });
}

export function useChapterVersionContent(chapterId: number | null, versionId: number | null) {
  return useQuery({
    queryKey: ['chapter-version-content', chapterId, versionId],
    queryFn: () => apiRequest<ChapterVersionContent>(`/api/chapters/${chapterId}/versions/${versionId}/content`),
    enabled: chapterId !== null && versionId !== null,
    retry: false,
  });
}

export function useSourceFileContent(sourceFileId: number | null) {
  return useQuery({
    queryKey: ['source-file-content', sourceFileId],
    queryFn: () => apiRequest<SourceFileContent>(`/api/source-files/${sourceFileId}`),
    enabled: sourceFileId !== null,
  });
}

export function useAnnotations(chapterId: number | null) {
  return useQuery({
    queryKey: ['annotations', chapterId],
    queryFn: () => apiRequest<Annotation[]>(`/api/chapters/${chapterId}/annotations`),
    enabled: chapterId !== null,
  });
}

export function useSourceAnnotations(sourceFileId: number | null) {
  return useQuery({
    queryKey: ['source-annotations', sourceFileId],
    queryFn: () => apiRequest<Annotation[]>(`/api/source-files/${sourceFileId}/annotations`),
    enabled: sourceFileId !== null,
  });
}

export function useAnnotationInsights() {
  return useQuery({
    queryKey: ['annotation-insights'],
    queryFn: () => apiRequest<AnnotationInsight[]>('/api/annotation-insights'),
  });
}

export function useCostDashboard() {
  return useQuery({
    queryKey: ['cost-dashboard'],
    queryFn: () => apiRequest<CostDashboard>('/api/jobs/cost-dashboard'),
    refetchInterval: 5000,
  });
}

export function useModelConstraints() {
  return useQuery({
    queryKey: ['model-constraints'],
    queryFn: () => apiRequest<ModelConstraints>('/api/jobs/model-constraints'),
  });
}

export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => apiRequest<Job[]>('/api/jobs'),
    refetchInterval: 5000,
  });
}

export function useModelCalls(limit = 50, failedOnly = false) {
  return useQuery({
    queryKey: ['model-calls', limit, failedOnly],
    queryFn: () => apiRequest<ModelCallRecord[]>(`/api/jobs/model-calls?limit=${limit}&failed_only=${failedOnly ? 'true' : 'false'}`),
    refetchInterval: 5000,
  });
}

export function useModelUsageReport() {
  return useQuery({
    queryKey: ['model-usage-report'],
    queryFn: () => apiRequest<ModelUsageReport>('/api/jobs/model-usage-report?days=30&limit=500'),
    refetchInterval: 10000,
  });
}

export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: () => apiRequest<EventRecord[]>('/api/jobs/events'),
    refetchInterval: 5000,
  });
}

export function usePublishDecisions() {
  return useQuery({
    queryKey: ['publish-decisions'],
    queryFn: () => apiRequest<PublishDecisionRecord[]>('/api/jobs/publish-decisions'),
    refetchInterval: 5000,
  });
}

export function usePipelineRuns() {
  return useQuery({
    queryKey: ['pipeline-runs'],
    queryFn: () => apiRequest<PipelineRun[]>('/api/pipeline/runs?limit=100'),
    refetchInterval: 5000,
  });
}

export function useMemoryItems() {
  return useQuery({
    queryKey: ['memory-items'],
    queryFn: () => apiRequest<MemoryItem[]>('/api/memory'),
  });
}

export function useModelRoutes() {
  return useQuery({
    queryKey: ['model-routes'],
    queryFn: () => apiRequest<ModelRoutesPayload>('/api/admin/model-routes'),
  });
}

export function useModelConfig() {
  return useQuery({
    queryKey: ['model-config'],
    queryFn: () => apiRequest<ModelConfigPayload>('/api/admin/model-config'),
  });
}

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => apiRequest<SkillsPayload>('/api/admin/skills'),
  });
}

export function useArtifacts(filters: { baseChapterId?: number | null; baseSourceFileId?: number | null; kind?: string | null; limit?: number | null }) {
  const params = new URLSearchParams();
  if (filters.baseChapterId) {
    params.set('base_chapter_id', String(filters.baseChapterId));
  }
  if (filters.baseSourceFileId) {
    params.set('base_source_file_id', String(filters.baseSourceFileId));
  }
  if (filters.kind) {
    params.set('kind', filters.kind);
  }
  if (filters.limit) {
    params.set('limit', String(filters.limit));
  }
  const query = params.toString();
  return useQuery({
    queryKey: ['artifacts', filters.baseChapterId ?? null, filters.baseSourceFileId ?? null, filters.kind ?? null, filters.limit ?? null],
    queryFn: () => apiRequest<Artifact[]>(`/api/artifacts${query ? `?${query}` : ''}`),
  });
}

export function useArtifact(artifactId: number | null) {
  return useQuery({
    queryKey: ['artifact', artifactId],
    queryFn: () => apiRequest<Artifact>(`/api/artifacts/${artifactId}`),
    enabled: artifactId !== null,
    retry: false,
  });
}

export function useArtifactText(artifactId: number | null) {
  return useQuery({
    queryKey: ['artifact-text', artifactId],
    queryFn: () => apiRequest<ArtifactText>(`/api/artifacts/${artifactId}/text`),
    enabled: artifactId !== null,
    retry: false,
  });
}
