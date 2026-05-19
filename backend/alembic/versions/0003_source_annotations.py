"""allow source file annotations

Revision ID: 0003_source_annotations
Revises: 0002_review_binding
Create Date: 2026-05-18
"""
from alembic import op


revision = "0003_source_annotations"
down_revision = "0002_review_binding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("annotations") as batch:
        batch.alter_column("chapter_id", nullable=True)
        batch.alter_column("chapter_version_id", nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("annotations") as batch:
        batch.alter_column("chapter_id", nullable=False)
        batch.alter_column("chapter_version_id", nullable=False)
