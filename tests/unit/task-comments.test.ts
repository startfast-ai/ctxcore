import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { CommentStore } from '../../src/task-comments.js';
import { TaskStore } from '../../src/tasks.js';
import { createTestDb } from '../helpers/test-db.js';

describe('CommentStore', () => {
  let db: Database.Database;
  let commentStore: CommentStore;
  let taskStore: TaskStore;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    commentStore = new CommentStore(db);
    taskStore = new TaskStore(db);
    const task = taskStore.create({ projectId: 'p1', title: 'Test task' });
    taskId = task.id;
  });

  describe('addComment', () => {
    it('adds a human comment', () => {
      const comment = commentStore.addComment(taskId, 'alice', 'human', 'This looks good');

      expect(comment.id).toBeDefined();
      expect(comment.taskId).toBe(taskId);
      expect(comment.author).toBe('alice');
      expect(comment.authorType).toBe('human');
      expect(comment.content).toBe('This looks good');
      expect(comment.createdAt).toBeInstanceOf(Date);
      expect(comment.metadata).toEqual({});
    });

    it('adds an AI comment', () => {
      const comment = commentStore.addComment(taskId, 'claude', 'ai', 'I analyzed this task');

      expect(comment.authorType).toBe('ai');
      expect(comment.author).toBe('claude');
    });

    it('rejects invalid author_type via DB constraint', () => {
      expect(() => {
        commentStore.addComment(taskId, 'bot', 'robot' as 'human', 'Invalid type');
      }).toThrow();
    });
  });

  describe('getComments', () => {
    it('returns empty array when no comments', () => {
      expect(commentStore.getComments(taskId)).toEqual([]);
    });

    it('returns comments in chronological order', () => {
      commentStore.addComment(taskId, 'alice', 'human', 'First');
      commentStore.addComment(taskId, 'claude', 'ai', 'Second');
      commentStore.addComment(taskId, 'bob', 'human', 'Third');

      const comments = commentStore.getComments(taskId);
      expect(comments).toHaveLength(3);
      expect(comments[0].content).toBe('First');
      expect(comments[1].content).toBe('Second');
      expect(comments[2].content).toBe('Third');
    });

    it('only returns comments for the specified task', () => {
      const task2 = taskStore.create({ projectId: 'p1', title: 'Other task' });
      commentStore.addComment(taskId, 'alice', 'human', 'On task 1');
      commentStore.addComment(task2.id, 'bob', 'human', 'On task 2');

      const comments = commentStore.getComments(taskId);
      expect(comments).toHaveLength(1);
      expect(comments[0].content).toBe('On task 1');
    });
  });

  describe('deleteComment', () => {
    it('deletes an existing comment', () => {
      const comment = commentStore.addComment(taskId, 'alice', 'human', 'Delete me');
      const deleted = commentStore.deleteComment(comment.id);

      expect(deleted).toBe(true);
      expect(commentStore.getComments(taskId)).toHaveLength(0);
    });

    it('returns false for non-existent comment', () => {
      expect(commentStore.deleteComment('non-existent')).toBe(false);
    });
  });
});
