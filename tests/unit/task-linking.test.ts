import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { TaskLinkStore } from '../../src/task-linking.js';
import { TaskStore } from '../../src/tasks.js';
import { MemoryStore } from '../../src/memory-store.js';
import { createTestDb } from '../helpers/test-db.js';

describe('TaskLinkStore', () => {
  let db: Database.Database;
  let linkStore: TaskLinkStore;
  let taskStore: TaskStore;
  let memoryStore: MemoryStore;
  let taskId: string;
  let memoryId: string;

  beforeEach(() => {
    db = createTestDb();
    linkStore = new TaskLinkStore(db);
    taskStore = new TaskStore(db);
    memoryStore = new MemoryStore(db);

    const task = taskStore.create({ projectId: 'p1', title: 'Test task' });
    taskId = task.id;

    const memory = memoryStore.create({ content: 'Test memory' });
    memoryId = memory.id;
  });

  describe('linkMemory / unlinkMemory', () => {
    it('links a memory to a task', () => {
      const link = linkStore.linkMemory(taskId, memoryId, 'related');

      expect(link.taskId).toBe(taskId);
      expect(link.memoryId).toBe(memoryId);
      expect(link.linkType).toBe('related');
      expect(link.createdAt).toBeInstanceOf(Date);
    });

    it('overwrites link type on re-link (INSERT OR REPLACE)', () => {
      linkStore.linkMemory(taskId, memoryId, 'related');
      const updated = linkStore.linkMemory(taskId, memoryId, 'blocker');

      expect(updated.linkType).toBe('blocker');

      const links = linkStore.getLinkedMemories(taskId);
      expect(links).toHaveLength(1);
    });

    it('unlinks a memory from a task', () => {
      linkStore.linkMemory(taskId, memoryId, 'decision');
      const removed = linkStore.unlinkMemory(taskId, memoryId);

      expect(removed).toBe(true);
      expect(linkStore.getLinkedMemories(taskId)).toHaveLength(0);
    });

    it('returns false when unlinking non-existent link', () => {
      expect(linkStore.unlinkMemory(taskId, 'no-memory')).toBe(false);
    });
  });

  describe('linkSpec / unlinkSpec', () => {
    const specId = 'spec-001';

    it('links a spec to a task', () => {
      const link = linkStore.linkSpec(taskId, specId, 'implements');

      expect(link.taskId).toBe(taskId);
      expect(link.specId).toBe(specId);
      expect(link.linkType).toBe('implements');
      expect(link.createdAt).toBeInstanceOf(Date);
    });

    it('overwrites link type on re-link', () => {
      linkStore.linkSpec(taskId, specId, 'implements');
      const updated = linkStore.linkSpec(taskId, specId, 'blocked_by');

      expect(updated.linkType).toBe('blocked_by');

      const links = linkStore.getLinkedSpecs(taskId);
      expect(links).toHaveLength(1);
    });

    it('unlinks a spec from a task', () => {
      linkStore.linkSpec(taskId, specId, 'related');
      const removed = linkStore.unlinkSpec(taskId, specId);

      expect(removed).toBe(true);
      expect(linkStore.getLinkedSpecs(taskId)).toHaveLength(0);
    });

    it('returns false when unlinking non-existent link', () => {
      expect(linkStore.unlinkSpec(taskId, 'no-spec')).toBe(false);
    });
  });

  describe('getLinkedMemories / getLinkedSpecs', () => {
    it('returns all linked memories for a task', () => {
      const mem2 = memoryStore.create({ content: 'Another memory' });
      linkStore.linkMemory(taskId, memoryId, 'related');
      linkStore.linkMemory(taskId, mem2.id, 'decision');

      const links = linkStore.getLinkedMemories(taskId);
      expect(links).toHaveLength(2);
    });

    it('returns all linked specs for a task', () => {
      linkStore.linkSpec(taskId, 'spec-1', 'implements');
      linkStore.linkSpec(taskId, 'spec-2', 'related');

      const links = linkStore.getLinkedSpecs(taskId);
      expect(links).toHaveLength(2);
    });

    it('returns empty array when no links', () => {
      expect(linkStore.getLinkedMemories(taskId)).toEqual([]);
      expect(linkStore.getLinkedSpecs(taskId)).toEqual([]);
    });
  });

  describe('bidirectional queries', () => {
    it('getTasksForMemory returns tasks linked to a memory', () => {
      const task2 = taskStore.create({ projectId: 'p1', title: 'Task 2' });
      linkStore.linkMemory(taskId, memoryId, 'related');
      linkStore.linkMemory(task2.id, memoryId, 'caused_by');

      const links = linkStore.getTasksForMemory(memoryId);
      expect(links).toHaveLength(2);
      expect(links.map((l) => l.taskId).sort()).toEqual([taskId, task2.id].sort());
    });

    it('getTasksForSpec returns tasks linked to a spec', () => {
      const task2 = taskStore.create({ projectId: 'p1', title: 'Task 2' });
      linkStore.linkSpec(taskId, 'spec-x', 'implements');
      linkStore.linkSpec(task2.id, 'spec-x', 'related');

      const links = linkStore.getTasksForSpec('spec-x');
      expect(links).toHaveLength(2);
      expect(links.map((l) => l.taskId).sort()).toEqual([taskId, task2.id].sort());
    });

    it('getTasksForMemory returns empty for unlinked memory', () => {
      expect(linkStore.getTasksForMemory('orphan')).toEqual([]);
    });

    it('getTasksForSpec returns empty for unlinked spec', () => {
      expect(linkStore.getTasksForSpec('orphan')).toEqual([]);
    });
  });
});
