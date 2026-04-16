import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { MemoryStore } from '../../src/memory-store.js';
import { createTestDb } from '../helpers/test-db.js';

describe('MemoryStore', () => {
  let db: Database.Database;
  let store: MemoryStore;

  beforeEach(() => {
    db = createTestDb();
    store = new MemoryStore(db);
  });

  describe('create', () => {
    it('creates a memory with defaults', () => {
      const memory = store.create({ content: 'Test memory' });

      expect(memory.id).toBeDefined();
      expect(memory.content).toBe('Test memory');
      expect(memory.tier).toBe('short-term');
      expect(memory.importance).toBe(0.3);
      expect(memory.actuality).toBe(1.0);
      expect(memory.archived).toBe(false);
      expect(memory.accessCount).toBe(0);
      expect(memory.tags).toEqual([]);
    });

    it('creates a memory with custom values', () => {
      const memory = store.create({
        content: 'Important decision',
        tier: 'long-term',
        importance: 0.9,
        tags: ['architecture', 'decision'],
        metadata: { reason: 'performance' },
      });

      expect(memory.tier).toBe('long-term');
      expect(memory.importance).toBe(0.9);
      expect(memory.tags).toEqual(['architecture', 'decision']);
      expect(memory.metadata).toEqual({ reason: 'performance' });
    });
  });

  describe('getById', () => {
    it('returns null for non-existent id', () => {
      expect(store.getById('non-existent')).toBeNull();
    });

    it('returns the memory by id', () => {
      const created = store.create({ content: 'Find me' });
      const found = store.getById(created.id);

      expect(found).not.toBeNull();
      expect(found!.content).toBe('Find me');
    });
  });

  describe('update', () => {
    it('updates specified fields', () => {
      const created = store.create({ content: 'Original' });
      const updated = store.update(created.id, {
        content: 'Updated',
        tier: 'operational',
        importance: 0.7,
      });

      expect(updated!.content).toBe('Updated');
      expect(updated!.tier).toBe('operational');
      expect(updated!.importance).toBe(0.7);
    });

    it('returns null for non-existent id', () => {
      expect(store.update('non-existent', { content: 'x' })).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes a memory', () => {
      const created = store.create({ content: 'Delete me' });
      expect(store.delete(created.id)).toBe(true);
      expect(store.getById(created.id)).toBeNull();
    });

    it('returns false for non-existent id', () => {
      expect(store.delete('non-existent')).toBe(false);
    });
  });

  describe('archive', () => {
    it('archives a memory', () => {
      const created = store.create({ content: 'Archive me' });
      const archived = store.archive(created.id);

      expect(archived!.archived).toBe(true);
    });

    it('excludes archived from default list', () => {
      store.create({ content: 'Active' });
      const toArchive = store.create({ content: 'Archived' });
      store.archive(toArchive.id);

      const list = store.list();
      expect(list).toHaveLength(1);
      expect(list[0].content).toBe('Active');
    });
  });

  describe('recordAccess', () => {
    it('increments access count', () => {
      const created = store.create({ content: 'Access me' });
      store.recordAccess(created.id);
      store.recordAccess(created.id);

      const memory = store.getById(created.id);
      expect(memory!.accessCount).toBe(2);
    });
  });

  describe('list', () => {
    it('lists memories ordered by actuality and importance', () => {
      store.create({ content: 'Low', importance: 0.1 });
      store.create({ content: 'High', importance: 0.9 });
      store.create({ content: 'Medium', importance: 0.5 });

      const list = store.list();
      expect(list).toHaveLength(3);
      // All have actuality 1.0, so ordered by importance desc
      expect(list[0].content).toBe('High');
      expect(list[1].content).toBe('Medium');
      expect(list[2].content).toBe('Low');
    });

    it('filters by tier', () => {
      store.create({ content: 'Short', tier: 'short-term' });
      store.create({ content: 'Long', tier: 'long-term' });

      const list = store.list({ tier: 'long-term' });
      expect(list).toHaveLength(1);
      expect(list[0].content).toBe('Long');
    });
  });

  describe('searchByKeyword', () => {
    it('finds memories by content substring', () => {
      store.create({ content: 'The auth module has a bug' });
      store.create({ content: 'Performance is great' });
      store.create({ content: 'Auth timeout was fixed' });

      const results = store.searchByKeyword('auth');
      expect(results).toHaveLength(2);
    });
  });

  describe('connections', () => {
    it('creates and retrieves connections', () => {
      const m1 = store.create({ content: 'First' });
      const m2 = store.create({ content: 'Second' });

      const conn = store.createConnection({
        sourceId: m1.id,
        targetId: m2.id,
        type: 'causal',
        strength: 0.8,
      });

      expect(conn.type).toBe('causal');
      expect(conn.strength).toBe(0.8);

      const connections = store.getConnectionsFor(m1.id);
      expect(connections).toHaveLength(1);
    });

    it('deletes connections', () => {
      const m1 = store.create({ content: 'A' });
      const m2 = store.create({ content: 'B' });
      const conn = store.createConnection({ sourceId: m1.id, targetId: m2.id, type: 'supports' });

      expect(store.deleteConnection(conn.id)).toBe(true);
      expect(store.getConnectionsFor(m1.id)).toHaveLength(0);
    });
  });

  describe('events', () => {
    it('logs events on create', () => {
      const memory = store.create({ content: 'Tracked' });
      const events = store.getEvents(memory.id);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('created');
    });

    it('logs events on access', () => {
      const memory = store.create({ content: 'Tracked' });
      store.recordAccess(memory.id);

      const events = store.getEvents(memory.id);
      expect(events).toHaveLength(2);
      const types = events.map((e) => e.eventType);
      expect(types).toContain('created');
      expect(types).toContain('accessed');
    });
  });

  describe('stats', () => {
    it('returns correct stats', () => {
      store.create({ content: 'A', tier: 'short-term' });
      store.create({ content: 'B', tier: 'short-term' });
      store.create({ content: 'C', tier: 'long-term' });
      const d = store.create({ content: 'D' });
      store.archive(d.id);

      const stats = store.stats();
      expect(stats.total).toBe(3);
      expect(stats.archived).toBe(1);
      expect(stats.byTier['short-term']).toBe(2);
      expect(stats.byTier['long-term']).toBe(1);
    });
  });
});
