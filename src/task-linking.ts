import type Database from 'better-sqlite3';
import type {
  TaskMemoryLink,
  TaskSpecLink,
  TaskMemoryLinkType,
  TaskSpecLinkType,
} from './types.js';

function rowToMemoryLink(row: Record<string, unknown>): TaskMemoryLink {
  return {
    taskId: row.task_id as string,
    memoryId: row.memory_id as string,
    linkType: row.link_type as TaskMemoryLinkType,
    createdAt: new Date(row.created_at as string),
  };
}

function rowToSpecLink(row: Record<string, unknown>): TaskSpecLink {
  return {
    taskId: row.task_id as string,
    specId: row.spec_id as string,
    linkType: row.link_type as TaskSpecLinkType,
    createdAt: new Date(row.created_at as string),
  };
}

export class TaskLinkStore {
  constructor(private db: Database.Database) {}

  linkMemory(taskId: string, memoryId: string, linkType: TaskMemoryLinkType): TaskMemoryLink {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO task_memory_links (task_id, memory_id, link_type, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(taskId, memoryId, linkType, now);

    const row = this.db
      .prepare('SELECT * FROM task_memory_links WHERE task_id = ? AND memory_id = ?')
      .get(taskId, memoryId) as Record<string, unknown>;
    return rowToMemoryLink(row);
  }

  linkSpec(taskId: string, specId: string, linkType: TaskSpecLinkType): TaskSpecLink {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO task_spec_links (task_id, spec_id, link_type, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(taskId, specId, linkType, now);

    const row = this.db
      .prepare('SELECT * FROM task_spec_links WHERE task_id = ? AND spec_id = ?')
      .get(taskId, specId) as Record<string, unknown>;
    return rowToSpecLink(row);
  }

  unlinkMemory(taskId: string, memoryId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM task_memory_links WHERE task_id = ? AND memory_id = ?')
      .run(taskId, memoryId);
    return result.changes > 0;
  }

  unlinkSpec(taskId: string, specId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM task_spec_links WHERE task_id = ? AND spec_id = ?')
      .run(taskId, specId);
    return result.changes > 0;
  }

  getLinkedMemories(taskId: string): TaskMemoryLink[] {
    const rows = this.db
      .prepare('SELECT * FROM task_memory_links WHERE task_id = ?')
      .all(taskId) as Record<string, unknown>[];
    return rows.map(rowToMemoryLink);
  }

  getLinkedSpecs(taskId: string): TaskSpecLink[] {
    const rows = this.db
      .prepare('SELECT * FROM task_spec_links WHERE task_id = ?')
      .all(taskId) as Record<string, unknown>[];
    return rows.map(rowToSpecLink);
  }

  getTasksForMemory(memoryId: string): TaskMemoryLink[] {
    const rows = this.db
      .prepare('SELECT * FROM task_memory_links WHERE memory_id = ?')
      .all(memoryId) as Record<string, unknown>[];
    return rows.map(rowToMemoryLink);
  }

  getTasksForSpec(specId: string): TaskSpecLink[] {
    const rows = this.db
      .prepare('SELECT * FROM task_spec_links WHERE spec_id = ?')
      .all(specId) as Record<string, unknown>[];
    return rows.map(rowToSpecLink);
  }
}
