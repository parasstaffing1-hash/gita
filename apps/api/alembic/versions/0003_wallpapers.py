"""Wallpaper library for the quote maker.

Revision ID: 0003_wallpapers
Revises: 0002_initial_schema
Create Date: 2026-09-05
"""

from __future__ import annotations

from alembic import op

revision = "0003_wallpapers"
down_revision = "0002_initial_schema"
branch_labels = None
depends_on = None


TABLE = """
CREATE TABLE wallpapers (
	slug VARCHAR(32) NOT NULL,
	title VARCHAR(200),
	object_key VARCHAR(500) NOT NULL,
	preview_key VARCHAR(500),
	thumb_key VARCHAR(500),
	width INTEGER NOT NULL,
	height INTEGER NOT NULL,
	size_bytes BIGINT,
	mime_type VARCHAR(64) NOT NULL,
	checksum_sha256 VARCHAR(64),
	orientation VARCHAR(16) NOT NULL,
	luminance FLOAT,
	text_zone VARCHAR(8) NOT NULL,
	dominant_color VARCHAR(9),
	moods VARCHAR(24)[] DEFAULT '{}' NOT NULL,
	license_id UUID,
	attribution VARCHAR(300),
	source_url VARCHAR(1000),
	photographer VARCHAR(200),
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	is_active BOOLEAN NOT NULL,
	sort_order INTEGER NOT NULL,
	use_count INTEGER DEFAULT '0' NOT NULL,
	notes TEXT,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_wallpapers PRIMARY KEY (id),
	CONSTRAINT ck_wallpapers_text_zone_valid CHECK (text_zone IN ('top', 'middle', 'bottom', 'any')),
	CONSTRAINT ck_wallpapers_orientation_valid CHECK (orientation IN ('portrait', 'landscape', 'square')),
	CONSTRAINT ck_wallpapers_dimensions_positive CHECK (width > 0 AND height > 0),
	CONSTRAINT ck_wallpapers_luminance_range CHECK (luminance IS NULL OR (luminance >= 0 AND luminance <= 1)),
	CONSTRAINT ck_wallpapers_published_wallpaper_needs_licence CHECK (verification_status = 'draft' OR license_id IS NOT NULL),
	CONSTRAINT uq_wallpapers_slug UNIQUE (slug),
	CONSTRAINT uq_wallpapers_object_key UNIQUE (object_key),
	CONSTRAINT fk_wallpapers_license_id_content_licenses FOREIGN KEY(license_id) REFERENCES content_licenses (id) ON DELETE RESTRICT
)
"""

INDEXES: tuple[str, ...] = (
    "CREATE INDEX ix_wallpapers_browse ON wallpapers (is_active, verification_status, orientation)",
    "CREATE INDEX ix_wallpapers_moods ON wallpapers USING gin (moods)",
    "CREATE INDEX ix_wallpapers_popularity ON wallpapers (use_count)",
)


def upgrade() -> None:
    op.execute(TABLE)
    for statement in INDEXES:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS wallpapers CASCADE")
