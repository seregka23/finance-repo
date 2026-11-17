CREATE TABLE auth_users (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  password_algorithm TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE auth_sessions (
  token_hash TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_user_id ON auth_sessions(user_id);
CREATE TABLE auth_throttles (
  key TEXT NOT NULL PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);
