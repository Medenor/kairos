PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read','write','admin')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS shared_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('quota_state','routing_config','snapshot')),
  logical_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(workspace_id, record_type, logical_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS record_revisions (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  previous_version INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  change_source TEXT NOT NULL CHECK (change_source IN ('api_write','migration','restore')),
  change_summary TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES shared_records(id)
);

CREATE TABLE IF NOT EXISTS migration_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','partial')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_records INTEGER NOT NULL,
  migrated_records INTEGER NOT NULL,
  skipped_records INTEGER NOT NULL,
  failed_records INTEGER NOT NULL,
  error_report TEXT
);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created','failed','restored')),
  storage_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  restored_at TEXT
);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('login_success','login_failure','access_denied','token_revoked','config_change')),
  user_id TEXT,
  workspace_id TEXT,
  source_ip TEXT,
  metadata TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  key_value TEXT NOT NULL,
  response_body TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, endpoint, key_value)
);

CREATE TABLE IF NOT EXISTS migration_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);
