import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LockManager, isPidAlive } from '../../src/lockfile.js';

describe('isPidAlive', () => {
  it('returns true for current process PID', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for obviously dead PID', () => {
    // PID 999999999 is extremely unlikely to exist
    expect(isPidAlive(999999999)).toBe(false);
  });
});

describe('LockManager', () => {
  let tmpDir: string;
  let manager: LockManager;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ctxcore-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    manager = new LockManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('acquire', () => {
    it('acquires a lock successfully', () => {
      expect(manager.acquire('reflexion')).toBe(true);
    });

    it('creates a lock file with PID and timestamp', () => {
      manager.acquire('reflexion');
      const lockPath = join(tmpDir, 'reflexion.lock');
      expect(existsSync(lockPath)).toBe(true);

      const content = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(content.pid).toBe(process.pid);
      expect(typeof content.timestamp).toBe('number');
      expect(content.timestamp).toBeGreaterThan(0);
    });

    it('fails to acquire an already-held lock', () => {
      expect(manager.acquire('reflexion')).toBe(true);
      expect(manager.acquire('reflexion')).toBe(false);
    });

    it('acquires different named locks independently', () => {
      expect(manager.acquire('reflexion')).toBe(true);
      expect(manager.acquire('decay')).toBe(true);
    });
  });

  describe('release', () => {
    it('releases a held lock', () => {
      manager.acquire('reflexion');
      manager.release('reflexion');
      expect(existsSync(join(tmpDir, 'reflexion.lock'))).toBe(false);
    });

    it('does not throw when releasing a non-existent lock', () => {
      expect(() => manager.release('nonexistent')).not.toThrow();
    });

    it('allows re-acquisition after release', () => {
      manager.acquire('reflexion');
      manager.release('reflexion');
      expect(manager.acquire('reflexion')).toBe(true);
    });
  });

  describe('isLocked', () => {
    it('returns true for held lock', () => {
      manager.acquire('reflexion');
      expect(manager.isLocked('reflexion')).toBe(true);
    });

    it('returns false for released lock', () => {
      manager.acquire('reflexion');
      manager.release('reflexion');
      expect(manager.isLocked('reflexion')).toBe(false);
    });

    it('returns false for non-existent lock', () => {
      expect(manager.isLocked('nonexistent')).toBe(false);
    });
  });

  describe('isStale', () => {
    it('returns false for a fresh lock', () => {
      manager.acquire('reflexion');
      expect(manager.isStale('reflexion')).toBe(false);
    });

    it('returns false for non-existent lock', () => {
      expect(manager.isStale('nonexistent')).toBe(false);
    });

    it('returns true when lock exceeds max age', () => {
      // Manually write a lock with a timestamp 5 seconds ago
      const lockPath = join(tmpDir, 'reflexion.lock');
      const { writeFileSync } = require('node:fs');
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() - 5000 }), 'utf-8');
      // maxAge of 1ms — lock is 5s old, so it's stale
      expect(manager.isStale('reflexion', 1)).toBe(true);
    });

    it('returns false when lock is within max age', () => {
      manager.acquire('reflexion');
      // 1 hour max age — should not be stale
      expect(manager.isStale('reflexion', 60 * 60 * 1000)).toBe(false);
    });
  });

  describe('dead PID cleanup', () => {
    it('acquires lock when existing lock has dead PID', () => {
      // Manually write a lock file with a dead PID
      const lockPath = join(tmpDir, 'reflexion.lock');
      const fakeLock = { pid: 999999999, timestamp: Date.now() };
      const { writeFileSync } = require('node:fs');
      writeFileSync(lockPath, JSON.stringify(fakeLock), 'utf-8');

      // Should succeed because the PID is dead
      expect(manager.acquire('reflexion')).toBe(true);
    });

    it('isLocked returns false when PID is dead', () => {
      const lockPath = join(tmpDir, 'reflexion.lock');
      const fakeLock = { pid: 999999999, timestamp: Date.now() };
      const { writeFileSync } = require('node:fs');
      writeFileSync(lockPath, JSON.stringify(fakeLock), 'utf-8');

      expect(manager.isLocked('reflexion')).toBe(false);
    });
  });

  describe('stale lock cleanup', () => {
    it('acquires lock when existing lock is stale', () => {
      // Manually write a stale lock (timestamp 20 minutes ago, our PID so it looks alive)
      const lockPath = join(tmpDir, 'reflexion.lock');
      const staleLock = { pid: process.pid, timestamp: Date.now() - 20 * 60 * 1000 };
      const { writeFileSync } = require('node:fs');
      writeFileSync(lockPath, JSON.stringify(staleLock), 'utf-8');

      // Should succeed because the lock is stale (default 10 min)
      expect(manager.acquire('reflexion')).toBe(true);
    });
  });

  describe('concurrent acquire', () => {
    it('only one acquire succeeds for the same lock name', () => {
      const results = [manager.acquire('reflexion'), manager.acquire('reflexion')];
      const successes = results.filter(Boolean);
      expect(successes).toHaveLength(1);
    });
  });

  describe('corrupted lock file', () => {
    it('treats corrupted lock file as unlocked', () => {
      const lockPath = join(tmpDir, 'reflexion.lock');
      const { writeFileSync } = require('node:fs');
      writeFileSync(lockPath, 'not valid json!!!', 'utf-8');

      expect(manager.isLocked('reflexion')).toBe(false);
      expect(manager.acquire('reflexion')).toBe(true);
    });
  });
});
