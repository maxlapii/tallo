import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { seedDemoCatalog, seedUser } from '../db/seed.js';
import {
  AppError,
  ConflictError,
  ErrorCodes,
  InvalidRequestError,
  NotFoundError,
} from '../utils/errors.js';

export const STORE_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
const RESERVED = new Set([
  'default',
  'api',
  'admin',
  'www',
  'app',
  'login',
  'signup',
  'system',
  'directory',
]);

export interface StoreRecord {
  slug: string;
  name: string;
  createdAt: string;
  active: boolean;
}

export interface CreateStoreInput {
  slug: string;
  name: string;
  admin: { username: string; password: string; fullName: string };
  demoData?: boolean;
}

/**
 * One SQLite file per store. The directory database knows only store codes
 * and display names; every user, product, sale, and customer lives inside the
 * store's own file, so stores can be exported or erased as a unit and one
 * store can never query another's rows.
 */
export class StoreRegistry {
  private readonly directory: Database;
  private readonly open = new Map<string, Database>();
  readonly storesDir: string;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.storesDir = join(dataDir, 'stores');
    mkdirSync(this.storesDir, { recursive: true });
    this.directory = new Database(join(dataDir, 'directory.db'));
    this.directory.exec(
      `CREATE TABLE IF NOT EXISTS stores (
         slug       TEXT PRIMARY KEY,
         name       TEXT NOT NULL,
         active     INTEGER NOT NULL DEFAULT 1,
         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       )`,
    );
  }

  static validateSlug(slug: string): string {
    const s = slug.trim().toLowerCase();
    if (!STORE_CODE_PATTERN.test(s)) {
      throw new InvalidRequestError(
        'Store code must be 3-32 characters: lowercase letters, numbers, and hyphens',
      );
    }
    if (RESERVED.has(s)) throw new InvalidRequestError('That store code is reserved');
    return s;
  }

  filePath(slug: string): string {
    return join(this.storesDir, `${slug}.db`);
  }

  list(): StoreRecord[] {
    return this.directory
      .all<{ slug: string; name: string; active: number; created_at: string }>(
        'SELECT * FROM stores ORDER BY created_at',
      )
      .map((r) => ({
        slug: r.slug,
        name: r.name,
        active: r.active === 1,
        createdAt: r.created_at,
      }));
  }

  find(slug: string): StoreRecord | null {
    const r = this.directory.get<{
      slug: string;
      name: string;
      active: number;
      created_at: string;
    }>('SELECT * FROM stores WHERE slug = ?', [slug]);
    return r
      ? { slug: r.slug, name: r.name, active: r.active === 1, createdAt: r.created_at }
      : null;
  }

  exists(slug: string): boolean {
    return this.find(slug) !== null;
  }

  /** Opens (and lazily migrates) a store database. Connections are cached. */
  openStore(slug: string): Database {
    const cached = this.open.get(slug);
    if (cached) return cached;
    const record = this.find(slug);
    if (!record || !record.active) throw new StoreNotFoundError();
    const db = new Database(this.filePath(slug));
    migrate(db);
    this.open.set(slug, db);
    return db;
  }

  /** Provisions a new private store with its first admin account. */
  createStore(input: CreateStoreInput): StoreRecord {
    const slug = StoreRegistry.validateSlug(input.slug);
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80)
      throw new InvalidRequestError('Store name must be 2-80 characters');
    if (this.exists(slug) || existsSync(this.filePath(slug))) {
      throw new ConflictError(ErrorCodes.INVALID_REQUEST, 'That store code is already taken');
    }
    const db = new Database(this.filePath(slug));
    try {
      chmodSync(this.filePath(slug), 0o600);
    } catch {
      // permissions are best-effort (e.g. Windows)
    }
    try {
      migrate(db);
      db.transaction(() => {
        seedUser(db, { ...input.admin, role: 'ADMIN' });
        if (input.demoData) seedDemoCatalog(db);
      });
    } catch (err) {
      db.close();
      rmSync(this.filePath(slug), { force: true });
      throw err;
    }
    this.directory.run('INSERT INTO stores (slug, name) VALUES (?, ?)', [slug, name]);
    this.open.set(slug, db);
    return this.find(slug)!;
  }

  rename(slug: string, name: string): StoreRecord {
    const n = name.trim();
    if (n.length < 2 || n.length > 80)
      throw new InvalidRequestError('Store name must be 2-80 characters');
    this.directory.run('UPDATE stores SET name = ? WHERE slug = ?', [n, slug]);
    const rec = this.find(slug);
    if (!rec) throw new StoreNotFoundError();
    return rec;
  }

  /** Permanently erases a store: closes the connection and deletes its files. */
  deleteStore(slug: string): void {
    if (!this.exists(slug)) throw new StoreNotFoundError();
    const db = this.open.get(slug);
    if (db) {
      db.close();
      this.open.delete(slug);
    }
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(`${this.filePath(slug)}${suffix}`, { force: true });
    this.directory.run('DELETE FROM stores WHERE slug = ?', [slug]);
  }

  /** Flushes the WAL so the .db file alone is a complete, consistent export. */
  checkpoint(slug: string): string {
    const db = this.openStore(slug);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return this.filePath(slug);
  }

  closeAll(): void {
    for (const db of this.open.values()) db.close();
    this.open.clear();
    this.directory.close();
  }
}

export class StoreNotFoundError extends AppError {
  constructor() {
    super(ErrorCodes.NOT_FOUND, 'Store not found', 404);
  }
}

export { NotFoundError };
