import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskComment,
  KanbanColumn,
  TaskMemoryLink,
  TaskSpecLink,
  TaskListOptions,
  TaskCommentAuthorType,
  TaskMemoryLinkType,
  TaskSpecLinkType,
  ITaskStore,
} from './types.js';

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as Task['status'],
    columnId: (row.column_id as string) ?? null,
    columnOrder: row.column_order as number,
    priority: row.priority as Task['priority'],
    assignee: (row.assignee as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    tags: JSON.parse(row.tags as string),
    estimatedEffort: (row.estimated_effort as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    metadata: JSON.parse(row.metadata as string),
  };
}

function rowToColumn(row: Record<string, unknown>): KanbanColumn {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    columnOrder: row.column_order as number,
    wipLimit: (row.wip_limit as number) ?? null,
    color: (row.color as string) ?? null,
  };
}

function rowToComment(row: Record<string, unknown>): TaskComment {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    author: row.author as string,
    authorType: row.author_type as TaskCommentAuthorType,
    content: row.content as string,
    createdAt: new Date(row.created_at as string),
    metadata: JSON.parse(row.metadata as string),
  };
}

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

const DEFAULT_COLUMNS = [
  { title: 'Backlog', order: 0 },
  { title: 'Todo', order: 1 },
  { title: 'In Progress', order: 2 },
  { title: 'Review', order: 3 },
  { title: 'Done', order: 4 },
];

export class TaskStore implements ITaskStore {
  constructor(private db: Database.Database) {}

  create(input: TaskCreateInput): Task {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, title, description, status, column_id, column_order, priority, assignee, created_by, tags, estimated_effort, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.title,
        input.description ?? '',
        input.status ?? 'open',
        input.columnId ?? null,
        input.columnOrder ?? 0,
        input.priority ?? 'medium',
        input.assignee ?? null,
        input.createdBy ?? null,
        JSON.stringify(input.tags ?? []),
        input.estimatedEffort ?? null,
        now,
        now,
        JSON.stringify(input.metadata ?? {}),
      );

    return this.getById(id)!;
  }

  getById(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToTask(row) : null;
  }

  update(id: string, input: TaskUpdateInput): Task | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.title !== undefined) {
      fields.push('title = ?');
      values.push(input.title);
    }
    if (input.description !== undefined) {
      fields.push('description = ?');
      values.push(input.description);
    }
    if (input.status !== undefined) {
      fields.push('status = ?');
      values.push(input.status);
    }
    if (input.columnId !== undefined) {
      fields.push('column_id = ?');
      values.push(input.columnId);
    }
    if (input.columnOrder !== undefined) {
      fields.push('column_order = ?');
      values.push(input.columnOrder);
    }
    if (input.priority !== undefined) {
      fields.push('priority = ?');
      values.push(input.priority);
    }
    if (input.assignee !== undefined) {
      fields.push('assignee = ?');
      values.push(input.assignee);
    }
    if (input.createdBy !== undefined) {
      fields.push('created_by = ?');
      values.push(input.createdBy);
    }
    if (input.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(input.tags));
    }
    if (input.estimatedEffort !== undefined) {
      fields.push('estimated_effort = ?');
      values.push(input.estimatedEffort);
    }
    if (input.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(input.completedAt ? input.completedAt.toISOString() : null);
    }
    if (input.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    if (fields.length === 0) return existing;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id)!;
  }

  list(options?: TaskListOptions): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options?.columnId) {
      conditions.push('column_id = ?');
      params.push(options.columnId);
    }
    if (options?.assignee) {
      conditions.push('assignee = ?');
      params.push(options.assignee);
    }
    if (options?.tag) {
      conditions.push("tags LIKE ?");
      params.push(`%"${options.tag}"%`);
    }
    if (options?.createdBy) {
      conditions.push('created_by = ?');
      params.push(options.createdBy);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY column_order ASC, created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[];

    return rows.map(rowToTask);
  }

  move(id: string, columnId: string, order: number): Task | null {
    return this.update(id, { columnId, columnOrder: order });
  }

  archive(id: string): Task | null {
    return this.update(id, { status: 'archived' });
  }

  addComment(taskId: string, author: string, authorType: TaskCommentAuthorType, content: string): TaskComment {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO task_comments (id, task_id, author, author_type, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, taskId, author, authorType, content, now);

    const row = this.db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id) as Record<string, unknown>;
    return rowToComment(row);
  }

  getComments(taskId: string): TaskComment[] {
    const rows = this.db
      .prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as Record<string, unknown>[];
    return rows.map(rowToComment);
  }

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

  seedDefaultColumns(projectId: string): KanbanColumn[] {
    // Check if columns already exist for this project
    const existing = this.db
      .prepare('SELECT COUNT(*) as count FROM kanban_columns WHERE project_id = ?')
      .get(projectId) as { count: number };

    if (existing.count > 0) {
      const rows = this.db
        .prepare('SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY column_order ASC')
        .all(projectId) as Record<string, unknown>[];
      return rows.map(rowToColumn);
    }

    const columns: KanbanColumn[] = [];
    for (const col of DEFAULT_COLUMNS) {
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO kanban_columns (id, project_id, title, column_order)
           VALUES (?, ?, ?, ?)`,
        )
        .run(id, projectId, col.title, col.order);

      const row = this.db.prepare('SELECT * FROM kanban_columns WHERE id = ?').get(id) as Record<string, unknown>;
      columns.push(rowToColumn(row));
    }

    return columns;
  }

  isColumnAtLimit(columnId: string): boolean {
    const col = this.db.prepare('SELECT wip_limit FROM kanban_columns WHERE id = ?').get(columnId) as
      | { wip_limit: number | null }
      | undefined;

    if (!col || col.wip_limit === null) return false;

    const count = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM tasks WHERE column_id = ? AND status != 'archived'")
        .get(columnId) as { count: number }
    ).count;

    return count >= col.wip_limit;
  }
}
