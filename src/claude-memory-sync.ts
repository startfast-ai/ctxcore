import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IMemoryStore, ITaskStore, Task } from './types.js';

/**
 * Claude auto memory integration.
 *
 * Claude Code stores auto memory in ~/.claude/projects/<hashed-path>/memory/
 * where <hashed-path> is the absolute project path with slashes replaced by dashes,
 * prefixed with a dash. e.g. /Users/foo/projects/bar → -Users-foo-projects-bar
 *
 * Files:
 *   MEMORY.md — index file (first 200 lines / 25KB loaded per session)
 *   *.md — topic files referenced from MEMORY.md
 *
 * Ownership rules:
 *   ctxcore-*.md — owned by ctxcore (read + write)
 *   MEMORY.md — owned by Claude (ctxcore only modifies between markers)
 *   all other .md — owned by Claude (read only)
 */

const CTXCORE_MEMORY_START = '<!-- ctxcore:memory-sync:start -->';
const CTXCORE_MEMORY_END = '<!-- ctxcore:memory-sync:end -->';

/**
 * Resolve the Claude auto memory directory for a project.
 * Path is derived from the project root: slashes replaced by dashes, prefixed with dash.
 */
export function resolveAutoMemoryPath(projectRoot: string): string {
  // Normalize: remove trailing slash
  const normalized = projectRoot.replace(/\/+$/, '');
  // Replace all slashes with dashes, prefix with dash
  const hashed = normalized.replace(/\//g, '-');
  return join(homedir(), '.claude', 'projects', hashed, 'memory');
}

/**
 * Import memories from Claude's auto memory directory into ctxcore.
 * Reads all .md files (except ctxcore-owned ones), parses content,
 * stores as memories with source_type: 'claude_auto_memory' metadata.
 * Returns count of imported memories.
 */
export function importFromAutoMemory(store: IMemoryStore, memoryDir: string): number {
  if (!existsSync(memoryDir)) return 0;

  const files = readdirSync(memoryDir).filter(
    (f) => f.endsWith('.md') && !f.startsWith('ctxcore-')
  );

  let imported = 0;

  for (const file of files) {
    const filePath = join(memoryDir, file);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8').trim();
    } catch {
      continue;
    }

    if (!content) continue;

    // Parse markdown into sections
    const sections = parseMarkdownSections(content);

    for (const section of sections) {
      if (!section.content.trim()) continue;

      // Skip ctxcore's own section in MEMORY.md
      if (section.content.includes(CTXCORE_MEMORY_START)) continue;

      // Check for duplicates by searching for similar content
      const existing = store.searchByKeyword(
        section.content.slice(0, 80),
        { limit: 1 }
      );

      // If very similar memory already exists, skip
      if (existing.length > 0 && existing[0].content === section.content) {
        continue;
      }

      const importance = classifyImportance(section.content);
      const tier = importance >= 0.7 ? 'long-term' : importance >= 0.4 ? 'operational' : 'short-term';

      store.create({
        content: section.content,
        tier,
        importance,
        tags: ['auto-memory', file.replace('.md', '')],
        metadata: {
          source_type: 'claude_auto_memory',
          source_file: file,
          imported_at: new Date().toISOString(),
        },
      });

      imported++;
    }
  }

  return imported;
}

/**
 * Export top memories from ctxcore to Claude's auto memory directory.
 * Writes to namespaced files:
 *   ctxcore-knowledge.md — architecture, key decisions (long-term tier)
 *   ctxcore-preferences.md — user preferences
 *   ctxcore-decisions.md — decision memories
 */
export function exportToAutoMemory(store: IMemoryStore, memoryDir: string, taskStore?: ITaskStore): void {
  mkdirSync(memoryDir, { recursive: true });

  // Gather memories by category
  const longTermMemories = store.list({ tier: 'long-term', limit: 50 });
  const operationalMemories = store.list({ tier: 'operational', limit: 30 });
  const allMemories = [...longTermMemories, ...operationalMemories];

  // Categorize
  const knowledge: string[] = [];
  const preferences: string[] = [];
  const decisions: string[] = [];

  for (const m of allMemories) {
    const tags = m.tags.map((t) => t.toLowerCase());
    const content = m.content.toLowerCase();

    if (
      tags.includes('preference') ||
      tags.includes('workflow') ||
      content.includes('prefers') ||
      content.includes('preference')
    ) {
      preferences.push(`- ${m.content}`);
    } else if (
      tags.includes('decision') ||
      tags.includes('adr') ||
      content.includes('decided') ||
      content.includes('decision')
    ) {
      decisions.push(`- ${m.content}`);
    } else {
      knowledge.push(`- ${m.content}`);
    }
  }

  // Write knowledge file
  if (knowledge.length > 0) {
    const knowledgeContent = `# Project Knowledge\n\nKey architecture and technical knowledge managed by ctxcore.\n\n${knowledge.join('\n')}\n`;
    writeFileSync(join(memoryDir, 'ctxcore-knowledge.md'), knowledgeContent, 'utf-8');
  }

  // Write preferences file
  if (preferences.length > 0) {
    const prefsContent = `# User Preferences\n\nWorkflow and coding preferences tracked by ctxcore.\n\n${preferences.join('\n')}\n`;
    writeFileSync(join(memoryDir, 'ctxcore-preferences.md'), prefsContent, 'utf-8');
  }

  // Write decisions file
  if (decisions.length > 0) {
    const decisionsContent = `# Decision Log\n\nKey decisions and their rationale tracked by ctxcore.\n\n${decisions.join('\n')}\n`;
    writeFileSync(join(memoryDir, 'ctxcore-decisions.md'), decisionsContent, 'utf-8');
  }

  // Write active tasks file
  if (taskStore) {
    exportActiveTasks(taskStore, memoryDir);
  }

  // Update the MEMORY.md index
  updateMemoryIndex(memoryDir);
}

