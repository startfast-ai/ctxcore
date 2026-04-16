import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { TaskComment, TaskCommentAuthorType } from './types.js';

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

export class CommentStore {
  constructor(private db: Database.Database) {}

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

  updateComment(id: string, content: string): TaskComment | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE task_comments SET content = ?, created_at = ? WHERE id = ?')
      .run(content, now, id);
    if (result.changes === 0) return null;
    const row = this.db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToComment(row);
  }

  deleteComment(id: string): boolean {
    const result = this.db.prepare('DELETE FROM task_comments WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
