-- Sync store: one row per user (identified only by the hash of their pairing
-- token) and one row per card. `version` is a per-user monotonic counter used
-- as the delta-sync cursor; `txn` guards optimistic-concurrency batches.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  txn TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  created_ip TEXT
);

CREATE TABLE IF NOT EXISTS cards (
  user_id INTEGER NOT NULL,
  card_key TEXT NOT NULL,
  doc TEXT NOT NULL,          -- full card JSON, including tombstones
  version INTEGER NOT NULL,   -- users.version at last write (delta cursor)
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, card_key)
);

CREATE INDEX IF NOT EXISTS cards_user_version ON cards(user_id, version);
CREATE INDEX IF NOT EXISTS cards_deleted ON cards(deleted, deleted_at);

-- One cached AI news digest per user (see /api/news in src/index.js).
-- Rewritten in place on every fresh model call: this is the anti-spam cache,
-- not an archive — the client keeps every article it was given, in its own
-- storage, and the row here only answers a repeat of the same request.
-- (Supersedes the earlier `recommendations` table; drop it if a prior version
-- created it.)
DROP TABLE IF EXISTS recommendations;
CREATE TABLE IF NOT EXISTS news (
  user_id INTEGER PRIMARY KEY,
  doc TEXT NOT NULL,          -- digest JSON: { level, topics, title, article, glossary, sources, … }
  profile_hash TEXT,          -- sha-256 of the profile that produced it
  created_at INTEGER NOT NULL
);

-- Per-user hourly cap on the model-backed endpoints (/api/ask, /api/translate),
-- one row per call, pruned by the daily cron. `kind` keeps each endpoint's
-- budget separate. The Worker creates this itself on first use, so a
-- deployment made before these endpoints existed keeps working without
-- re-running this file.
DROP TABLE IF EXISTS ask_log;
CREATE TABLE IF NOT EXISTS usage_log (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_log_user ON usage_log(user_id, kind, created_at);
