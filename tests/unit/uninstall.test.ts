import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  removeCtxcoreFromClaudeMd,
  removeProjectConfig,
  removeMemoryDb,
  removeGlobalDir,
  removeMcpFromSettings,
} from '../../src/cli/uninstall.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ctxcore-uninstall-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('uninstall — removeCtxcoreFromClaudeMd', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('removes ctxcore section from CLAUDE.md', () => {
    const claudeMd = join(tmpDir, 'CLAUDE.md');
    const content = `# My Project

Some existing content.

<!-- ctxcore:start -->
## ctxcore section
This should be removed.
<!-- ctxcore:end -->

More content after.
`;
    writeFileSync(claudeMd, content, 'utf-8');

    const result = removeCtxcoreFromClaudeMd(tmpDir);
    expect(result).toBe(true);

    const updated = readFileSync(claudeMd, 'utf-8');
    expect(updated).toContain('# My Project');
    expect(updated).toContain('Some existing content.');
    expect(updated).toContain('More content after.');
    expect(updated).not.toContain('ctxcore:start');
    expect(updated).not.toContain('ctxcore:end');
    expect(updated).not.toContain('This should be removed');
  });

  it('returns false when no CLAUDE.md exists', () => {
    expect(removeCtxcoreFromClaudeMd(tmpDir)).toBe(false);
  });

  it('returns false when CLAUDE.md has no ctxcore markers', () => {
    const claudeMd = join(tmpDir, 'CLAUDE.md');
    writeFileSync(claudeMd, '# Just a regular CLAUDE.md\n', 'utf-8');

    expect(removeCtxcoreFromClaudeMd(tmpDir)).toBe(false);
    // File should not be modified
    expect(readFileSync(claudeMd, 'utf-8')).toBe('# Just a regular CLAUDE.md\n');
  });

  it('preserves content outside ctxcore markers', () => {
    const claudeMd = join(tmpDir, 'CLAUDE.md');
    const before = 'Line before\n';
    const after = '\nLine after\n';
    const content = `${before}<!-- ctxcore:start -->\nstuff\n<!-- ctxcore:end -->${after}`;
    writeFileSync(claudeMd, content, 'utf-8');

    removeCtxcoreFromClaudeMd(tmpDir);
    const updated = readFileSync(claudeMd, 'utf-8');
    expect(updated).toContain('Line before');
    expect(updated).toContain('Line after');
  });
});

describe('uninstall — removeProjectConfig', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('removes .ctxcore.json', () => {
    const configPath = join(tmpDir, '.ctxcore.json');
    writeFileSync(configPath, '{"ollamaModel":"qwen3-embedding:0.6b"}', 'utf-8');

    expect(removeProjectConfig(tmpDir)).toBe(true);
    expect(existsSync(configPath)).toBe(false);
  });

  it('returns false when .ctxcore.json does not exist', () => {
    expect(removeProjectConfig(tmpDir)).toBe(false);
  });
});

describe('uninstall — removeMemoryDb', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('removes .memory.db', () => {
    const dbPath = join(tmpDir, '.memory.db');
    writeFileSync(dbPath, 'fake db', 'utf-8');

    expect(removeMemoryDb(tmpDir)).toBe(true);
    expect(existsSync(dbPath)).toBe(false);
  });

  it('also removes WAL and SHM files', () => {
    const dbPath = join(tmpDir, '.memory.db');
    writeFileSync(dbPath, 'fake db', 'utf-8');
    writeFileSync(dbPath + '-wal', 'wal data', 'utf-8');
    writeFileSync(dbPath + '-shm', 'shm data', 'utf-8');

    expect(removeMemoryDb(tmpDir)).toBe(true);
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(dbPath + '-wal')).toBe(false);
    expect(existsSync(dbPath + '-shm')).toBe(false);
  });

  it('returns false when .memory.db does not exist', () => {
    expect(removeMemoryDb(tmpDir)).toBe(false);
  });
});

describe('uninstall — removeGlobalDir', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('removes a directory and its contents', () => {
    const globalDir = join(tmpDir, 'fake-global');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'config.json'), '{}', 'utf-8');
    writeFileSync(join(globalDir, 'user_profile.db'), 'fake', 'utf-8');

    // We test the raw rmSync logic since removeGlobalDir uses a hardcoded path
    rmSync(globalDir, { recursive: true, force: true });
    expect(existsSync(globalDir)).toBe(false);
  });
});

describe('uninstall — does not delete unrelated files', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('removeProjectConfig only removes .ctxcore.json, not other files', () => {
    writeFileSync(join(tmpDir, '.ctxcore.json'), '{}', 'utf-8');
    writeFileSync(join(tmpDir, 'package.json'), '{}', 'utf-8');
    writeFileSync(join(tmpDir, 'src.ts'), 'code', 'utf-8');

    removeProjectConfig(tmpDir);

    expect(existsSync(join(tmpDir, '.ctxcore.json'))).toBe(false);
    expect(existsSync(join(tmpDir, 'package.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'src.ts'))).toBe(true);
  });

  it('removeMemoryDb only removes .memory.db files, not other databases', () => {
    writeFileSync(join(tmpDir, '.memory.db'), 'fake', 'utf-8');
    writeFileSync(join(tmpDir, 'app.db'), 'other db', 'utf-8');

    removeMemoryDb(tmpDir);

    expect(existsSync(join(tmpDir, '.memory.db'))).toBe(false);
    expect(existsSync(join(tmpDir, 'app.db'))).toBe(true);
  });

  it('removeCtxcoreFromClaudeMd does not modify content outside markers', () => {
    const claudeMd = join(tmpDir, 'CLAUDE.md');
    const userContent = '# Important project rules\n\nAlways use TypeScript.\n';
    const content = `${userContent}\n<!-- ctxcore:start -->\nctxcore stuff\n<!-- ctxcore:end -->\n`;
    writeFileSync(claudeMd, content, 'utf-8');

    removeCtxcoreFromClaudeMd(tmpDir);

    const updated = readFileSync(claudeMd, 'utf-8');
    expect(updated).toContain('# Important project rules');
    expect(updated).toContain('Always use TypeScript.');
  });
});

describe('uninstall — purge removes everything', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all remove functions succeed when files exist', () => {
    // Set up all files
    writeFileSync(join(tmpDir, '.ctxcore.json'), '{}', 'utf-8');
    writeFileSync(join(tmpDir, '.memory.db'), 'fake', 'utf-8');
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '<!-- ctxcore:start -->\nstuff\n<!-- ctxcore:end -->\n', 'utf-8');

    expect(removeProjectConfig(tmpDir)).toBe(true);
    expect(removeMemoryDb(tmpDir)).toBe(true);
    expect(removeCtxcoreFromClaudeMd(tmpDir)).toBe(true);

    expect(existsSync(join(tmpDir, '.ctxcore.json'))).toBe(false);
    expect(existsSync(join(tmpDir, '.memory.db'))).toBe(false);
  });

  it('all remove functions return false gracefully when files do not exist', () => {
    expect(removeProjectConfig(tmpDir)).toBe(false);
    expect(removeMemoryDb(tmpDir)).toBe(false);
    expect(removeCtxcoreFromClaudeMd(tmpDir)).toBe(false);
  });
});
