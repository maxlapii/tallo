import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/connection.js';
import { appliedMigrations, loadMigrations, migrate } from '../../src/db/migrate.js';
import { seed, SEED_USERS } from '../../src/db/seed.js';
import { verifyPassword } from '../../src/services/passwordService.js';

describe('database initialisation', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('creates the database file and schema from scratch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-db-'));
    dirs.push(dir);
    const db = new Database(join(dir, 'nested', 'pos.db'));
    const ran = migrate(db);
    expect(ran.length).toBeGreaterThan(0);
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['schema_migrations', 'users', 'audit_logs']));
    expect(db.get<{ v: number }>('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    db.close();

    // Re-opening the same file finds the schema already applied.
    const db2 = new Database(join(dir, 'nested', 'pos.db'));
    expect(migrate(db2)).toEqual([]);
    expect(appliedMigrations(db2)).toEqual(ran);
    db2.close();
  });
});

describe('migrations', () => {
  it('loads migration files in order', () => {
    const migrations = loadMigrations();
    const ids = migrations.map((m) => m.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids[0]).toBe('001_users');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('applies all pending migrations once and is idempotent', () => {
    const db = new Database(':memory:');
    const first = migrate(db);
    expect(first).toEqual(loadMigrations().map((m) => m.id));
    expect(migrate(db)).toEqual([]);
    expect(appliedMigrations(db)).toEqual(first);
    db.close();
  });

  it('applies only migrations that have not been recorded yet', () => {
    const db = new Database(':memory:');
    migrate(db, [{ id: '900_a', sql: 'CREATE TABLE a (id INTEGER)' }]);
    const ran = migrate(db, [
      { id: '900_a', sql: 'CREATE TABLE a (id INTEGER)' },
      { id: '901_b', sql: 'CREATE TABLE b (id INTEGER)' },
    ]);
    expect(ran).toEqual(['901_b']);
    db.close();
  });

  it('rolls back a failing migration without recording it', () => {
    const db = new Database(':memory:');
    expect(() =>
      migrate(db, [
        { id: '900_bad', sql: 'CREATE TABLE ok (id INTEGER); CREATE TABLE ok (id INTEGER);' },
      ]),
    ).toThrow();
    expect(appliedMigrations(db)).not.toContain('900_bad');
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'ok'");
    expect(tables).toHaveLength(0);
    db.close();
  });
});

describe('seed', () => {
  it('creates the deterministic users with hashed passwords', () => {
    const db = new Database(':memory:');
    migrate(db);
    seed(db);
    const users = db.all<{ username: string; role: string; password_hash: string; active: number }>(
      'SELECT username, role, password_hash, active FROM users ORDER BY id',
    );
    expect(users.map((u) => [u.username, u.role])).toEqual(
      SEED_USERS.map((u) => [u.username, u.role]),
    );
    for (const u of users) {
      expect(u.active).toBe(1);
      expect(u.password_hash).not.toBe('test-password');
      expect(verifyPassword('test-password', u.password_hash)).toBe(true);
    }
    db.close();
  });

  it('is idempotent and restores seed users that were modified', () => {
    const db = new Database(':memory:');
    migrate(db);
    seed(db);
    db.run("UPDATE users SET active = 0, full_name = 'changed' WHERE username = 'cashier'");
    seed(db);
    expect(db.all('SELECT id FROM users')).toHaveLength(SEED_USERS.length);
    const cashier = db.get<{ active: number; full_name: string }>(
      "SELECT active, full_name FROM users WHERE username = 'cashier'",
    );
    expect(cashier).toEqual({ active: 1, full_name: 'Front Cashier' });
    db.close();
  });
});

describe('SALE role migration', () => {
  it('accepts the SALE role and keeps existing users and foreign keys intact', () => {
    const db = new Database(':memory:');
    migrate(db);
    seed(db);
    const roles = db
      .all<{ role: string }>('SELECT DISTINCT role FROM users ORDER BY role')
      .map((r) => r.role);
    expect(roles).toEqual(['ADMIN', 'CASHIER', 'SALE']);
    expect(() =>
      db.run(
        "INSERT INTO users (username, password_hash, full_name, role) VALUES ('x', 'h', 'X', 'OWNER')",
      ),
    ).toThrow(/CHECK/);
    expect(db.get<{ v: number }>('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
    db.close();
  });
});
