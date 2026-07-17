PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE INDEX accounts_status_idx ON accounts(is_active, expires_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'admin')),
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  CHECK (
    (subject_type = 'user' AND account_id IS NOT NULL) OR
    (subject_type = 'admin' AND account_id IS NULL)
  )
);

CREATE INDEX sessions_account_idx ON sessions(account_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE favourites (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  media_id INTEGER NOT NULL CHECK (media_id > 0),
  title TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  poster_path TEXT,
  backdrop_path TEXT,
  vote_average REAL NOT NULL DEFAULT 0,
  media_date TEXT,
  media_year TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, media_type, media_id)
);

CREATE INDEX favourites_account_added_idx ON favourites(account_id, added_at DESC);

CREATE TABLE auth_attempts (
  throttle_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX auth_attempts_updated_idx ON auth_attempts(updated_at);

CREATE TABLE admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX admin_audit_created_idx ON admin_audit_log(created_at DESC);