/**
 * Export active tasks (not done/archived) to ctxcore-tasks.md in the auto memory directory.
 */
export function exportActiveTasks(taskStore: ITaskStore, memoryDir: string): void {
  // Get tasks that are not done or archived
  const openTasks = taskStore.list({ status: 'open' });
  const inProgressTasks = taskStore.list({ status: 'in-progress' });
  const activeTasks = [...openTasks, ...inProgressTasks];

  if (activeTasks.length === 0) return;

  const formatTask = (t: Task): string => {
    const status = t.status === 'in-progress' ? 'In Progress' : 'Todo';
    const linkedMemories = taskStore.getLinkedMemories(t.id);
    const linkedSpecs = taskStore.getLinkedSpecs(t.id);
    const links: string[] = [];
    if (linkedMemories.length > 0) links.push(`linked to ${linkedMemories.length} memories`);
    if (linkedSpecs.length > 0) links.push(`linked to ${linkedSpecs.length} specs`);
    const linkSuffix = links.length > 0 ? ` — ${links.join(', ')}` : '';
    return `- [${t.priority}] ${t.title} (${status})${linkSuffix}`;
  };

  const lines = activeTasks.map(formatTask);

  const content = `---
name: ctxcore active tasks
description: Current project tasks managed by ctxcore
type: project
---

## Active Tasks

${lines.join('\n')}
`;

  writeFileSync(join(memoryDir, 'ctxcore-tasks.md'), content, 'utf-8');
}

/**
 * Update MEMORY.md with ctxcore section.
 * Only modifies lines between ctxcore markers, never touches other content.
 * If no markers exist, appends the section at the end.
 */
export function updateMemoryIndex(memoryDir: string): void {
  const memoryMdPath = join(memoryDir, 'MEMORY.md');

  let content = '';
  if (existsSync(memoryMdPath)) {
    content = readFileSync(memoryMdPath, 'utf-8');
  }

  // Build ctxcore section — kept small to fit within Claude's 200 line / 25KB budget
  const ctxcoreFiles: string[] = [];
  if (existsSync(join(memoryDir, 'ctxcore-knowledge.md'))) {
    ctxcoreFiles.push('- See ctxcore-knowledge.md for project architecture and key decisions');
  }
  if (existsSync(join(memoryDir, 'ctxcore-preferences.md'))) {
    ctxcoreFiles.push('- See ctxcore-preferences.md for user workflow preferences');
  }
  if (existsSync(join(memoryDir, 'ctxcore-decisions.md'))) {
    ctxcoreFiles.push('- See ctxcore-decisions.md for decision log with rationale');
  }
  if (existsSync(join(memoryDir, 'ctxcore-tasks.md'))) {
    ctxcoreFiles.push('- See ctxcore-tasks.md for active project tasks');
  }

  if (ctxcoreFiles.length === 0) return;

  const ctxcoreSection = [
    CTXCORE_MEMORY_START,
    '## ctxcore Knowledge Base',
    ...ctxcoreFiles,
    CTXCORE_MEMORY_END,
  ].join('\n');

  const startIdx = content.indexOf(CTXCORE_MEMORY_START);
  const endIdx = content.indexOf(CTXCORE_MEMORY_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx + CTXCORE_MEMORY_END.length);
    content = before + ctxcoreSection + after;
  } else {
    // Append new section
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n\n' : content.length > 0 ? '\n' : '';
    content = content + separator + ctxcoreSection + '\n';
  }

  writeFileSync(memoryMdPath, content, 'utf-8');
}

// ── Helpers ──

interface MarkdownSection {
  heading: string;
  content: string;
}

function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split('\n');
  const sections: MarkdownSection[] = [];
  let currentHeading = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.match(/^#{1,3}\s+/)) {
      // Save previous section
      if (currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join('\n').trim(),
        });
      }
      currentHeading = line.replace(/^#{1,3}\s+/, '').trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join('\n').trim(),
    });
  }

  // If no headings found, treat entire content as one section
  if (sections.length === 0 && markdown.trim()) {
    sections.push({ heading: '', content: markdown.trim() });
  }

  return sections;
}

function classifyImportance(content: string): number {
  const lower = content.toLowerCase();

  // High importance signals
  if (
    lower.includes('architecture') ||
    lower.includes('critical') ||
    lower.includes('security') ||
    lower.includes('decision') ||
    lower.includes('adr') ||
    lower.includes('never') ||
    lower.includes('always')
  ) {
    return 0.8;
  }

  // Medium importance
  if (
    lower.includes('convention') ||
    lower.includes('pattern') ||
    lower.includes('prefer') ||
    lower.includes('important') ||
    lower.includes('config')
  ) {
    return 0.6;
  }

  // Default
  return 0.4;
}
