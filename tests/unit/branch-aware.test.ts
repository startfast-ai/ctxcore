import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { BranchManager } from '../../src/branch-aware.js';
import type { IMemoryStore, Memory, MemoryTier, MemoryUpdateInput } from '../../src/types.js';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? `mem-${Math.random().toString(36).slice(2)}`,
    content: overrides.content ?? 'test memory',
    tier: overrides.tier ?? 'operational',
    importance: overrides.importance ?? 0.5,
    actuality: overrides.actuality ?? 0.8,
    embedding: null,
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    lastAccessedAt: overrides.lastAccessedAt ?? new Date(),
    accessCount: overrides.accessCount ?? 1,
    archived: overrides.archived ?? false,
  };
}

// ── Simple mock store that tracks updates ──

class MockStore {
  private memories: Map<string, Memory> = new Map();

  addMemory(m: Memory): void {
    this.memories.set(m.id, m);
  }

  getById(id: string): Memory | null {
    return this.memories.get(id) ?? null;
  }

  update(id: string, input: MemoryUpdateInput): Memory | null {
    const m = this.memories.get(id);
    if (!m) return null;

    const updated: Memory = {
      ...m,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    };
    this.memories.set(id, updated);
    return updated;
  }
}

describe('BranchManager', () => {
  const manager = new BranchManager();

  describe('getCurrentBranch', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `ctxcore-branch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns branch name in a git repo', () => {
      execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
      execSync('git commit --allow-empty -m "init"', {
        cwd: tmpDir,
        stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test.com' },
      });

      const branch = manager.getCurrentBranch(tmpDir);
      // Default branch varies (main or master), but should be a string
      expect(branch).toBeTruthy();
      expect(typeof branch).toBe('string');
    });

    it('returns branch name for a feature branch', () => {
      execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
      execSync('git commit --allow-empty -m "init"', {
        cwd: tmpDir,
        stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test.com' },
      });
      execSync('git checkout -b feature/cool-thing', { cwd: tmpDir, stdio: 'pipe' });

      const branch = manager.getCurrentBranch(tmpDir);
      expect(branch).toBe('feature/cool-thing');
    });

    it('returns null for a non-git directory', () => {
      const branch = manager.getCurrentBranch(tmpDir);
      expect(branch).toBeNull();
    });
  });

  describe('tagMemory', () => {
    it('adds branch metadata and tag to a memory', () => {
      const store = new MockStore();
      const mem = makeMemory({ id: 'mem-1', tags: ['existing'] });
      store.addMemory(mem);

      manager.tagMemory('mem-1', 'feature/auth', store as unknown as IMemoryStore);

      const updated = store.getById('mem-1')!;
      expect(updated.metadata.branch).toBe('feature/auth');
      expect(updated.tags).toContain('branch:feature/auth');
      expect(updated.tags).toContain('existing');
    });

    it('does not duplicate branch tag if already present', () => {
      const store = new MockStore();
      const mem = makeMemory({ id: 'mem-2', tags: ['branch:main'] });
      store.addMemory(mem);

      manager.tagMemory('mem-2', 'main', store as unknown as IMemoryStore);

      const updated = store.getById('mem-2')!;
      const branchTags = updated.tags.filter((t) => t === 'branch:main');
      expect(branchTags).toHaveLength(1);
    });

    it('silently ignores non-existent memory', () => {
      const store = new MockStore();
      // Should not throw
      manager.tagMemory('nonexistent', 'main', store as unknown as IMemoryStore);
    });
  });

  describe('filterByBranch', () => {
    it('prioritizes memories matching the branch', () => {
      const memories: Memory[] = [
        makeMemory({ id: 'a', metadata: {}, tags: [] }),
        makeMemory({ id: 'b', metadata: { branch: 'feature/auth' }, tags: ['branch:feature/auth'] }),
        makeMemory({ id: 'c', metadata: {}, tags: [] }),
        makeMemory({ id: 'd', metadata: { branch: 'feature/auth' }, tags: ['branch:feature/auth'] }),
      ];

      const filtered = manager.filterByBranch(memories, 'feature/auth');

      // Branch memories should come first
      expect(filtered[0].id).toBe('b');
      expect(filtered[1].id).toBe('d');
      // Non-branch memories follow
      expect(filtered[2].id).toBe('a');
      expect(filtered[3].id).toBe('c');
      // All memories are included
      expect(filtered).toHaveLength(4);
    });

    it('returns all memories when none match the branch', () => {
      const memories: Memory[] = [
        makeMemory({ id: 'a' }),
        makeMemory({ id: 'b' }),
      ];

      const filtered = manager.filterByBranch(memories, 'feature/xyz');
      expect(filtered).toHaveLength(2);
    });

    it('matches memories by branch tag even without metadata', () => {
      const memories: Memory[] = [
        makeMemory({ id: 'a', tags: ['branch:develop'] }),
        makeMemory({ id: 'b', tags: [] }),
      ];

      const filtered = manager.filterByBranch(memories, 'develop');
      expect(filtered[0].id).toBe('a');
    });

    it('matches memories by metadata branch even without tag', () => {
      const memories: Memory[] = [
        makeMemory({ id: 'a', metadata: { branch: 'develop' }, tags: [] }),
        makeMemory({ id: 'b', tags: [] }),
      ];

      const filtered = manager.filterByBranch(memories, 'develop');
      expect(filtered[0].id).toBe('a');
    });
  });
});
