export type ActiveView =
  | 'home'
  | 'workspace'
  | 'writing'
  | 'planning'
  | 'pipeline'
  | 'review'
  | 'memory'
  | 'fix_publish'
  | 'models';

export type ThemeMode = 'dark' | 'light';

export type InspectorTab = 'annotations' | 'candidates' | 'review' | 'memory';

export type WorkspaceStatus = {
  root: string;
  layout: 'legacy' | 'content' | 'unsupported';
  app_root?: string;
  app_runtime_root?: string;
  runtime_root?: string;
  runtime_override?: boolean;
  workspace_location?: 'in_repo' | 'external';
  detected_counts: Record<string, number>;
  source_roots: Array<{
    path: string;
    relative_path: string;
    kind: 'settings' | 'outlines' | 'chapters';
    label: string;
    exists: boolean;
  }>;
};

export type HealthPayload = {
  status: string;
  service: string;
  content_root: string;
  runtime_root: string;
  low_cost_mode: boolean;
  workspace: WorkspaceStatus;
};

export type SourceFile = {
  id: number;
  path: string;
  kind: 'settings' | 'outlines' | 'chapters';
  active: boolean;
};

export type SourceFileContent = SourceFile & {
  text: string;
  offset_unit: 'python_code_point';
};

export type Chapter = {
  id: number;
  chapter_no: number;
  title: string;
  source_file_id: number;
  current_version_id: number | null;
  active: boolean;
};

export type ChapterContent = Chapter & {
  text: string;
  offset_unit: 'python_code_point';
};

export type Annotation = {
  id: number;
  chapter_id: number | null;
  chapter_version_id: number | null;
  source_file_id: number;
  range_start: number;
  range_end: number;
  quote_text: string;
  type: string;
  severity: string;
  comment: string;
  example_rewrite: string | null;
  status: string;
};

export type ReviewSummary = {
  id: number;
  passed: boolean;
  manual_required: boolean;
  evidence_count: number;
  issues: Array<Record<string, unknown>>;
  created_at: string;
};

export type PublishSummary = {
  id: number;
  approved_by_user: boolean;
  force: boolean;
  diff_path: string;
  backup_path: string;
  published_at: string;
};

export type Artifact = {
  id: number;
  kind: string;
  path: string;
  sha256: string;
  base_source_file_id: number | null;
  base_source_file_hash: string | null;
  base_chapter_id: number | null;
  base_chapter_version_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  latest_review: ReviewSummary | null;
  latest_publish: PublishSummary | null;
};

export type AnnotationPayload = {
  range_start: number;
  range_end: number;
  type: string;
  severity: string;
  comment: string;
  example_rewrite?: string | null;
};

export type AnnotationInsight = {
  id: number;
  kind: string;
  content: string;
  enabled: boolean;
  confidence: number;
};

export type CostDashboard = {
  today_model_calls: number;
  today_estimated_cost: number;
  input_chars: number;
  output_chars: number;
  cache_hits: number;
  provider_usage_count: number;
  cache_usage_count: number;
  running_jobs: number;
};

export type ModelConstraints = {
  low_cost_mode: boolean;
  enable_model_concurrency: boolean;
  model_max_concurrency: number;
  writer_max_concurrency: number;
  reviewer_max_concurrency: number;
  memory_max_concurrency: number;
  provider_max_concurrency: number;
  model_timeout_seconds: number;
  daily_max_model_calls: number;
  daily_max_estimated_cost: number;
  max_input_chars_per_call: number;
  max_output_tokens_per_call: number;
  kimi_thinking_mode: string;
  glm_thinking_mode: string;
  usage_note: string;
};

export type Job = {
  id: number;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  locked_chapter_id: number | null;
  locked_source_file_id: number | null;
  created_at?: string;
  updated_at?: string;
};

export type ModelCallRecord = {
  id: number;
  role: string;
  provider: string;
  model: string;
  prompt_hash: string;
  input_chars: number;
  output_chars: number;
  usage: Record<string, unknown>;
  cost_estimate: number | null;
  cache_hit: boolean;
  status: string;
  error: string | null;
  created_at?: string;
};

export type EventRecord = {
  id: number;
  event_type: string;
  entity_type: string;
  entity_id: number;
  payload: Record<string, unknown>;
  created_at?: string;
};

export type PublishDecisionRecord = {
  id: number;
  artifact_id: number;
  approved_by_user: boolean;
  force: boolean;
  force_reason: string | null;
  source_hash_before: string;
  candidate_hash: string;
  diff_path: string;
  backup_path: string;
  published_at: string | null;
};

export type PipelineRun = {
  id: number;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  created_at?: string;
  updated_at?: string;
  child_tasks: Job[];
};

export type PipelineRunCreatePayload = {
  start_chapter: number;
  end_chapter: number;
  mode: 'review_only' | 'generate_missing' | 'review_fix' | 'full_auto';
  chunk_size: number;
  max_fix_rounds: number;
  dry_run: boolean;
};

export type ContextPreview = {
  chapter_id: number;
  core_facts: Array<Record<string, unknown>>;
  chapter_card: Record<string, unknown> | null;
  structured_state: Record<string, unknown> | null;
  annotation_insights: Array<Record<string, unknown>>;
};

export type MemoryItem = {
  id: number;
  kind: string;
  scope: string;
  content_json: string;
  source_hash: string;
  stale?: boolean;
};

export type ModelRouteInfo = {
  provider?: string;
  model?: string;
  base_url?: string;
  max_tokens?: number;
  cheap?: boolean;
  supports_json?: boolean;
  api_key_env?: string;
  error?: string;
};

export type ModelRoutesPayload = {
  routes: Record<string, ModelRouteInfo>;
};

export type SkillInfo = {
  name: string;
  version: string;
  role: string;
  scope: string;
  enabled: boolean;
  path: string;
  sha256: string;
};

export type SkillsPayload = {
  skills: SkillInfo[];
};

export type ProbeModelPayload = {
  role: string;
  provider: string;
  model: string;
  cache_hit: boolean;
  model_call_id: number;
  content: string;
  usage: Record<string, unknown>;
};

export type SelectionRange = {
  fromUtf16: number;
  toUtf16: number;
  fromCodePoint: number;
  toCodePoint: number;
  text: string;
};

export type ContextMenuState = {
  x: number;
  y: number;
  selection: SelectionRange | null;
} | null;

export type SelectedAnnotationMap = Record<number, boolean>;

export type TaskEntry = {
  id: number;
  label: string;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  detail: string;
};
