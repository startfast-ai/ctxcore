import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IClaudeMdManager, IContextBuilder } from './types.js';

const START_MARKER = '<!-- ctxcore:start -->';
const END_MARKER = '<!-- ctxcore:end -->';

function getTemplatePath(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // In dev: src/ -> templates/; in dist: dist/src/ -> templates/
  let templatePath = join(thisDir, '..', 'templates', 'claude-md-patch.md');
  if (!existsSync(templatePath)) {
    templatePath = join(thisDir, '..', '..', 'templates', 'claude-md-patch.md');
  }
  return templatePath;
}

/**
 * Manages the ctxcore section inside CLAUDE.md files.
 * Never modifies content outside the sentinel markers.
 */
export class ClaudeMdManager implements IClaudeMdManager {
  constructor(private contextBuilder: IContextBuilder) {}

  patch(projectRoot: string): void {
    const filePath = join(projectRoot, 'CLAUDE.md');
    let existing = '';

    if (existsSync(filePath)) {
      existing = readFileSync(filePath, 'utf-8');
    }

    // If markers already exist, do a rebuild instead
    if (existing.includes(START_MARKER) && existing.includes(END_MARKER)) {
      this.rebuild(projectRoot);
      return;
    }

    const section = this.buildSection();

    // Append the section to the end
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : existing.length > 0 ? '\n' : '';
    const content = existing + separator + section;
    writeFileSync(filePath, content, 'utf-8');
  }

  rebuild(projectRoot: string): void {
    const filePath = join(projectRoot, 'CLAUDE.md');

    if (!existsSync(filePath)) {
      // If CLAUDE.md doesn't exist, just patch (creates it)
      this.patch(projectRoot);
      return;
    }

    const existing = readFileSync(filePath, 'utf-8');
    const startIdx = existing.indexOf(START_MARKER);
    const endIdx = existing.indexOf(END_MARKER);

    if (startIdx === -1 || endIdx === -1) {
      // No markers found, do a full patch
      this.patch(projectRoot);
      return;
    }

    const before = existing.substring(0, startIdx);
    const after = existing.substring(endIdx + END_MARKER.length);
    const section = this.buildSection();

    writeFileSync(filePath, before + section + after, 'utf-8');
  }

  remove(projectRoot: string): void {
    const filePath = join(projectRoot, 'CLAUDE.md');

    if (!existsSync(filePath)) return;

    const existing = readFileSync(filePath, 'utf-8');
    const startIdx = existing.indexOf(START_MARKER);
    const endIdx = existing.indexOf(END_MARKER);

    if (startIdx === -1 || endIdx === -1) return;

    const before = existing.substring(0, startIdx);
    const after = existing.substring(endIdx + END_MARKER.length);

    // Clean up extra blank lines at the join point
    const result = (before + after).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    writeFileSync(filePath, result, 'utf-8');
  }

  private buildSection(): string {
    let template: string;
    try {
      template = readFileSync(getTemplatePath(), 'utf-8');
    } catch {
      // Fallback if template file not found
      template = '## ctxcore — Project Memory\n\nUse memory_search, memory_store, memory_decide, and memory_context tools.\n\n### Current project context\n\n';
    }

    const context = this.contextBuilder.buildContext();

    return `${START_MARKER}\n${template}${context}\n${END_MARKER}`;
  }
}
