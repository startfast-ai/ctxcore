import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { TaskStore } from '../../src/tasks.js';
import { createTestDb } from '../helpers/test-db.js';

describe('TaskStore', () => {
  let db: Database.Database;
  let store: TaskStore;

  beforeEach(() => {
    db = createTestDb();
    store = new TaskStore(db);
  });

  describe('create', () => {
    it('creates a task with defaults', () => {
      const task = store.create({ projectId: 'proj-1', title: 'My Task' });

      expect(task.id).toBeDefined();
      expect(task.projectId).toBe('proj-1');
      expect(task.title).toBe('My Task');
      expect(task.description).toBe('');
      expect(task.status).toBe('open');
      expect(task.priority).toBe('medium');
      expect(task.columnId).toBeNull();
      expect(task.columnOrder).toBe(0);
      expect(task.assignee).toBeNull();
      expect(task.createdBy).toBeNull();
      expect(task.tags).toEqual([]);
      expect(task.estimatedEffort).toBeNull();
      expect(task.completedAt).toBeNull();
      expect(task.metadata).toEqual({});
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.updatedAt).toBeInstanceOf(Date);
    });

    it('creates a task with custom values', () => {
      const task = store.create({
        projectId: 'proj-1',
        title: 'Custom Task',
        description: 'A detailed task',
        status: 'in-progress',
        priority: 'high',
        assignee: 'alice',
        createdBy: 'bob',
        tags: ['frontend', 'urgent'],
        estimatedEffort: '3h',
        metadata: { sprint: 5 },
      });

      expect(task.title).toBe('Custom Task');
      expect(task.description).toBe('A detailed task');
      expect(task.status).toBe('in-progress');
      expect(task.priority).toBe('high');
      expect(task.assignee).toBe('alice');
      expect(task.createdBy).toBe('bob');
      expect(task.tags).toEqual(['frontend', 'urgent']);
      expect(task.estimatedEffort).toBe('3h');
      expect(task.metadata).toEqual({ sprint: 5 });
    });
  });

  describe('getById', () => {
    it('returns null for non-existent id', () => {
      expect(store.getById('non-existent')).toBeNull();
    });

    it('returns the task by id', () => {
      const created = store.create({ projectId: 'p1', title: 'Find me' });
      const found = store.getById(created.id);

      expect(found).not.toBeNull();
      expect(found!.title).toBe('Find me');
    });
  });

  describe('update', () => {
    it('updates specified fields', () => {
      const task = store.create({ projectId: 'p1', title: 'Original' });
      const updated = store.update(task.id, { title: 'Updated', priority: 'critical' });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated');
      expect(updated!.priority).toBe('critical');
    });

    it('returns null for non-existent task', () => {
      expect(store.update('nope', { title: 'X' })).toBeNull();
    });

    it('does not change unspecified fields', () => {
      const task = store.create({
        projectId: 'p1',
        title: 'Stable',
        priority: 'high',
        assignee: 'alice',
      });
      const updated = store.update(task.id, { title: 'Changed' });

      expect(updated!.priority).toBe('high');
      expect(updated!.assignee).toBe('alice');
    });

    it('can set completedAt', () => {
      const task = store.create({ projectId: 'p1', title: 'Done task' });
      const completedDate = new Date('2025-06-01T00:00:00.000Z');
      const updated = store.update(task.id, { completedAt: completedDate });

      expect(updated!.completedAt).toBeInstanceOf(Date);
      expect(updated!.completedAt!.toISOString()).toBe(completedDate.toISOString());
    });
  });

  describe('list', () => {
    it('lists all tasks', () => {
      store.create({ projectId: 'p1', title: 'A' });
      store.create({ projectId: 'p1', title: 'B' });
      store.create({ projectId: 'p1', title: 'C' });

      const tasks = store.list();
      expect(tasks).toHaveLength(3);
    });

    it('filters by status', () => {
      store.create({ projectId: 'p1', title: 'Open', status: 'open' });
      store.create({ projectId: 'p1', title: 'Done', status: 'done' });

      const tasks = store.list({ status: 'open' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Open');
    });

    it('filters by assignee', () => {
      store.create({ projectId: 'p1', title: 'Alice task', assignee: 'alice' });
      store.create({ projectId: 'p1', title: 'Bob task', assignee: 'bob' });

      const tasks = store.list({ assignee: 'alice' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Alice task');
    });

    it('filters by tag', () => {
      store.create({ projectId: 'p1', title: 'Frontend', tags: ['frontend', 'ui'] });
      store.create({ projectId: 'p1', title: 'Backend', tags: ['backend'] });

      const tasks = store.list({ tag: 'frontend' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Frontend');
    });

    it('filters by createdBy', () => {
      store.create({ projectId: 'p1', title: 'By AI', createdBy: 'ai-agent' });
      store.create({ projectId: 'p1', title: 'By Human', createdBy: 'human' });

      const tasks = store.list({ createdBy: 'ai-agent' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('By AI');
    });

    it('filters by columnId', () => {
      const columns = store.seedDefaultColumns('p1');
      const backlogCol = columns[0];
      const todoCol = columns[1];

      store.create({ projectId: 'p1', title: 'In Backlog', columnId: backlogCol.id });
      store.create({ projectId: 'p1', title: 'In Todo', columnId: todoCol.id });

      const tasks = store.list({ columnId: backlogCol.id });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('In Backlog');
    });

    it('supports limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        store.create({ projectId: 'p1', title: `Task ${i}`, columnOrder: i });
      }

      const page = store.list({ limit: 2, offset: 2 });
      expect(page).toHaveLength(2);
    });
  });

  describe('move', () => {
    it('moves a task to a new column with order', () => {
      const columns = store.seedDefaultColumns('p1');
      const task = store.create({ projectId: 'p1', title: 'Move me', columnId: columns[0].id, columnOrder: 0 });

      const moved = store.move(task.id, columns[2].id, 1.5);

      expect(moved).not.toBeNull();
      expect(moved!.columnId).toBe(columns[2].id);
      expect(moved!.columnOrder).toBe(1.5);
    });

    it('returns null for non-existent task', () => {
      expect(store.move('nope', 'col', 0)).toBeNull();
    });
  });

  describe('fractional ordering', () => {
    it('supports inserting between two tasks using fractional order', () => {
      const columns = store.seedDefaultColumns('p1');
      const col = columns[0];

      const t1 = store.create({ projectId: 'p1', title: 'First', columnId: col.id, columnOrder: 1 });
      const t3 = store.create({ projectId: 'p1', title: 'Third', columnId: col.id, columnOrder: 3 });

      // Insert between: average of 1 and 3 = 2
      const t2 = store.create({ projectId: 'p1', title: 'Second', columnId: col.id, columnOrder: 2 });

      const tasks = store.list({ columnId: col.id });
      expect(tasks[0].title).toBe('First');
      expect(tasks[1].title).toBe('Second');
      expect(tasks[2].title).toBe('Third');
    });

    it('supports deeply nested fractional ordering', () => {
      const columns = store.seedDefaultColumns('p1');
      const col = columns[0];

      store.create({ projectId: 'p1', title: 'A', columnId: col.id, columnOrder: 1.0 });
      store.create({ projectId: 'p1', title: 'C', columnId: col.id, columnOrder: 2.0 });
      store.create({ projectId: 'p1', title: 'B', columnId: col.id, columnOrder: 1.5 });
      store.create({ projectId: 'p1', title: 'A.5', columnId: col.id, columnOrder: 1.25 });

      const tasks = store.list({ columnId: col.id });
      expect(tasks.map((t) => t.title)).toEqual(['A', 'A.5', 'B', 'C']);
    });
  });

  describe('archive', () => {
    it('archives a task by setting status to archived', () => {
      const task = store.create({ projectId: 'p1', title: 'Archive me' });
      const archived = store.archive(task.id);

      expect(archived).not.toBeNull();
      expect(archived!.status).toBe('archived');
    });

    it('returns null for non-existent task', () => {
      expect(store.archive('nope')).toBeNull();
    });
  });

  describe('seedDefaultColumns', () => {
    it('seeds 5 default columns', () => {
      const columns = store.seedDefaultColumns('p1');

      expect(columns).toHaveLength(5);
      expect(columns.map((c) => c.title)).toEqual(['Backlog', 'Todo', 'In Progress', 'Review', 'Done']);
      expect(columns.map((c) => c.columnOrder)).toEqual([0, 1, 2, 3, 4]);
    });

    it('is idempotent — returns existing columns on second call', () => {
      const first = store.seedDefaultColumns('p1');
      const second = store.seedDefaultColumns('p1');

      expect(second).toHaveLength(5);
      expect(second[0].id).toBe(first[0].id);
    });

    it('creates separate columns for different projects', () => {
      const cols1 = store.seedDefaultColumns('p1');
      const cols2 = store.seedDefaultColumns('p2');

      expect(cols1[0].id).not.toBe(cols2[0].id);
    });
  });

  describe('isColumnAtLimit', () => {
    it('returns false when column has no WIP limit', () => {
      const columns = store.seedDefaultColumns('p1');
      expect(store.isColumnAtLimit(columns[0].id)).toBe(false);
    });

    it('returns false when under WIP limit', () => {
      const colId = 'wip-col';
      db.prepare(
        `INSERT INTO kanban_columns (id, project_id, title, column_order, wip_limit) VALUES (?, ?, ?, ?, ?)`,
      ).run(colId, 'p1', 'Limited', 0, 3);

      store.create({ projectId: 'p1', title: 'T1', columnId: colId });
      store.create({ projectId: 'p1', title: 'T2', columnId: colId });

      expect(store.isColumnAtLimit(colId)).toBe(false);
    });

    it('returns true when at WIP limit', () => {
      const colId = 'wip-col-full';
      db.prepare(
        `INSERT INTO kanban_columns (id, project_id, title, column_order, wip_limit) VALUES (?, ?, ?, ?, ?)`,
      ).run(colId, 'p1', 'Full', 0, 2);

      store.create({ projectId: 'p1', title: 'T1', columnId: colId });
      store.create({ projectId: 'p1', title: 'T2', columnId: colId });

      expect(store.isColumnAtLimit(colId)).toBe(true);
    });

    it('does not count archived tasks toward WIP limit', () => {
      const colId = 'wip-col-archived';
      db.prepare(
        `INSERT INTO kanban_columns (id, project_id, title, column_order, wip_limit) VALUES (?, ?, ?, ?, ?)`,
      ).run(colId, 'p1', 'Mixed', 0, 2);

      store.create({ projectId: 'p1', title: 'Active', columnId: colId });
      const archived = store.create({ projectId: 'p1', title: 'Archived', columnId: colId });
      store.archive(archived.id);

      expect(store.isColumnAtLimit(colId)).toBe(false);
    });

    it('returns false for non-existent column', () => {
      expect(store.isColumnAtLimit('no-such-col')).toBe(false);
    });
  });
});
