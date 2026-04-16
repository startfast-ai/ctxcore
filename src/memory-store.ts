import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  Memory,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryEvent,
  MemoryTier,
  Connection,
  ConnectionCreateInput,
  IMemoryStore,
} from './types.js';

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    content: row.content as string,
    tier: row.tier as MemoryTier,
    importance: row.importance as number,
    actuality: row.actuality as number,
    embedding: null,
    tags: JSON.parse(row.tags as string),
    metadata: JSON.parse(row.metadata as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    lastAccessedAt: new Date(row.last_accessed_at as string),
    accessCount: row.access_count as number,
    archived: (row.archived as number) === 1,
  };
}

function rowToConnection(row: Record<string, unknown>): Connection {
  return {
    id: row.id as string,
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    type: row.type as Connection['type'],
    strength: row.strength as number,
    metadata: JSON.parse(row.metadata as string),
    createdAt: new Date(row.created_at as string),
  };
}

export class MemoryStore implements IMemoryStore {
  constructor(private db: Database.Database) {}

  create(input: MemoryCreateInput): Memory {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO memories (id, content, tier, importance, tags, metadata, created_at, updated_at, last_accessed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.content,
        input.tier ?? 'short-term',
        input.importance ?? 0.3,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
        now,
      );

    this.logEvent(id, 'created', { tier: input.tier ?? 'short-term' });

    return this.getById(id)!;
  }

  getById(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToMemory(row) : null;
  }

  update(id: string, input: MemoryUpdateInput): Memory | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.content !== undefined) {
      fields.push('content = ?');
      values.push(input.content);
    }
    if (input.tier !== undefined) {
      fields.push('tier = ?');
      values.push(input.tier);
    }
    if (input.importance !== undefined) {
      fields.push('importance = ?');
      values.push(input.importance);
    }
    if (input.actuality !== undefined) {
      fields.push('actuality = ?');
      values.push(input.actuality);
    }
    if (input.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(input.tags));
    }
    if (input.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }
    if (input.archived !== undefined) {
      fields.push('archived = ?');
      values.push(input.archived ? 1 : 0);
    }

    if (fields.length === 0) return existing;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    this.logEvent(id, 'updated', { fields: Object.keys(input) });

    return this.getById(id)!;
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  archive(id: string): Memory | null {
    const memory = this.update(id, { archived: true });
    if (memory) {
      this.logEvent(id, 'archived', {});
    }
    return memory;
  }

  recordAccess(id: string): Memory | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1, updated_at = ? WHERE id = ?`,
      )
      .run(now, now, id);

    if (result.changes === 0) return null;

    this.logEvent(id, 'accessed', {});

    return this.getById(id)!;
  }

  list(options?: {
    tier?: MemoryTier;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  }): Memory[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!options?.includeArchived) {
      conditions.push('archived = 0');
    }
    if (options?.tier) {
      conditions.push('tier = ?');
      params.push(options.tier);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM memories ${where} ORDER BY actuality DESC, importance DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[];

    return rows.map(rowToMemory);
  }

  searchByKeyword(query: string, options?: { limit?: number; includeArchived?: boolean }): Memory[] {
    const conditions = ['content LIKE ?'];
    const params: unknown[] = [`%${query}%`];

    if (!options?.includeArchived) {
      conditions.push('archived = 0');
    }

    const where = conditions.join(' AND ');
    const limit = options?.limit ?? 20;

    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE ${where} ORDER BY actuality DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];

    return rows.map(rowToMemory);
  }

  // Connection operations

  createConnection(input: ConnectionCreateInput): Connection {
    const id = randomUUID();

    this.db
      .prepare(
        `INSERT INTO connections (id, source_id, target_id, type, strength, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.sourceId, input.targetId, input.type, input.strength ?? 0.5, JSON.stringify(input.metadata ?? {}));

    return this.getConnectionById(id)!;
  }

  getConnectionById(id: string): Connection | null {
    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToConnection(row) : null;
  }

  getConnectionsFor(memoryId: string): Connection[] {
    const rows = this.db
      .prepare('SELECT * FROM connections WHERE source_id = ? OR target_id = ?')
      .all(memoryId, memoryId) as Record<string, unknown>[];
    return rows.map(rowToConnection);
  }

  deleteConnection(id: string): boolean {
    const result = this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Event logging

  private logEvent(memoryId: string, eventType: MemoryEvent['eventType'], data: Record<string, unknown>): void {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO memory_events (id, memory_id, event_type, data) VALUES (?, ?, ?, ?)')
      .run(id, memoryId, eventType, JSON.stringify(data));
  }

  getEvents(memoryId: string): MemoryEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_events WHERE memory_id = ? ORDER BY created_at DESC')
      .all(memoryId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      memoryId: row.memory_id as string,
      eventType: row.event_type as MemoryEvent['eventType'],
      data: JSON.parse(row.data as string),
      createdAt: new Date(row.created_at as string),
    }));
  }

  // Stats

  stats(): { total: number; byTier: Record<string, number>; archived: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE archived = 0').get() as { count: number }).count;
    const archived = (this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE archived = 1').get() as { count: number }).count;

    const tiers = this.db
      .prepare('SELECT tier, COUNT(*) as count FROM memories WHERE archived = 0 GROUP BY tier')
      .all() as { tier: string; count: number }[];

    const byTier: Record<string, number> = {};
    for (const t of tiers) {
      byTier[t.tier] = t.count;
    }

    return { total, byTier, archived };
  }
}
