import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Row = Record<string, SQLInputValue>;

/**
 * Thin wrapper over the built-in synchronous SQLite driver.
 *
 * - All statements are parameterised (SQL injection safe).
 * - `transaction()` guarantees atomic commit/rollback and supports nesting via
 *   savepoints, which financial operations (checkout, refund) rely on.
 */
export class Database {
  private readonly db: DatabaseSync;
  private depth = 0;

  constructor(readonly path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    if (path !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA busy_timeout = 5000');
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: SQLInputValue[] = []): { changes: number; lastInsertRowid: number } {
    const result = this.db.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  get<T extends object = Row>(sql: string, params: SQLInputValue[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T extends object = Row>(sql: string, params: SQLInputValue[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /**
   * Runs `fn` inside a transaction. If `fn` throws, everything done inside it
   * (including nested transactions) is rolled back and the error re-thrown.
   */
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}`;
    if (this.depth === 0) {
      this.db.exec('BEGIN IMMEDIATE');
    } else {
      this.db.exec(`SAVEPOINT ${savepoint}`);
    }
    this.depth += 1;
    try {
      const result = fn();
      this.depth -= 1;
      if (this.depth === 0) {
        this.db.exec('COMMIT');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      return result;
    } catch (err) {
      this.depth -= 1;
      if (this.depth === 0) {
        this.db.exec('ROLLBACK');
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw err;
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  close(): void {
    this.db.close();
  }
}
