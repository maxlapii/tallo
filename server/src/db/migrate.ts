import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './connection.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface Migration {
  id: string;
  sql: string;
}

/** Loads `NNN_name.sql` files from the migrations directory, sorted by id. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ id: f.replace(/\.sql$/, ''), sql: readFileSync(join(dir, f), 'utf8') }));
}

export function appliedMigrations(db: Database): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );
  return db.all<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id').map((r) => r.id);
}

/**
 * Applies every pending migration in order, each inside its own transaction.
 * Returns the ids of migrations that were applied by this call.
 */
export function migrate(db: Database, migrations: Migration[] = loadMigrations()): string[] {
  const applied = new Set(appliedMigrations(db));
  const ran: string[] = [];
  const pending = migrations.filter((m) => !applied.has(m.id));
  if (pending.length === 0) return ran;

  // Table rebuilds (SQLite's documented ALTER procedure) need foreign keys off.
  // Enforcement is restored afterwards and integrity is verified.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const m of pending) {
      db.transaction(() => {
        db.exec(m.sql);
        db.run('INSERT INTO schema_migrations (id) VALUES (?)', [m.id]);
      });
      ran.push(m.id);
    }
    const violations = db.all('PRAGMA foreign_key_check');
    if (violations.length > 0) {
      throw new Error(
        `Foreign key violations after migration: ${JSON.stringify(violations.slice(0, 5))}`,
      );
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return ran;
}
