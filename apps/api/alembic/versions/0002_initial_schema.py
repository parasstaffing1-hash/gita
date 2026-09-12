"""Baseline schema: all canonical, user, search, AI and admin tables.

Generated from the SQLAlchemy metadata and checked in as static DDL, so a
migration never depends on the current shape of the models.

Revision ID: 0002_initial_schema
Revises: 0001_extensions
Create Date: 2026-09-04
"""

from __future__ import annotations

from alembic import op

revision = "0002_initial_schema"
down_revision = "0001_extensions"
branch_labels = None
depends_on = None


TABLES: tuple[str, ...] = (
    """
CREATE TABLE admin_users (
	email VARCHAR(320) NOT NULL,
	display_name VARCHAR(200) NOT NULL,
	password_hash VARCHAR(255),
	role VARCHAR(16) NOT NULL,
	is_active BOOLEAN NOT NULL,
	last_login_at TIMESTAMP WITH TIME ZONE,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_admin_users PRIMARY KEY (id),
	CONSTRAINT ck_admin_users_admin_role_valid CHECK (role IN ('viewer', 'editor', 'reviewer', 'admin')),
	CONSTRAINT uq_admin_users_email UNIQUE (email)
)
    """,
    """
CREATE TABLE commentators (
	slug VARCHAR(80) NOT NULL,
	name VARCHAR(300) NOT NULL,
	name_sanskrit VARCHAR(300),
	tradition VARCHAR(200),
	period VARCHAR(120),
	bio TEXT,
	sort_order INTEGER NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_commentators PRIMARY KEY (id),
	CONSTRAINT uq_commentators_slug UNIQUE (slug)
)
    """,
    """
CREATE TABLE content_licenses (
	code VARCHAR(64) NOT NULL,
	name VARCHAR(200) NOT NULL,
	url VARCHAR(500),
	redistributable BOOLEAN NOT NULL,
	requires_attribution BOOLEAN NOT NULL,
	commercial_use_allowed BOOLEAN NOT NULL,
	notes TEXT,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_content_licenses PRIMARY KEY (id),
	CONSTRAINT uq_content_licenses_code UNIQUE (code)
)
    """,
    """
CREATE TABLE glossary_terms (
	slug VARCHAR(120) NOT NULL,
	term_sanskrit VARCHAR(200) NOT NULL,
	term_transliteration VARCHAR(200) NOT NULL,
	term_english VARCHAR(200),
	search_key VARCHAR(200) NOT NULL,
	simple_definition TEXT NOT NULL,
	detailed_definition TEXT,
	variants TEXT[] DEFAULT '{}' NOT NULL,
	synonyms TEXT[] DEFAULT '{}' NOT NULL,
	related_term_slugs TEXT[] DEFAULT '{}' NOT NULL,
	related_verse_refs VARCHAR(16)[] DEFAULT '{}' NOT NULL,
	source_ids UUID[] DEFAULT '{}' NOT NULL,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_glossary_terms PRIMARY KEY (id),
	CONSTRAINT uq_glossary_terms_slug UNIQUE (slug)
)
    """,
    """
CREATE TABLE languages (
	code VARCHAR(16) NOT NULL,
	name VARCHAR(120) NOT NULL,
	native_name VARCHAR(120) NOT NULL,
	script VARCHAR(32) NOT NULL,
	direction VARCHAR(3) NOT NULL,
	is_ui_language BOOLEAN NOT NULL,
	is_content_language BOOLEAN NOT NULL,
	sort_order INTEGER NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_languages PRIMARY KEY (id),
	CONSTRAINT uq_languages_code UNIQUE (code)
)
    """,
    """
CREATE TABLE reading_plans (
	slug VARCHAR(120) NOT NULL,
	title VARCHAR(200) NOT NULL,
	title_hindi VARCHAR(200),
	subtitle VARCHAR(300),
	description TEXT,
	duration_days INTEGER NOT NULL,
	level VARCHAR(16) NOT NULL,
	cover_image_url VARCHAR(1000),
	tags TEXT[] DEFAULT '{}' NOT NULL,
	sort_order INTEGER NOT NULL,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_reading_plans PRIMARY KEY (id),
	CONSTRAINT ck_reading_plans_plan_level_valid CHECK (level IN ('beginner', 'intermediate', 'advanced')),
	CONSTRAINT ck_reading_plans_plan_duration_positive CHECK (duration_days >= 1),
	CONSTRAINT uq_reading_plans_slug UNIQUE (slug)
)
    """,
    """
CREATE TABLE users (
	email VARCHAR(320),
	email_verified_at TIMESTAMP WITH TIME ZONE,
	password_hash VARCHAR(255),
	auth_provider VARCHAR(32),
	auth_provider_subject VARCHAR(255),
	is_active BOOLEAN NOT NULL,
	last_seen_at TIMESTAMP WITH TIME ZONE,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT pk_users PRIMARY KEY (id),
	CONSTRAINT uq_users_auth_provider_subject UNIQUE (auth_provider, auth_provider_subject),
	CONSTRAINT ck_users_user_needs_an_identity CHECK (email IS NOT NULL OR auth_provider IS NOT NULL),
	CONSTRAINT uq_users_email UNIQUE (email)
)
    """,
    """
CREATE TABLE collections (
	user_id UUID NOT NULL,
	name VARCHAR(120) NOT NULL,
	description TEXT,
	color VARCHAR(9),
	is_system BOOLEAN NOT NULL,
	sort_order INTEGER NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_collections PRIMARY KEY (id),
	CONSTRAINT uq_collections_user_id_name UNIQUE (user_id, name),
	CONSTRAINT fk_collections_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE content_reviews (
	table_name VARCHAR(64) NOT NULL,
	record_id UUID NOT NULL,
	record_ref VARCHAR(64),
	requested_by_id UUID,
	reviewer_id UUID,
	status VARCHAR(24) NOT NULL,
	notes TEXT,
	resolved_at TIMESTAMP WITH TIME ZONE,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_content_reviews PRIMARY KEY (id),
	CONSTRAINT ck_content_reviews_review_status_valid CHECK (status IN ('pending', 'approved', 'changes_requested', 'rejected')),
	CONSTRAINT fk_content_reviews_requested_by_id_admin_users FOREIGN KEY(requested_by_id) REFERENCES admin_users (id) ON DELETE SET NULL,
	CONSTRAINT fk_content_reviews_reviewer_id_admin_users FOREIGN KEY(reviewer_id) REFERENCES admin_users (id) ON DELETE SET NULL
)
    """,
    """
CREATE TABLE content_sources (
	key VARCHAR(64) NOT NULL,
	name VARCHAR(300) NOT NULL,
	source_url VARCHAR(1000),
	author VARCHAR(300),
	publication VARCHAR(300),
	publication_year INTEGER,
	license_id UUID,
	copyright_status VARCHAR(32) NOT NULL,
	date_accessed DATE,
	reviewer VARCHAR(200),
	verification_notes TEXT,
	is_authoritative BOOLEAN NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_content_sources PRIMARY KEY (id),
	CONSTRAINT ck_content_sources_copyright_status_valid CHECK (copyright_status IN ('public_domain','licensed','permission_granted','proprietary','unknown')),
	CONSTRAINT uq_content_sources_key UNIQUE (key),
	CONSTRAINT fk_content_sources_license_id_content_licenses FOREIGN KEY(license_id) REFERENCES content_licenses (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE notifications_preferences (
	user_id UUID NOT NULL,
	morning_verse_enabled BOOLEAN NOT NULL,
	morning_verse_time VARCHAR(5) NOT NULL,
	evening_reflection_enabled BOOLEAN NOT NULL,
	evening_reflection_time VARCHAR(5) NOT NULL,
	reading_plan_reminder_enabled BOOLEAN NOT NULL,
	reading_plan_reminder_time VARCHAR(5) NOT NULL,
	custom_reminder_enabled BOOLEAN NOT NULL,
	custom_reminder_time VARCHAR(5),
	timezone VARCHAR(64) NOT NULL,
	push_tokens TEXT[] DEFAULT '{}' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_notifications_preferences PRIMARY KEY (id),
	CONSTRAINT uq_notifications_preferences_user_id UNIQUE (user_id),
	CONSTRAINT fk_notifications_preferences_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE profiles (
	user_id UUID NOT NULL,
	display_name VARCHAR(120),
	avatar_url VARCHAR(1000),
	ui_language VARCHAR(16) NOT NULL,
	content_languages VARCHAR(16)[] DEFAULT '{"en"}' NOT NULL,
	timezone VARCHAR(64) NOT NULL,
	reader_preferences JSONB DEFAULT '{}' NOT NULL,
	onboarding_completed_at TIMESTAMP WITH TIME ZONE,
	current_streak INTEGER NOT NULL,
	longest_streak INTEGER NOT NULL,
	last_active_date VARCHAR(10),
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_profiles PRIMARY KEY (id),
	CONSTRAINT uq_profiles_user_id UNIQUE (user_id),
	CONSTRAINT fk_profiles_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE reading_plan_days (
	plan_id UUID NOT NULL,
	day_number INTEGER NOT NULL,
	title VARCHAR(200) NOT NULL,
	intro TEXT,
	verse_refs VARCHAR(16)[] DEFAULT '{}' NOT NULL,
	reflection TEXT,
	estimated_minutes INTEGER NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_reading_plan_days PRIMARY KEY (id),
	CONSTRAINT uq_reading_plan_days_plan_id_day_number UNIQUE (plan_id, day_number),
	CONSTRAINT ck_reading_plan_days_day_number_positive CHECK (day_number >= 1),
	CONSTRAINT fk_reading_plan_days_plan_id_reading_plans FOREIGN KEY(plan_id) REFERENCES reading_plans (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE reading_progress (
	user_id UUID NOT NULL,
	chapter_number INTEGER NOT NULL,
	last_verse_number INTEGER NOT NULL,
	verses_read INTEGER NOT NULL,
	completed_at TIMESTAMP WITH TIME ZONE,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_reading_progress PRIMARY KEY (id),
	CONSTRAINT uq_reading_progress_user_id_chapter_number UNIQUE (user_id, chapter_number),
	CONSTRAINT ck_reading_progress_chapter_number_range CHECK (chapter_number BETWEEN 1 AND 18),
	CONSTRAINT fk_reading_progress_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE reading_sessions (
	user_id UUID NOT NULL,
	started_at TIMESTAMP WITH TIME ZONE NOT NULL,
	ended_at TIMESTAMP WITH TIME ZONE,
	verses_read INTEGER NOT NULL,
	duration_seconds INTEGER NOT NULL,
	source VARCHAR(16) NOT NULL,
	local_date VARCHAR(10) NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_reading_sessions PRIMARY KEY (id),
	CONSTRAINT fk_reading_sessions_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE sanskrit_terms (
	slug VARCHAR(120) NOT NULL,
	term_devanagari VARCHAR(200) NOT NULL,
	term_iast VARCHAR(200) NOT NULL,
	search_key VARCHAR(200) NOT NULL,
	root VARCHAR(200),
	part_of_speech VARCHAR(64),
	gloss_english TEXT,
	gloss_hindi TEXT,
	glossary_term_id UUID,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_sanskrit_terms PRIMARY KEY (id),
	CONSTRAINT uq_sanskrit_terms_slug UNIQUE (slug),
	CONSTRAINT fk_sanskrit_terms_glossary_term_id_glossary_terms FOREIGN KEY(glossary_term_id) REFERENCES glossary_terms (id) ON DELETE SET NULL
)
    """,
    """
CREATE TABLE user_plan_progress (
	user_id UUID NOT NULL,
	plan_id UUID NOT NULL,
	started_at TIMESTAMP WITH TIME ZONE NOT NULL,
	completed_days INTEGER[] DEFAULT '{}' NOT NULL,
	current_day INTEGER NOT NULL,
	completed_at TIMESTAMP WITH TIME ZONE,
	reminder_enabled BOOLEAN NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_user_plan_progress PRIMARY KEY (id),
	CONSTRAINT uq_user_plan_progress_user_id_plan_id UNIQUE (user_id, plan_id),
	CONSTRAINT fk_user_plan_progress_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT fk_user_plan_progress_plan_id_reading_plans FOREIGN KEY(plan_id) REFERENCES reading_plans (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE chapters (
	number INTEGER NOT NULL,
	slug VARCHAR(120) NOT NULL,
	name_sanskrit VARCHAR(300),
	name_transliteration VARCHAR(300),
	name_english VARCHAR(300) NOT NULL,
	name_hindi VARCHAR(300),
	verse_count INTEGER NOT NULL,
	summary TEXT,
	summary_hindi TEXT,
	major_teachings TEXT[] DEFAULT '{}' NOT NULL,
	key_concepts TEXT[] DEFAULT '{}' NOT NULL,
	key_verse_refs VARCHAR(16)[] DEFAULT '{}' NOT NULL,
	source_id UUID,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_chapters PRIMARY KEY (id),
	CONSTRAINT ck_chapters_chapter_number_range CHECK (number BETWEEN 1 AND 18),
	CONSTRAINT ck_chapters_verification_status_valid CHECK (verification_status IN ('draft', 'review', 'verified', 'published')),
	CONSTRAINT uq_chapters_number UNIQUE (number),
	CONSTRAINT uq_chapters_slug UNIQUE (slug),
	CONSTRAINT fk_chapters_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE content_change_log (
	table_name VARCHAR(64) NOT NULL,
	record_id UUID NOT NULL,
	record_ref VARCHAR(64),
	action VARCHAR(16) NOT NULL,
	field_name VARCHAR(64),
	previous_value JSONB,
	new_value JSONB,
	editor_id UUID,
	editor_email VARCHAR(320),
	reason TEXT NOT NULL,
	source_id UUID,
	review_status VARCHAR(24) DEFAULT 'pending' NOT NULL,
	reverted_change_id UUID,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_content_change_log PRIMARY KEY (id),
	CONSTRAINT ck_content_change_log_change_action_valid CHECK (action IN ('create', 'update', 'delete', 'publish', 'unpublish', 'rollback')),
	CONSTRAINT ck_content_change_log_change_reason_required CHECK (length(reason) >= 3),
	CONSTRAINT fk_content_change_log_editor_id_admin_users FOREIGN KEY(editor_id) REFERENCES admin_users (id) ON DELETE SET NULL,
	CONSTRAINT fk_content_change_log_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE SET NULL,
	CONSTRAINT fk_content_change_log_reverted_change_id_content_change_log FOREIGN KEY(reverted_change_id) REFERENCES content_change_log (id) ON DELETE SET NULL
)
    """,
    """
CREATE TABLE topics (
	slug VARCHAR(120) NOT NULL,
	name VARCHAR(200) NOT NULL,
	name_hindi VARCHAR(200),
	category VARCHAR(16) NOT NULL,
	icon VARCHAR(60),
	short_description TEXT,
	introduction TEXT,
	introduction_hindi TEXT,
	related_concepts TEXT[] DEFAULT '{}' NOT NULL,
	related_topic_slugs TEXT[] DEFAULT '{}' NOT NULL,
	sort_order INTEGER NOT NULL,
	source_id UUID,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_topics PRIMARY KEY (id),
	CONSTRAINT ck_topics_topic_category_valid CHECK (category IN ('emotion', 'life', 'practice', 'concept')),
	CONSTRAINT uq_topics_slug UNIQUE (slug),
	CONSTRAINT fk_topics_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE verses (
	chapter_id UUID NOT NULL,
	chapter_number INTEGER NOT NULL,
	number INTEGER NOT NULL,
	number_end INTEGER,
	slug VARCHAR(32) NOT NULL,
	ordinal INTEGER NOT NULL,
	speaker VARCHAR(120),
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_verses PRIMARY KEY (id),
	CONSTRAINT uq_verses_chapter_id_number UNIQUE (chapter_id, number),
	CONSTRAINT uq_verses_chapter_number_number UNIQUE (chapter_number, number),
	CONSTRAINT uq_verses_ordinal UNIQUE (ordinal),
	CONSTRAINT ck_verses_verse_number_positive CHECK (number >= 1),
	CONSTRAINT ck_verses_verse_number_end_after_start CHECK (number_end IS NULL OR number_end > number),
	CONSTRAINT fk_verses_chapter_id_chapters FOREIGN KEY(chapter_id) REFERENCES chapters (id) ON DELETE CASCADE,
	CONSTRAINT uq_verses_slug UNIQUE (slug)
)
    """,
    """
CREATE TABLE ai_queries (
	user_id UUID,
	session_id UUID,
	conversation_id UUID,
	question TEXT NOT NULL,
	normalized_question TEXT NOT NULL,
	detected_language VARCHAR(16) NOT NULL,
	mode VARCHAR(32) NOT NULL,
	anchor_verse_id UUID,
	retrieved_document_ids UUID[] DEFAULT '{}' NOT NULL,
	retrieval_debug JSONB DEFAULT '{}' NOT NULL,
	client VARCHAR(16) NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_ai_queries PRIMARY KEY (id),
	CONSTRAINT ck_ai_queries_ask_mode_valid CHECK (mode IN ('default', 'simple', 'deep', 'beginner', 'sources_only', 'compare_interpretations')),
	CONSTRAINT fk_ai_queries_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL,
	CONSTRAINT fk_ai_queries_anchor_verse_id_verses FOREIGN KEY(anchor_verse_id) REFERENCES verses (id) ON DELETE SET NULL
)
    """,
    """
CREATE TABLE audio_tracks (
	kind VARCHAR(16) NOT NULL,
	verse_id UUID,
	chapter_id UUID,
	chapter_number INTEGER,
	verse_number INTEGER,
	language_code VARCHAR(16) NOT NULL,
	reciter VARCHAR(200),
	is_synthetic BOOLEAN NOT NULL,
	object_key VARCHAR(500) NOT NULL,
	mime_type VARCHAR(64) NOT NULL,
	duration_seconds INTEGER,
	size_bytes BIGINT,
	checksum_sha256 VARCHAR(64),
	license_id UUID,
	source_id UUID,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_audio_tracks PRIMARY KEY (id),
	CONSTRAINT ck_audio_tracks_audio_kind_valid CHECK (kind IN ('verse', 'chapter', 'reflection', 'intro')),
	CONSTRAINT ck_audio_tracks_verse_audio_needs_verse CHECK ((kind <> 'verse') OR (verse_id IS NOT NULL)),
	CONSTRAINT ck_audio_tracks_chapter_audio_needs_chapter CHECK ((kind <> 'chapter') OR (chapter_id IS NOT NULL)),
	CONSTRAINT fk_audio_tracks_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE,
	CONSTRAINT fk_audio_tracks_chapter_id_chapters FOREIGN KEY(chapter_id) REFERENCES chapters (id) ON DELETE CASCADE,
	CONSTRAINT uq_audio_tracks_object_key UNIQUE (object_key),
	CONSTRAINT fk_audio_tracks_license_id_content_licenses FOREIGN KEY(license_id) REFERENCES content_licenses (id) ON DELETE RESTRICT,
	CONSTRAINT fk_audio_tracks_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE bookmarks (
	user_id UUID NOT NULL,
	verse_id UUID NOT NULL,
	note TEXT,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_bookmarks PRIMARY KEY (id),
	CONSTRAINT uq_bookmarks_user_id_verse_id UNIQUE (user_id, verse_id),
	CONSTRAINT fk_bookmarks_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT fk_bookmarks_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE collection_items (
	collection_id UUID NOT NULL,
	verse_id UUID NOT NULL,
	position INTEGER NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_collection_items PRIMARY KEY (id),
	CONSTRAINT uq_collection_items_collection_id_verse_id UNIQUE (collection_id, verse_id),
	CONSTRAINT fk_collection_items_collection_id_collections FOREIGN KEY(collection_id) REFERENCES collections (id) ON DELETE CASCADE,
	CONSTRAINT fk_collection_items_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE commentaries (
	verse_id UUID NOT NULL,
	commentator_id UUID,
	language_code VARCHAR(16) NOT NULL,
	text TEXT NOT NULL,
	canonical_hash VARCHAR(64) NOT NULL,
	source_id UUID,
	version INTEGER NOT NULL,
	origin VARCHAR(16) DEFAULT 'canonical' NOT NULL,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	approved_for_ai BOOLEAN NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_commentaries PRIMARY KEY (id),
	CONSTRAINT uq_commentaries_verse_id UNIQUE (verse_id, commentator_id, language_code, version),
	CONSTRAINT ck_commentaries_origin_valid CHECK (origin IN ('canonical', 'curated', 'ai_generated')),
	CONSTRAINT fk_commentaries_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE,
	CONSTRAINT fk_commentaries_commentator_id_commentators FOREIGN KEY(commentator_id) REFERENCES commentators (id) ON DELETE SET NULL,
	CONSTRAINT fk_commentaries_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE highlights (
	user_id UUID NOT NULL,
	verse_id UUID NOT NULL,
	target VARCHAR(24) NOT NULL,
	start_offset INTEGER,
	end_offset INTEGER,
	color VARCHAR(16) NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_highlights PRIMARY KEY (id),
	CONSTRAINT ck_highlights_highlight_color_valid CHECK (color IN ('saffron', 'gold', 'sage', 'sky', 'rose')),
	CONSTRAINT ck_highlights_highlight_target_valid CHECK (target IN ('sanskrit', 'transliteration', 'translation', 'commentary')),
	CONSTRAINT ck_highlights_highlight_range_valid CHECK (start_offset IS NULL OR end_offset IS NULL OR end_offset > start_offset),
	CONSTRAINT fk_highlights_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT fk_highlights_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE memorization_progress (
	user_id UUID NOT NULL,
	verse_id UUID NOT NULL,
	stage VARCHAR(16) NOT NULL,
	repetitions INTEGER NOT NULL,
	last_reviewed_at TIMESTAMP WITH TIME ZONE,
	next_review_at TIMESTAMP WITH TIME ZONE,
	ease_factor FLOAT NOT NULL,
	interval_days INTEGER NOT NULL,
	hide_level INTEGER NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_memorization_progress PRIMARY KEY (id),
	CONSTRAINT uq_memorization_progress_user_id_verse_id UNIQUE (user_id, verse_id),
	CONSTRAINT ck_memorization_progress_memorization_stage_valid CHECK (stage IN ('not_started', 'learning', 'reviewing', 'memorized')),
	CONSTRAINT ck_memorization_progress_hide_level_range CHECK (hide_level BETWEEN 0 AND 100),
	CONSTRAINT fk_memorization_progress_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT fk_memorization_progress_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE notes (
	user_id UUID NOT NULL,
	verse_id UUID,
	body TEXT NOT NULL,
	tags TEXT[] DEFAULT '{}' NOT NULL,
	is_private BOOLEAN NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	deleted_at TIMESTAMP WITH TIME ZONE,
	revision INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT pk_notes PRIMARY KEY (id),
	CONSTRAINT fk_notes_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT fk_notes_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE related_verses (
	from_verse_id UUID NOT NULL,
	to_verse_id UUID NOT NULL,
	relation_type VARCHAR(16) NOT NULL,
	note TEXT,
	weight FLOAT NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_related_verses PRIMARY KEY (id),
	CONSTRAINT uq_related_verses_from_verse_id UNIQUE (from_verse_id, to_verse_id, relation_type),
	CONSTRAINT ck_related_verses_no_self_relation CHECK (from_verse_id <> to_verse_id),
	CONSTRAINT ck_related_verses_relation_type_valid CHECK (relation_type IN ('thematic', 'continuation', 'contrast', 'reference', 'parallel')),
	CONSTRAINT fk_related_verses_from_verse_id_verses FOREIGN KEY(from_verse_id) REFERENCES verses (id) ON DELETE CASCADE,
	CONSTRAINT fk_related_verses_to_verse_id_verses FOREIGN KEY(to_verse_id) REFERENCES verses (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE search_documents (
	kind VARCHAR(16) NOT NULL,
	verse_id UUID,
	entity_id UUID,
	language_code VARCHAR(16) NOT NULL,
	title TEXT,
	body TEXT NOT NULL,
	search_key TEXT NOT NULL,
	tsv TSVECTOR,
	weight FLOAT NOT NULL,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_search_documents PRIMARY KEY (id),
	CONSTRAINT ck_search_documents_search_document_kind_valid CHECK (kind IN ('verse', 'translation', 'commentary', 'glossary', 'topic', 'chapter')),
	CONSTRAINT fk_search_documents_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE translations (
	verse_id UUID NOT NULL,
	language_code VARCHAR(16) NOT NULL,
	text TEXT NOT NULL,
	canonical_hash VARCHAR(64) NOT NULL,
	translator_name VARCHAR(300),
	style VARCHAR(24),
	source_id UUID,
	version INTEGER NOT NULL,
	origin VARCHAR(16) DEFAULT 'canonical' NOT NULL,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_translations PRIMARY KEY (id),
	CONSTRAINT uq_translations_verse_id UNIQUE (verse_id, language_code, source_id, version),
	CONSTRAINT ck_translations_origin_valid CHECK (origin IN ('canonical', 'curated', 'ai_generated')),
	CONSTRAINT fk_translations_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE,
	CONSTRAINT fk_translations_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE transliteration_versions (
	verse_id UUID NOT NULL,
	scheme VARCHAR(16) NOT NULL,
	text TEXT NOT NULL,
	canonical_hash VARCHAR(64) NOT NULL,
	source_id UUID,
	version INTEGER NOT NULL,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_transliteration_versions PRIMARY KEY (id),
	CONSTRAINT uq_transliteration_versions_verse_id UNIQUE (verse_id, scheme, source_id, version),
	CONSTRAINT fk_transliteration_versions_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE,
	CONSTRAINT fk_transliteration_versions_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE verse_text_versions (
	verse_id UUID NOT NULL,
	script VARCHAR(24) NOT NULL,
	text TEXT NOT NULL,
	canonical_hash VARCHAR(64) NOT NULL,
	source_id UUID,
	version INTEGER NOT NULL,
	is_primary BOOLEAN NOT NULL,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_verse_text_versions PRIMARY KEY (id),
	CONSTRAINT uq_verse_text_versions_verse_id UNIQUE (verse_id, script, source_id, version),
	CONSTRAINT fk_verse_text_versions_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE,
	CONSTRAINT fk_verse_text_versions_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE verse_topics (
	verse_id UUID NOT NULL,
	topic_id UUID NOT NULL,
	relevance FLOAT NOT NULL,
	note TEXT,
	curated_by VARCHAR(200),
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_verse_topics PRIMARY KEY (id),
	CONSTRAINT uq_verse_topics_verse_id_topic_id UNIQUE (verse_id, topic_id),
	CONSTRAINT ck_verse_topics_relevance_range CHECK (relevance >= 0 AND relevance <= 1),
	CONSTRAINT fk_verse_topics_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE,
	CONSTRAINT fk_verse_topics_topic_id_topics FOREIGN KEY(topic_id) REFERENCES topics (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE verse_words (
	verse_id UUID NOT NULL,
	position INTEGER NOT NULL,
	word_devanagari VARCHAR(200) NOT NULL,
	word_transliteration VARCHAR(200),
	meaning_english TEXT,
	meaning_hindi TEXT,
	grammar_note TEXT,
	sanskrit_term_id UUID,
	source_id UUID,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_verse_words PRIMARY KEY (id),
	CONSTRAINT uq_verse_words_verse_id_position UNIQUE (verse_id, position),
	CONSTRAINT fk_verse_words_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE CASCADE,
	CONSTRAINT fk_verse_words_sanskrit_term_id_sanskrit_terms FOREIGN KEY(sanskrit_term_id) REFERENCES sanskrit_terms (id) ON DELETE SET NULL,
	CONSTRAINT fk_verse_words_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE RESTRICT
)
    """,
    """
CREATE TABLE ai_answers (
	query_id UUID NOT NULL,
	answer TEXT NOT NULL,
	grounding_status VARCHAR(24) NOT NULL,
	model_provider VARCHAR(64) NOT NULL,
	model_name VARCHAR(200) NOT NULL,
	prompt_tokens INTEGER,
	completion_tokens INTEGER,
	latency_ms INTEGER,
	rejected_citations TEXT[] DEFAULT '{}' NOT NULL,
	follow_up_suggestions TEXT[] DEFAULT '{}' NOT NULL,
	review_status VARCHAR(16) DEFAULT 'unreviewed' NOT NULL,
	reviewer_note TEXT,
	user_feedback INTEGER,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_ai_answers PRIMARY KEY (id),
	CONSTRAINT ck_ai_answers_grounding_status_valid CHECK (grounding_status IN ('grounded', 'partially_grounded', 'insufficient_evidence')),
	CONSTRAINT ck_ai_answers_ai_review_status_valid CHECK (review_status IN ('unreviewed','approved','flagged','rejected')),
	CONSTRAINT ck_ai_answers_user_feedback_valid CHECK (user_feedback IS NULL OR user_feedback IN (-1, 1)),
	CONSTRAINT fk_ai_answers_query_id_ai_queries FOREIGN KEY(query_id) REFERENCES ai_queries (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE audio_downloads (
	user_id UUID,
	device_id UUID NOT NULL,
	audio_track_id UUID NOT NULL,
	status VARCHAR(16) NOT NULL,
	bytes_downloaded BIGINT NOT NULL,
	completed_at TIMESTAMP WITH TIME ZONE,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_audio_downloads PRIMARY KEY (id),
	CONSTRAINT uq_audio_downloads_device_id_audio_track_id UNIQUE (device_id, audio_track_id),
	CONSTRAINT ck_audio_downloads_download_status_valid CHECK (status IN ('pending','downloading','complete','failed')),
	CONSTRAINT fk_audio_downloads_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
	CONSTRAINT fk_audio_downloads_audio_track_id_audio_tracks FOREIGN KEY(audio_track_id) REFERENCES audio_tracks (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE daily_verses (
	scheduled_date DATE NOT NULL,
	verse_id UUID NOT NULL,
	reflection TEXT,
	reflection_hindi TEXT,
	audio_track_id UUID,
	related_verse_id UUID,
	verification_status VARCHAR(16) DEFAULT 'draft' NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_daily_verses PRIMARY KEY (id),
	CONSTRAINT uq_daily_verses_scheduled_date UNIQUE (scheduled_date),
	CONSTRAINT fk_daily_verses_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE RESTRICT,
	CONSTRAINT fk_daily_verses_audio_track_id_audio_tracks FOREIGN KEY(audio_track_id) REFERENCES audio_tracks (id) ON DELETE SET NULL,
	CONSTRAINT fk_daily_verses_related_verse_id_verses FOREIGN KEY(related_verse_id) REFERENCES verses (id) ON DELETE SET NULL
)
    """,
    """
CREATE TABLE embeddings (
	document_id UUID NOT NULL,
	model_name VARCHAR(200) NOT NULL,
	dimensions INTEGER NOT NULL,
	embedding VECTOR(384) NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_embeddings PRIMARY KEY (id),
	CONSTRAINT uq_embeddings_document_id_model_name UNIQUE (document_id, model_name),
	CONSTRAINT fk_embeddings_document_id_search_documents FOREIGN KEY(document_id) REFERENCES search_documents (id) ON DELETE CASCADE
)
    """,
    """
CREATE TABLE ai_answer_sources (
	answer_id UUID NOT NULL,
	verse_id UUID NOT NULL,
	verse_ref VARCHAR(16) NOT NULL,
	quoted_field VARCHAR(24) NOT NULL,
	quoted_text TEXT NOT NULL,
	translation_id UUID,
	commentary_id UUID,
	source_id UUID,
	relevance_score FLOAT NOT NULL,
	position INTEGER NOT NULL,
	validated BOOLEAN NOT NULL,
	id UUID DEFAULT gen_random_uuid() NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_ai_answer_sources PRIMARY KEY (id),
	CONSTRAINT ck_ai_answer_sources_quoted_field_valid CHECK (quoted_field IN ('sanskrit','transliteration','translation','commentary')),
	CONSTRAINT fk_ai_answer_sources_answer_id_ai_answers FOREIGN KEY(answer_id) REFERENCES ai_answers (id) ON DELETE CASCADE,
	CONSTRAINT fk_ai_answer_sources_verse_id_verses FOREIGN KEY(verse_id) REFERENCES verses (id) ON DELETE RESTRICT,
	CONSTRAINT fk_ai_answer_sources_translation_id_translations FOREIGN KEY(translation_id) REFERENCES translations (id) ON DELETE SET NULL,
	CONSTRAINT fk_ai_answer_sources_commentary_id_commentaries FOREIGN KEY(commentary_id) REFERENCES commentaries (id) ON DELETE SET NULL,
	CONSTRAINT fk_ai_answer_sources_source_id_content_sources FOREIGN KEY(source_id) REFERENCES content_sources (id) ON DELETE SET NULL
)
    """,
)

