PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  access_subject TEXT UNIQUE,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  checksum_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted', 'orphaned')),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS media_active_checksum
  ON media(checksum_sha256) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('homepage', 'insight', 'settings')),
  slug TEXT NOT NULL,
  shared_data_json TEXT NOT NULL CHECK (json_valid(shared_data_json)),
  shared_version INTEGER NOT NULL DEFAULT 1 CHECK (shared_version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (type, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS content_items_singleton
  ON content_items(type) WHERE type IN ('homepage', 'settings');

CREATE TABLE IF NOT EXISTS content_locales (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('vi', 'en', 'ja')),
  draft_data_json TEXT NOT NULL CHECK (json_valid(draft_data_json)),
  draft_version INTEGER NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  draft_source_revision_id TEXT,
  published_revision_id TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (content_item_id, locale)
);

CREATE TABLE IF NOT EXISTS content_revisions (
  id TEXT PRIMARY KEY,
  content_locale_id TEXT NOT NULL REFERENCES content_locales(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source_revision_id TEXT REFERENCES content_revisions(id) ON DELETE RESTRICT,
  UNIQUE (content_locale_id, revision_number)
);

CREATE TRIGGER IF NOT EXISTS content_revisions_no_update
BEFORE UPDATE ON content_revisions
BEGIN
  SELECT RAISE(ABORT, 'content revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS content_revisions_no_delete
BEFORE DELETE ON content_revisions
BEGIN
  SELECT RAISE(ABORT, 'content revisions are immutable');
END;

CREATE TABLE IF NOT EXISTS redirects (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL CHECK (locale IN ('vi', 'en', 'ja')),
  old_path TEXT NOT NULL UNIQUE,
  new_path TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (old_path <> new_path)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS audit_events_resource
  ON audit_events(resource_type, resource_id, created_at);

CREATE TABLE IF NOT EXISTS published_routes (
  locale TEXT NOT NULL CHECK (locale IN ('vi', 'en', 'ja')),
  path TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES content_revisions(id) ON DELETE RESTRICT,
  PRIMARY KEY (locale, path),
  UNIQUE (locale, item_id)
);

CREATE TABLE IF NOT EXISTS media_references (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('draft', 'revision')),
  owner_id TEXT NOT NULL,
  PRIMARY KEY (media_id, owner_kind, owner_id)
);
CREATE INDEX IF NOT EXISTS media_references_owner
  ON media_references(owner_kind, owner_id);
