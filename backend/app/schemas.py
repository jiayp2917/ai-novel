from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SourceFileCreate(BaseModel):
    path: str
    kind: str
    sha256: str
    mtime: float
    size: int
    active: bool = True


class SourceFileRead(SourceFileCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class SourceFileContentRead(SourceFileRead):
    text: str
    offset_unit: str = "python_code_point"


class ChapterCreate(BaseModel):
    chapter_no: int
    title: str
    source_file_id: int
    current_version_id: int | None = None
    range_start: int
    range_end: int
    active: bool = True


class ChapterRead(ChapterCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class ChapterContentRead(ChapterRead):
    text: str
    offset_unit: str = "python_code_point"


class ChapterVersionCreate(BaseModel):
    chapter_id: int
    source_file_id: int
    body_hash: str
    source_file_hash: str
    title: str
    text_snapshot_path: str | None = None
    range_start: int
    range_end: int


class ChapterVersionRead(ChapterVersionCreate):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AnnotationCreate(BaseModel):
    chapter_id: int | None
    chapter_version_id: int | None
    source_file_id: int
    source_file_hash_at_create: str
    chapter_body_hash_at_create: str
    range_start: int
    range_end: int
    quote_text: str
    quote_hash: str
    prefix_text: str = ""
    suffix_text: str = ""
    type: str
    severity: str
    comment: str
    example_rewrite: str | None = None
    status: str = "open"


class AnnotationRequest(BaseModel):
    range_start: int
    range_end: int
    type: str
    severity: str
    comment: str
    example_rewrite: str | None = None


class AnnotationUpdate(BaseModel):
    type: str | None = None
    severity: str | None = None
    comment: str | None = None
    example_rewrite: str | None = None
    status: str | None = None
    range_start: int | None = None
    range_end: int | None = None


class AnnotationRead(AnnotationCreate):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AnnotationInsightCreate(BaseModel):
    kind: str
    content: str
    source_annotation_ids_json: str = "[]"
    enabled: bool = True
    confidence: float = 1.0


class AnnotationInsightUpdate(BaseModel):
    kind: str | None = None
    content: str | None = None
    enabled: bool | None = None
    confidence: float | None = None


class MemoryItemCreate(BaseModel):
    kind: str
    scope: str
    content_json: str
    source_hash: str
    stale: bool = False


class JobCreate(BaseModel):
    type: str
    status: str = "queued"
    payload_json: str = "{}"
    result_json: str | None = None
    error: str | None = None
    locked_chapter_id: int | None = None
    locked_source_file_id: int | None = None


class ArtifactCreate(BaseModel):
    kind: str
    path: str
    sha256: str
    base_source_file_id: int | None = None
    base_source_file_hash: str | None = None
    base_chapter_id: int | None = None
    base_chapter_version_id: int | None = None
    metadata_json: str = "{}"


class ReviewCreate(BaseModel):
    artifact_id: int
    passed: bool
    issues_json: str = "[]"
    evidence_count: int = 0
    manual_required: bool = False
    candidate_hash: str | None = None
    base_source_file_hash: str | None = None
    base_chapter_version_id: int | None = None


class PublishDecisionCreate(BaseModel):
    artifact_id: int
    approved_by_user: bool
    force: bool = False
    force_reason: str | None = None
    source_hash_before: str
    candidate_hash: str
    diff_path: str
    backup_path: str
    published_at: datetime | None = None


class ModelCallCreate(BaseModel):
    role: str
    provider: str
    model: str
    prompt_hash: str
    input_chars: int
    output_chars: int
    usage_json: str = "{}"
    cost_estimate: float | None = None
    cache_hit: bool = False
    status: str
    error: str | None = None


class EventCreate(BaseModel):
    event_type: str
    entity_type: str
    entity_id: int
    payload_json: str = "{}"


class MemoryItemRead(MemoryItemCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class AnnotationInsightRead(AnnotationInsightCreate):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContextPreview(BaseModel):
    chapter_id: int
    core_facts: list[dict]
    chapter_card: dict | None
    structured_state: dict | None
    annotation_insights: list[dict]