INDEXES: tuple[str, ...] = (
    "CREATE INDEX ix_glossary_terms_search_key ON glossary_terms (search_key)",
    "CREATE INDEX ix_collections_user_updated ON collections (user_id, updated_at)",
    "CREATE INDEX ix_content_reviews_record ON content_reviews (table_name, record_id)",
    "CREATE INDEX ix_content_reviews_status ON content_reviews (status, created_at)",
    "CREATE INDEX ix_reading_sessions_user_date ON reading_sessions (user_id, local_date)",
    "CREATE INDEX ix_sanskrit_terms_search_key ON sanskrit_terms (search_key)",
    "CREATE INDEX ix_content_change_log_created ON content_change_log (created_at)",
    "CREATE INDEX ix_content_change_log_record ON content_change_log (table_name, record_id, created_at)",
    "CREATE INDEX ix_topics_category ON topics (category)",
    "CREATE INDEX ix_verses_chapter_number_number ON verses (chapter_number, number)",
    "CREATE INDEX ix_ai_queries_conversation ON ai_queries (conversation_id)",
    "CREATE INDEX ix_ai_queries_created ON ai_queries (created_at)",
    "CREATE INDEX ix_audio_tracks_chapter_verse ON audio_tracks (chapter_number, verse_number)",
    "CREATE INDEX ix_audio_tracks_kind_language ON audio_tracks (kind, language_code)",
    "CREATE INDEX ix_bookmarks_user_updated ON bookmarks (user_id, updated_at)",
    "CREATE INDEX ix_commentaries_verse ON commentaries (verse_id)",
    "CREATE INDEX ix_highlights_user_updated ON highlights (user_id, updated_at)",
    "CREATE INDEX ix_highlights_verse ON highlights (verse_id)",
    "CREATE INDEX ix_memorization_next_review ON memorization_progress (user_id, next_review_at)",
    "CREATE INDEX ix_notes_user_updated ON notes (user_id, updated_at)",
    "CREATE INDEX ix_notes_verse ON notes (verse_id)",
    "CREATE INDEX ix_related_verses_from ON related_verses (from_verse_id)",
    "CREATE INDEX ix_search_documents_kind_language ON search_documents (kind, language_code)",
    "CREATE INDEX ix_search_documents_search_key_trgm ON search_documents USING gin (search_key gin_trgm_ops)",
    "CREATE INDEX ix_search_documents_tsv ON search_documents USING gin (tsv)",
    "CREATE INDEX ix_search_documents_verse ON search_documents (verse_id)",
    "CREATE UNIQUE INDEX uq_search_documents_identity ON search_documents (kind, verse_id, entity_id, language_code) NULLS NOT DISTINCT",
    "CREATE INDEX ix_translations_verse_language ON translations (verse_id, language_code)",
    "CREATE INDEX ix_verse_text_versions_hash ON verse_text_versions (canonical_hash)",
    "CREATE INDEX ix_verse_topics_topic_relevance ON verse_topics (topic_id, relevance)",
    "CREATE INDEX ix_ai_answers_review ON ai_answers (review_status, created_at)",
    "CREATE INDEX ix_audio_downloads_user ON audio_downloads (user_id)",
    "CREATE INDEX ix_daily_verses_date ON daily_verses (scheduled_date)",
    "CREATE INDEX ix_embeddings_model ON embeddings (model_name)",
    "CREATE INDEX ix_ai_answer_sources_answer ON ai_answer_sources (answer_id, position)",
    "CREATE INDEX ix_ai_answer_sources_verse ON ai_answer_sources (verse_id)",
)

