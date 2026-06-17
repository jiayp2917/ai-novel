// Centralized query-key factory. Every React Query cache key in the app
// is generated through this module so that callers cannot drift apart.
export const queryKeys = {
  health: () => ['health'] as const,
  workspace: () => ['workspace'] as const,
  catalogStatus: () => ['catalog-status'] as const,
  chapters: {
    all: () => ['chapters'] as const,
    list: () => ['chapters', 'list'] as const,
    detail: (id: string) => ['chapters', 'detail', id] as const,
    content: (chapterId: number | null) => ['chapter-content', chapterId] as const,
    versions: (chapterId: number | null) => ['chapter-versions', chapterId] as const,
    versionContent: (chapterId: number | null, versionId: number | null) =>
      ['chapter-version-content', chapterId, versionId] as const,
  },
  sources: {
    all: () => ['sources'] as const,
    list: () => ['sources', 'list'] as const,
    files: () => ['source-files'] as const,
    fileContent: (sourceFileId: number | null) => ['source-file-content', sourceFileId] as const,
    annotations: (sourceFileId: number | null) => ['source-annotations', sourceFileId] as const,
  },
  artifacts: {
    all: () => ['artifacts'] as const,
    forChapter: (chapterId: string) => ['artifacts', 'chapter', chapterId] as const,
    list: (filters: {
      baseChapterId?: number | null;
      baseSourceFileId?: number | null;
      kind?: string | null;
      limit?: number | null;
    }) =>
      [
        'artifacts',
        filters.baseChapterId ?? null,
        filters.baseSourceFileId ?? null,
        filters.kind ?? null,
        filters.limit ?? null,
      ] as const,
    detail: (artifactId: number | null) => ['artifact', artifactId] as const,
    text: (artifactId: number | null) => ['artifact-text', artifactId] as const,
  },
  jobs: {
    all: () => ['jobs'] as const,
    list: () => ['jobs', 'list'] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
    modelCalls: (limit: number, failedOnly: boolean) =>
      ['model-calls', limit, failedOnly] as const,
    events: () => ['events'] as const,
    publishDecisions: () => ['publish-decisions'] as const,
    pipelineRuns: () => ['pipeline-runs'] as const,
    modelConstraints: () => ['model-constraints'] as const,
    modelRoutes: () => ['model-routes'] as const,
    modelConfig: () => ['model-config'] as const,
    skills: () => ['skills'] as const,
    memoryItems: () => ['memory-items'] as const,
  },
  cost: {
    dashboard: () => ['cost', 'dashboard'] as const,
  },
  models: {
    list: () => ['models', 'list'] as const,
    usage: () => ['models', 'usage'] as const,
    usageReport: () => ['model-usage-report'] as const,
  },
  annotations: {
    forChapter: (chapterId: string) => ['annotations', 'chapter', chapterId] as const,
    listForChapter: (chapterId: number | null) => ['annotations', chapterId] as const,
    insights: () => ['annotations', 'insights'] as const,
    annotationInsights: () => ['annotation-insights'] as const,
  },
} as const;