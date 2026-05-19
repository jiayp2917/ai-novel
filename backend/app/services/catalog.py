from sqlalchemy.orm import Session

from backend.app.db.models import Chapter, ChapterVersion, SourceFile
from backend.app.repositories import Repository
from backend.app.schemas import ChapterCreate, ChapterVersionCreate, SourceFileCreate


class CatalogService:
    def __init__(self, session: Session) -> None:
        self.source_files = Repository(session, SourceFile)
        self.chapters = Repository(session, Chapter)
        self.chapter_versions = Repository(session, ChapterVersion)

    def create_source_file(self, payload: SourceFileCreate) -> SourceFile:
        return self.source_files.create(payload.model_dump())

    def create_chapter(self, payload: ChapterCreate) -> Chapter:
        return self.chapters.create(payload.model_dump())

    def create_chapter_version(self, payload: ChapterVersionCreate) -> ChapterVersion:
        return self.chapter_versions.create(payload.model_dump())