DROP_ORDER: tuple[str, ...] = (
    "ai_answer_sources",
    "embeddings",
    "daily_verses",
    "audio_downloads",
    "ai_answers",
    "verse_words",
    "verse_topics",
    "verse_text_versions",
    "transliteration_versions",
    "translations",
    "search_documents",
    "related_verses",
    "notes",
    "memorization_progress",
    "highlights",
    "commentaries",
    "collection_items",
    "bookmarks",
    "audio_tracks",
    "ai_queries",
    "verses",
    "topics",
    "content_change_log",
    "chapters",
    "user_plan_progress",
    "sanskrit_terms",
    "reading_sessions",
    "reading_progress",
    "reading_plan_days",
    "profiles",
    "notifications_preferences",
    "content_sources",
    "content_reviews",
    "collections",
    "users",
    "reading_plans",
    "languages",
    "glossary_terms",
    "content_licenses",
    "commentators",
    "admin_users",
)


def upgrade() -> None:
    for statement in TABLES:
        op.execute(statement)
    for statement in INDEXES:
        op.execute(statement)

    # Keep the full-text vector in step with the row automatically. Doing it in
    # a trigger rather than in application code means an admin edit made
    # through any path still updates the index.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION gita_search_documents_tsv_update()
        RETURNS trigger AS $$
        BEGIN
            NEW.tsv :=
                setweight(to_tsvector('gita_simple', coalesce(NEW.title, '')), 'A') ||
                setweight(to_tsvector('gita_simple', coalesce(NEW.body, '')), 'B') ||
                setweight(to_tsvector('gita_simple', coalesce(NEW.search_key, '')), 'C');
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_search_documents_tsv
        BEFORE INSERT OR UPDATE OF title, body, search_key
        ON search_documents
        FOR EACH ROW EXECUTE FUNCTION gita_search_documents_tsv_update();
        """
    )

    # HNSW gives good recall at low memory for a corpus this size (~thousands
    # of documents). Cosine distance matches the normalised sentence-transformer
    # vectors the embeddings service produces.
    op.execute(
        """
        CREATE INDEX ix_embeddings_vector_hnsw
        ON embeddings USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_embeddings_vector_hnsw")
    op.execute("DROP TRIGGER IF EXISTS trg_search_documents_tsv ON search_documents")
    op.execute("DROP FUNCTION IF EXISTS gita_search_documents_tsv_update()")
    for table in DROP_ORDER:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
