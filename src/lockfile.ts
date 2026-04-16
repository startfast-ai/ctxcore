import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ILockManager } from './types.js';

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const LOCKS_DIR = join(homedir(), '.ctxcore', 'locks');

export interface LockFileContent {
  pid: number;
  timestamp: number;
}

/**
 * Check if a process with the given PID is alive.
 */
export function isPidAlive(pid: number): boolean {
  try {
    // Sending signal 0 checks existence without actually signaling
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class LockManager implements ILockManager {
  private readonly locksDir: string;

  constructor(locksDir?: string) {
    this.locksDir = locksDir ?? LOCKS_DIR;
  }

  private lockPath(name: string): string {
    return join(this.locksDir, `${name}.lock`);
  }

  private ensureDir(): void {
    if (!existsSync(this.locksDir)) {
      mkdirSync(this.locksDir, { recursive: true });
    }
  }

  private readLock(name: string): LockFileContent | null {
    const path = this.lockPath(name);
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, 'utf-8');
      const data = JSON.parse(raw) as LockFileContent;
      if (typeof data.pid !== 'number' || typeof data.timestamp !== 'number') {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  acquire(name: string): boolean {
    this.ensureDir();

    // Check existing lock
    const existing = this.readLock(name);
    if (existing) {
      // If PID is alive and lock is not stale, fail
      if (isPidAlive(existing.pid) && !this.isStale(name)) {
        return false;
      }
      // Clean up stale/dead lock
      this.release(name);
    }

    const content: LockFileContent = {
      pid: process.pid,
      timestamp: Date.now(),
    };

    writeFileSync(this.lockPath(name), JSON.stringify(content), 'utf-8');
    return true;
  }

  release(name: string): void {
    const path = this.lockPath(name);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  isLocked(name: string): boolean {
    const existing = this.readLock(name);
    if (!existing) return false;

    // If PID is dead or lock is stale, it's not really locked
    if (!isPidAlive(existing.pid) || this.isStale(name)) {
      return false;
    }

    return true;
  }

  isStale(name: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
    const existing = this.readLock(name);
    if (!existing) return false;

    const age = Date.now() - existing.timestamp;
    return age > maxAgeMs;
  }
}
