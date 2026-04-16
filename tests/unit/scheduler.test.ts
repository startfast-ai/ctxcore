import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildCronEntry,
  parseCronEntry,
  removeCronEntries,
  buildHookBlock,
  insertHookBlock,
  removeHookBlock,
  Scheduler,
} from '../../src/scheduler.js';

// ── Crontab entry generation & parsing ──

describe('buildCronEntry', () => {
  it('generates a crontab line with marker comment', () => {
    const entry = buildCronEntry('0 2 * * *', 'ctxcore reflect --consolidate --auto');
    expect(entry).toBe('0 2 * * * ctxcore reflect --consolidate --auto # ctxcore');
  });

  it('handles different schedules', () => {
    const entry = buildCronEntry('*/15 * * * *', '/usr/local/bin/ctxcore reflect');
    expect(entry).toBe('*/15 * * * * /usr/local/bin/ctxcore reflect # ctxcore');
  });
});

describe('parseCronEntry', () => {
  it('parses a ctxcore crontab entry', () => {
    const lines = [
      '0 * * * * some-other-job',
      '0 2 * * * ctxcore reflect --consolidate --auto # ctxcore',
      '',
    ];
    const status = parseCronEntry(lines);
    expect(status).not.toBeNull();
    expect(status!.schedule).toBe('0 2 * * *');
    expect(status!.command).toBe('ctxcore reflect --consolidate --auto');
    // lastRun reflects the global last-reflexion timestamp (may be non-null on dev machines)
    expect(status!.lastRun === null || status!.lastRun instanceof Date).toBe(true);
    expect(status!.nextRun).toBeNull();
  });

  it('returns null when no ctxcore entry exists', () => {
    const lines = ['0 * * * * some-other-job', ''];
    expect(parseCronEntry(lines)).toBeNull();
  });

  it('ignores commented-out ctxcore entries', () => {
    const lines = ['# 0 2 * * * ctxcore reflect # ctxcore'];
    expect(parseCronEntry(lines)).toBeNull();
  });

  it('handles empty crontab', () => {
    expect(parseCronEntry([])).toBeNull();
  });
});

describe('removeCronEntries', () => {
  it('removes only ctxcore entries', () => {
    const lines = [
      '0 * * * * some-other-job',
      '0 2 * * * ctxcore reflect --consolidate --auto # ctxcore',
      '',
    ];
    const cleaned = removeCronEntries(lines);
    expect(cleaned).toEqual(['0 * * * * some-other-job', '']);
  });

  it('preserves non-ctxcore entries', () => {
    const lines = ['0 * * * * backup', '30 3 * * * cleanup'];
    const cleaned = removeCronEntries(lines);
    expect(cleaned).toEqual(lines);
  });
});

// ── Git hook script generation ──

describe('buildHookBlock', () => {
  it('generates post-commit block with reflect command', () => {
    const block = buildHookBlock('post-commit');
    expect(block).toContain('# >>> ctxcore hooks >>>');
    expect(block).toContain('ctxcore reflect --consolidate --auto');
    expect(block).toContain('# <<< ctxcore hooks <<<');
  });

  it('generates post-merge block with rescan command', () => {
    const block = buildHookBlock('post-merge');
    expect(block).toContain('# >>> ctxcore hooks >>>');
    expect(block).toContain('ctxcore rescan --incremental');
    expect(block).toContain('# <<< ctxcore hooks <<<');
  });
});

