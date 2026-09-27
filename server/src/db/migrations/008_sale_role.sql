-- Add the SALE role (order-only staff on handheld devices). SQLite cannot alter a
-- CHECK constraint, so the users table is rebuilt. The migration runner disables
-- foreign-key enforcement while migrations run and verifies integrity afterwards.
CREATE TABLE users_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('ADMIN', 'CASHIER', 'SALE')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO users_new (id, username, password_hash, full_name, role, active, created_at, updated_at)
  SELECT id, username, password_hash, full_name, role, active, created_at, updated_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_role ON users(role);
