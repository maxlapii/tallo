import { AsyncLocalStorage } from 'node:async_hooks';
import type { SQLInputValue } from 'node:sqlite';
import { Database, type Row } from '../db/connection.js';

export interface TenantContext {
  /** Store code (slug); `'default'` in single-tenant mode. */
  slug: string;
  db: Database;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Binds the rest of the current request (sync + async continuations) to a store. */
export function enterTenant(ctx: TenantContext): void {
  storage.enterWith(ctx);
}

export function runInTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * A `Database` that delegates every call to the store bound to the current
 * request. Services and routes are written once against `Database`; in
 * multi-store mode they receive this proxy and never see another store's data
 * because the underlying connection is chosen from the caller's own token.
 */
export class ContextDatabase extends Database {
  constructor() {
    super(':memory:');
  }

  private target(): Database {
    const ctx = storage.getStore();
    if (!ctx) throw new Error('No store bound to this request');
    return ctx.db;
  }

  override exec(sql: string): void {
    this.target().exec(sql);
  }

  override run(
    sql: string,
    params: SQLInputValue[] = [],
  ): { changes: number; lastInsertRowid: number } {
    return this.target().run(sql, params);
  }

  override get<T extends object = Row>(sql: string, params: SQLInputValue[] = []): T | undefined {
    return this.target().get<T>(sql, params);
  }

  override all<T extends object = Row>(sql: string, params: SQLInputValue[] = []): T[] {
    return this.target().all<T>(sql, params);
  }

  override transaction<T>(fn: () => T): T {
    return this.target().transaction(fn);
  }

  override get inTransaction(): boolean {
    return this.target().inTransaction;
  }

  override close(): void {
    // Store connections are owned by the registry.
  }
}
