-- Infrastructure-only table for local Worker/D1 verification.
-- Financial entities are introduced in separate, versioned migrations.
CREATE TABLE infrastructure_probe (
  id TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
