"""add review binding fields

Revision ID: 0002_review_binding
Revises: 0001_initial_schema
Create Date: 2026-05-18
"""
from alembic import op
import sqlalchemy as sa


revision = "0002_review_binding"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("reviews") as batch_op:
        batch_op.add_column(sa.Column("candidate_hash", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("base_source_file_hash", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("base_chapter_version_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_reviews_base_chapter_version_id_chapter_versions",
            "chapter_versions",
            ["base_chapter_version_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("reviews") as batch_op:
        batch_op.drop_constraint("fk_reviews_base_chapter_version_id_chapter_versions", type_="foreignkey")
        batch_op.drop_column("base_chapter_version_id")
        batch_op.drop_column("base_source_file_hash")
        batch_op.drop_column("candidate_hash")
