import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeMdManager } from '../../src/claudemd.js';
import type { IContextBuilder, MemoryTier } from '../../src/types.js';

const START_MARKER = '<!-- ctxcore:start -->';
const END_MARKER = '<!-- ctxcore:end -->';

function createMockContextBuilder(context = '> No memories stored yet.\n'): IContextBuilder {
  return {
    buildContext: (_options?: { maxTokens?: number; tier?: MemoryTier }) => context,
  };
}

describe('ClaudeMdManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctxcore-claudemd-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('patch', () => {
    it('creates CLAUDE.md if missing', () => {
      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      manager.patch(tmpDir);

      const filePath = join(tmpDir, 'CLAUDE.md');
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain(START_MARKER);
      expect(content).toContain(END_MARKER);
    });

    it('inserts markers into existing CLAUDE.md', () => {
      const filePath = join(tmpDir, 'CLAUDE.md');
      writeFileSync(filePath, '# My Project\n\nExisting content here.\n', 'utf-8');

      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      manager.patch(tmpDir);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# My Project');
      expect(content).toContain('Existing content here.');
      expect(content).toContain(START_MARKER);
      expect(content).toContain(END_MARKER);
    });

    it('does not duplicate markers on second patch', () => {
      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      manager.patch(tmpDir);
      manager.patch(tmpDir);

      const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
      const startCount = content.split(START_MARKER).length - 1;
      const endCount = content.split(END_MARKER).length - 1;
      expect(startCount).toBe(1);
      expect(endCount).toBe(1);
    });

    it('includes context from ContextBuilder', () => {
      const builder = createMockContextBuilder('### Key Decisions\n\n- Chose PostgreSQL\n');
      const manager = new ClaudeMdManager(builder);

      manager.patch(tmpDir);

      const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
      expect(content).toContain('Chose PostgreSQL');
    });
  });

  describe('rebuild', () => {
    it('updates content between markers', () => {
      const filePath = join(tmpDir, 'CLAUDE.md');
      const original = `# Project\n\n${START_MARKER}\nOLD CONTENT\n${END_MARKER}\n\n## Footer\n`;
      writeFileSync(filePath, original, 'utf-8');

      const builder = createMockContextBuilder('### Key Decisions\n\n- New decision\n');
      const manager = new ClaudeMdManager(builder);

      manager.rebuild(tmpDir);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('New decision');
      expect(content).not.toContain('OLD CONTENT');
      expect(content).toContain('# Project');
      expect(content).toContain('## Footer');
    });

    it('preserves content outside markers', () => {
      const filePath = join(tmpDir, 'CLAUDE.md');
      const before = '# My Project\n\nImportant stuff.\n\n';
      const after = '\n\n## Other Section\n\nDo not touch.\n';
      writeFileSync(filePath, `${before}${START_MARKER}\nold\n${END_MARKER}${after}`, 'utf-8');

      const builder = createMockContextBuilder('new context\n');
      const manager = new ClaudeMdManager(builder);

      manager.rebuild(tmpDir);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# My Project');
      expect(content).toContain('Important stuff.');
      expect(content).toContain('## Other Section');
      expect(content).toContain('Do not touch.');
      expect(content).toContain('new context');
    });

    it('creates CLAUDE.md via patch if file missing', () => {
      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      manager.rebuild(tmpDir);

      expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(true);
    });

    it('falls back to patch if no markers found', () => {
      const filePath = join(tmpDir, 'CLAUDE.md');
      writeFileSync(filePath, '# No markers here\n', 'utf-8');

      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      manager.rebuild(tmpDir);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain(START_MARKER);
      expect(content).toContain(END_MARKER);
      expect(content).toContain('# No markers here');
    });
  });

  describe('remove', () => {
    it('strips markers and ctxcore section', () => {
      const filePath = join(tmpDir, 'CLAUDE.md');
      writeFileSync(
        filePath,
        `# Project\n\n${START_MARKER}\nctxcore stuff\n${END_MARKER}\n\n## Footer\n`,
        'utf-8',
      );

      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      manager.remove(tmpDir);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).not.toContain(START_MARKER);
      expect(content).not.toContain(END_MARKER);
      expect(content).not.toContain('ctxcore stuff');
      expect(content).toContain('# Project');
      expect(content).toContain('## Footer');
    });

    it('does nothing if CLAUDE.md does not exist', () => {
      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      // Should not throw
      manager.remove(tmpDir);
      expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(false);
    });

    it('does nothing if no markers present', () => {
      const filePath = join(tmpDir, 'CLAUDE.md');
      const original = '# Project\n\nNo ctxcore here.\n';
      writeFileSync(filePath, original, 'utf-8');

      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      manager.remove(tmpDir);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('No ctxcore here.');
    });

    it('does not touch non-ctxcore content', () => {
      const filePath = join(tmpDir, 'CLAUDE.md');
      writeFileSync(
        filePath,
        `# Header\n\nParagraph one.\n\n${START_MARKER}\nremove me\n${END_MARKER}\n\nParagraph two.\n`,
        'utf-8',
      );

      const builder = createMockContextBuilder();
      const manager = new ClaudeMdManager(builder);

      manager.remove(tmpDir);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('# Header');
      expect(content).toContain('Paragraph one.');
      expect(content).toContain('Paragraph two.');
    });
  });
});
