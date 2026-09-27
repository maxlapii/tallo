import type { Database } from '../db/connection.js';

export interface AuditEntry {
  userId: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  details?: unknown;
}

export interface AuditLogRow {
  id: number;
  user_id: number | null;
  action: string;
  entity: string;
  entity_id: number | null;
  details: string | null;
  created_at: string;
}

/**
 * Records who did what to which entity. Call inside the same transaction as
 * the operation being audited so the log and the change commit together.
 */
export function recordAudit(db: Database, entry: AuditEntry): number {
  const result = db.run(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
    [
      entry.userId,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.details === undefined ? null : JSON.stringify(entry.details),
    ],
  );
  return result.lastInsertRowid;
}

export function listAuditLogs(db: Database, entity?: string, entityId?: number): AuditLogRow[] {
  if (entity !== undefined && entityId !== undefined) {
    return db.all<AuditLogRow>(
      'SELECT * FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY id DESC',
      [entity, entityId],
    );
  }
  if (entity !== undefined) {
    return db.all<AuditLogRow>('SELECT * FROM audit_logs WHERE entity = ? ORDER BY id DESC', [
      entity,
    ]);
  }
  return db.all<AuditLogRow>('SELECT * FROM audit_logs ORDER BY id DESC');
}
