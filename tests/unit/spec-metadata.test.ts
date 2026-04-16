import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetadataStore } from '../../src/spec-metadata.js';
import type { SpecMetadata } from '../../src/types.js';

describe('MetadataStore', () => {
  let tmpDir: string;
  let specsDir: string;
  let metaStore: MetadataStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctxcore-meta-'));
    specsDir = join(tmpDir, 'specs');
    mkdirSync(specsDir, { recursive: true });
    metaStore = new MetadataStore(specsDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTestMetadata(id: string): SpecMetadata {
    const now = new Date();
    return {
      id,
      title: `Test ${id}`,
      status: 'draft',
      createdBy: 'human',
      createdAt: now,
      updatedAt: now,
      tags: ['test'],
      linkedTasks: [],
      linkedMemories: [],
      comments: [],
      versions: [
        {
          version: 1,
          timestamp: now,
          author: 'human',
          summary: 'Initial creation',
        },
      ],
    };
  }

  describe('read/write', () => {
    it('returns null for non-existent spec', () => {
      expect(metaStore.read('non-existent')).toBeNull();
    });

    it('writes and reads metadata', () => {
      const meta = createTestMetadata('test-spec');
      metaStore.write('test-spec', meta);

      const read = metaStore.read('test-spec');
      expect(read).not.toBeNull();
      expect(read!.id).toBe('test-spec');
      expect(read!.title).toBe('Test test-spec');
      expect(read!.status).toBe('draft');
      expect(read!.tags).toEqual(['test']);
      expect(read!.createdAt).toBeInstanceOf(Date);
      expect(read!.updatedAt).toBeInstanceOf(Date);
    });

    it('preserves all fields through serialization round-trip', () => {
      const meta = createTestMetadata('roundtrip');
      meta.linkedTasks = ['task-1', 'task-2'];
      meta.linkedMemories = ['mem-1'];
      metaStore.write('roundtrip', meta);

      const read = metaStore.read('roundtrip')!;
      expect(read.linkedTasks).toEqual(['task-1', 'task-2']);
      expect(read.linkedMemories).toEqual(['mem-1']);
    });
  });

  describe('addVersion', () => {
    it('appends a version to the versions array', () => {
      const meta = createTestMetadata('version-test');
      metaStore.write('version-test', meta);

      metaStore.addVersion('version-test', {
        version: 2,
        timestamp: new Date(),
        author: 'human',
        summary: 'Second version',
      });

      const read = metaStore.read('version-test')!;
      expect(read.versions).toHaveLength(2);
      expect(read.versions[1].version).toBe(2);
      expect(read.versions[1].summary).toBe('Second version');
    });

    it('versions are ordered by insertion', () => {
      const meta = createTestMetadata('order-test');
      metaStore.write('order-test', meta);

      metaStore.addVersion('order-test', {
        version: 2,
        timestamp: new Date(),
        author: 'human',
        summary: 'v2',
      });

      metaStore.addVersion('order-test', {
        version: 3,
        timestamp: new Date(),
        author: 'ai',
        summary: 'v3',
      });

      const read = metaStore.read('order-test')!;
      expect(read.versions.map((v) => v.version)).toEqual([1, 2, 3]);
      expect(read.versions[2].author).toBe('ai');
    });

    it('does nothing for non-existent spec', () => {
      // Should not throw
      metaStore.addVersion('non-existent', {
        version: 1,
        timestamp: new Date(),
        author: 'human',
        summary: 'test',
      });
    });
  });

  describe('addComment', () => {
    it('appends a comment and returns it with id and timestamp', () => {
      const meta = createTestMetadata('comment-test');
      metaStore.write('comment-test', meta);

      const comment = metaStore.addComment('comment-test', {
        author: 'bob',
        authorType: 'human',
        content: 'Great work!',
      });

      expect(comment.id).toBeDefined();
      expect(comment.author).toBe('bob');
      expect(comment.authorType).toBe('human');
      expect(comment.content).toBe('Great work!');
      expect(comment.createdAt).toBeInstanceOf(Date);

      const read = metaStore.read('comment-test')!;
      expect(read.comments).toHaveLength(1);
      expect(read.comments[0].id).toBe(comment.id);
    });

    it('supports multiple comments', () => {
      const meta = createTestMetadata('multi-comment');
      metaStore.write('multi-comment', meta);

      metaStore.addComment('multi-comment', {
        author: 'alice',
        authorType: 'human',
        content: 'First',
      });
      metaStore.addComment('multi-comment', {
        author: 'claude',
        authorType: 'ai',
        content: 'Second',
      });

      const read = metaStore.read('multi-comment')!;
      expect(read.comments).toHaveLength(2);
      expect(read.comments[0].author).toBe('alice');
      expect(read.comments[1].author).toBe('claude');
    });

    it('throws for non-existent spec', () => {
      expect(() =>
        metaStore.addComment('non-existent', {
          author: 'alice',
          authorType: 'human',
          content: 'test',
        }),
      ).toThrow('Spec not found: non-existent');
    });

    it('supports optional target field', () => {
      const meta = createTestMetadata('target-test');
      metaStore.write('target-test', meta);

      const comment = metaStore.addComment('target-test', {
        author: 'alice',
        authorType: 'human',
        content: 'Regarding section 2',
        target: 'section-2',
      });

      expect(comment.target).toBe('section-2');

      const read = metaStore.read('target-test')!;
      expect(read.comments[0].target).toBe('section-2');
    });
  });

  describe('list', () => {
    it('returns empty array when no specs exist', () => {
      expect(metaStore.list()).toEqual([]);
    });

    it('returns all metadata entries', () => {
      metaStore.write('spec-a', createTestMetadata('spec-a'));
      metaStore.write('spec-b', createTestMetadata('spec-b'));

      const all = metaStore.list();
      expect(all).toHaveLength(2);
      const ids = all.map((m) => m.id).sort();
      expect(ids).toEqual(['spec-a', 'spec-b']);
    });
  });
});