describe('insertHookBlock', () => {
  it('creates a new hook script with shebang when content is null', () => {
    const result = insertHookBlock(null, 'post-commit');
    expect(result).toMatch(/^#!\/bin\/sh\n/);
    expect(result).toContain('ctxcore reflect --consolidate --auto');
  });

  it('creates a new hook script when content is empty', () => {
    const result = insertHookBlock('', 'post-merge');
    expect(result).toMatch(/^#!\/bin\/sh\n/);
    expect(result).toContain('ctxcore rescan --incremental');
  });

  it('prepends after shebang in existing hook', () => {
    const existing = '#!/bin/sh\necho "existing hook"';
    const result = insertHookBlock(existing, 'post-commit');
    // Shebang should still be first
    expect(result.startsWith('#!/bin/sh\n')).toBe(true);
    // ctxcore block should come before existing content
    const ctxcoreIdx = result.indexOf('# >>> ctxcore hooks >>>');
    const existingIdx = result.indexOf('echo "existing hook"');
    expect(ctxcoreIdx).toBeLessThan(existingIdx);
  });

  it('replaces existing ctxcore block', () => {
    const existing = '#!/bin/sh\n# >>> ctxcore hooks >>>\nold command\n# <<< ctxcore hooks <<<\necho "keep"';
    const result = insertHookBlock(existing, 'post-commit');
    expect(result).toContain('ctxcore reflect --consolidate --auto');
    expect(result).not.toContain('old command');
    expect(result).toContain('echo "keep"');
  });

  it('prepends before content without shebang', () => {
    const existing = 'echo "no shebang"';
    const result = insertHookBlock(existing, 'post-merge');
    const ctxcoreIdx = result.indexOf('# >>> ctxcore hooks >>>');
    const existingIdx = result.indexOf('echo "no shebang"');
    expect(ctxcoreIdx).toBeLessThan(existingIdx);
  });
});

describe('removeHookBlock', () => {
  it('removes ctxcore block from hook content', () => {
    const content = '#!/bin/sh\n# >>> ctxcore hooks >>>\nctxcore reflect\n# <<< ctxcore hooks <<<\necho "keep"';
    const result = removeHookBlock(content);
    expect(result).not.toContain('ctxcore hooks');
    expect(result).toContain('echo "keep"');
  });

  it('returns null when only ctxcore content plus shebang remain', () => {
    const content = '#!/bin/sh\n# >>> ctxcore hooks >>>\nctxcore reflect\n# <<< ctxcore hooks <<<';
    const result = removeHookBlock(content);
    expect(result).toBeNull();
  });

  it('returns content unchanged when no ctxcore block present', () => {
    const content = '#!/bin/sh\necho "hello"';
    const result = removeHookBlock(content);
    expect(result).toBe(content);
  });
});

// ── Scheduler git hook integration (uses temp dirs) ──

describe('Scheduler — git hooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ctxcore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installs post-commit and post-merge hooks', () => {
    const scheduler = new Scheduler();
    scheduler.installGitHooks(tmpDir);

    const postCommit = readFileSync(join(tmpDir, '.git', 'hooks', 'post-commit'), 'utf-8');
    const postMerge = readFileSync(join(tmpDir, '.git', 'hooks', 'post-merge'), 'utf-8');

    expect(postCommit).toContain('ctxcore reflect --consolidate --auto');
    expect(postMerge).toContain('ctxcore rescan --incremental');
  });

  it('preserves existing hook content', () => {
    const hookPath = join(tmpDir, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "existing"', 'utf-8');

    const scheduler = new Scheduler();
    scheduler.installGitHooks(tmpDir);

    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('echo "existing"');
    expect(content).toContain('ctxcore reflect --consolidate --auto');
  });

  it('removes hooks cleanly', () => {
    const scheduler = new Scheduler();
    scheduler.installGitHooks(tmpDir);
    scheduler.removeGitHooks(tmpDir);

    // Hooks that were ctxcore-only should be removed
    expect(existsSync(join(tmpDir, '.git', 'hooks', 'post-commit'))).toBe(false);
    expect(existsSync(join(tmpDir, '.git', 'hooks', 'post-merge'))).toBe(false);
  });

  it('preserves non-ctxcore content when removing hooks', () => {
    const hookPath = join(tmpDir, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "keep me"', 'utf-8');

    const scheduler = new Scheduler();
    scheduler.installGitHooks(tmpDir);
    scheduler.removeGitHooks(tmpDir);

    expect(existsSync(hookPath)).toBe(true);
    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('echo "keep me"');
    expect(content).not.toContain('ctxcore hooks');
  });

  it('throws when not a git repository', () => {
    const nonGitDir = join(tmpdir(), `ctxcore-nogit-${Date.now()}`);
    mkdirSync(nonGitDir, { recursive: true });
    const scheduler = new Scheduler();

    expect(() => scheduler.installGitHooks(nonGitDir)).toThrow('Not a git repository');

    rmSync(nonGitDir, { recursive: true, force: true });
  });

  it('is idempotent — running install twice does not duplicate content', () => {
    const scheduler = new Scheduler();
    scheduler.installGitHooks(tmpDir);
    scheduler.installGitHooks(tmpDir);

    const content = readFileSync(join(tmpDir, '.git', 'hooks', 'post-commit'), 'utf-8');
    const matches = content.match(/# >>> ctxcore hooks >>>/g);
    expect(matches).toHaveLength(1);
  });
});
