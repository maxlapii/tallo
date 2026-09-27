import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/connection.js';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  });

  afterEach(() => db.close());

  it('runs parameterised statements and reports changes', () => {
    const r = db.run('INSERT INTO t (v) VALUES (?)', ['a']);
    expect(r.changes).toBe(1);
    expect(r.lastInsertRowid).toBe(1);
    expect(db.get<{ v: string }>('SELECT v FROM t WHERE id = ?', [1])?.v).toBe('a');
    expect(db.all('SELECT * FROM t')).toHaveLength(1);
  });

  it('does not interpolate parameters (SQL injection safe)', () => {
    db.run('INSERT INTO t (v) VALUES (?)', ["x'); DROP TABLE t; --"]);
    expect(db.all('SELECT * FROM t')).toHaveLength(1);
  });

  it('commits a successful transaction', () => {
    const result = db.transaction(() => {
      db.run('INSERT INTO t (v) VALUES (?)', ['a']);
      db.run('INSERT INTO t (v) VALUES (?)', ['b']);
      return 42;
    });
    expect(result).toBe(42);
    expect(db.all('SELECT * FROM t')).toHaveLength(2);
    expect(db.inTransaction).toBe(false);
  });

  it('rolls back everything when the callback throws', () => {
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t (v) VALUES (?)', ['a']);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all('SELECT * FROM t')).toHaveLength(0);
    expect(db.inTransaction).toBe(false);
  });

  it('rolls back when a constraint fails mid-transaction', () => {
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t (v) VALUES (?)', ['a']);
        db.run('INSERT INTO t (v) VALUES (?)', [null]); // NOT NULL violation
      }),
    ).toThrow();
    expect(db.all('SELECT * FROM t')).toHaveLength(0);
  });

  it('supports nested transactions via savepoints', () => {
    db.transaction(() => {
      db.run('INSERT INTO t (v) VALUES (?)', ['outer']);
      expect(() =>
        db.transaction(() => {
          db.run('INSERT INTO t (v) VALUES (?)', ['inner']);
          throw new Error('inner failed');
        }),
      ).toThrow('inner failed');
      expect(db.inTransaction).toBe(true);
    });
    const rows = db.all<{ v: string }>('SELECT v FROM t');
    expect(rows.map((r) => r.v)).toEqual(['outer']);
  });

  it('rolls back the outer transaction including committed inner savepoints', () => {
    expect(() =>
      db.transaction(() => {
        db.transaction(() => db.run('INSERT INTO t (v) VALUES (?)', ['inner']));
        throw new Error('outer failed');
      }),
    ).toThrow('outer failed');
    expect(db.all('SELECT * FROM t')).toHaveLength(0);
  });

  it('enforces foreign keys', () => {
    db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, t_id INTEGER NOT NULL REFERENCES t(id))');
    expect(() => db.run('INSERT INTO child (t_id) VALUES (?)', [999])).toThrow(/FOREIGN KEY/);
  });
});
