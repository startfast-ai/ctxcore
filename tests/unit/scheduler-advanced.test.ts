import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getLastReflexionTime,
  touchLastReflexion,
  isReflexionStale,
  buildHookBlock,
  insertHookBlock,
  removeHookBlock,
} from '../../src/scheduler.js';

describe('Reflexion timestamp tracking', () => {
  it('touchLastReflexion sets a timestamp that getLastReflexionTime reads', () => {
    touchLastReflexion();
    const time = getLastReflexionTime();
    expect(time).toBeInstanceOf(Date);
    expect(Date.now() - time!.getTime()).toBeLessThan(5000);
  });

  it('isReflexionStale returns true with very small threshold', () => {
    touchLastReflexion();
    // 1ms threshold — by the time we check, at least 1ms has passed
    // Use a small delay to ensure time has passed
    const start = Date.now();
    while (Date.now() - start < 2) { /* spin */ }
    expect(isReflexionStale(1)).toBe(true);
  });

  it('isReflexionStale returns false if recently run', () => {
    touchLastReflexion();
    expect(isReflexionStale(60000)).toBe(false); // 1 minute threshold
  });
});

describe('Git hook blocks', () => {
  it('buildHookBlock creates correct block for post-commit', () => {
    const block = buildHookBlock('post-commit');
    expect(block).toContain('ctxcore reflect');
    expect(block).toContain('>>> ctxcore hooks >>>');
    expect(block).toContain('<<< ctxcore hooks <<<');
  });

  it('buildHookBlock creates correct block for post-merge', () => {
    const block = buildHookBlock('post-merge');
    expect(block).toContain('ctxcore rescan');
    expect(block).toContain('>>> ctxcore hooks >>>');
  });

  it('insertHookBlock creates new hook file content', () => {
    const content = insertHookBlock(null, 'post-commit');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('ctxcore reflect');
  });

  it('insertHookBlock prepends to existing hook', () => {
    const existing = '#!/bin/sh\necho "existing hook"';
    const content = insertHookBlock(existing, 'post-commit');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('ctxcore reflect');
    expect(content).toContain('existing hook');
  });

  it('insertHookBlock replaces existing ctxcore block', () => {
    const existing = '#!/bin/sh\n# >>> ctxcore hooks >>>\nold command\n# <<< ctxcore hooks <<<\necho "keep"';
    const content = insertHookBlock(existing, 'post-merge');
    expect(content).toContain('ctxcore rescan');
    expect(content).not.toContain('old command');
    expect(content).toContain('keep');
  });

  it('removeHookBlock removes ctxcore block', () => {
    const content = '#!/bin/sh\n# >>> ctxcore hooks >>>\ncommand\n# <<< ctxcore hooks <<<\necho "keep"';
    const result = removeHookBlock(content);
    expect(result).not.toContain('>>> ctxcore hooks >>>');
    expect(result).toContain('keep');
  });

  it('removeHookBlock returns null if only ctxcore content', () => {
    const content = '#!/bin/sh\n# >>> ctxcore hooks >>>\ncommand\n# <<< ctxcore hooks <<<';
    const result = removeHookBlock(content);
    expect(result).toBeNull();
  });

  it('removeHookBlock returns content unchanged if no ctxcore block', () => {
    const content = '#!/bin/sh\necho "no ctxcore here"';
    expect(removeHookBlock(content)).toBe(content);
  });
});
