import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ISpecStore,
  Spec,
  SpecCreateInput,
  SpecUpdateInput,
  SpecComment,
  SpecVersion,
  SpecListOptions,
  SpecMetadata,
  SpecStatus,
} from './types.js';
import { MetadataStore } from './spec-metadata.js';

/**
 * Generate a URL-safe slug from a title.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Parse simple YAML-like frontmatter between --- delimiters.
 * Handles key: value pairs and arrays in [a, b] format.
 */
export function parseFrontmatter(raw: string): { attrs: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { attrs: {}, body: raw };

  const frontmatterBlock = match[1];
  const body = match[2];
  const attrs: Record<string, unknown> = {};

  for (const line of frontmatterBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: string | string[] = line.slice(colonIdx + 1).trim();

    // Parse arrays: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (inner === '') {
        attrs[key] = [];
      } else {
        attrs[key] = inner.split(',').map((s) => s.trim());
      }
    } else {
      attrs[key] = value;
    }
  }

  return { attrs, body };
}

/**
 * Serialize frontmatter attributes + body into a markdown string with YAML frontmatter.
 */
export function serializeFrontmatter(attrs: Record<string, unknown>, body: string): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function dateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class SpecStore implements ISpecStore {
  private readonly specsDir: string;
  private readonly metadataStore: MetadataStore;

  constructor(projectRoot: string) {
    this.specsDir = join(projectRoot, '.ctxcore', 'specs');
    if (!existsSync(this.specsDir)) {
      mkdirSync(this.specsDir, { recursive: true });
    }
    this.metadataStore = new MetadataStore(this.specsDir);
  }

  create(input: SpecCreateInput): Spec {
    const slug = slugify(input.title);
    const now = new Date();
    const status: SpecStatus = input.status ?? 'draft';
    const tags = input.tags ?? [];
    const content = input.content ?? '';

    const filePath = join(this.specsDir, `${slug}.md`);

    // Build markdown with frontmatter
    const attrs: Record<string, unknown> = {
      title: input.title,
      status,
      tags,
      created: dateString(now),
      author: 'human',
    };
    const body = `\n# ${input.title}\n\n${content}\n`;
    const markdown = serializeFrontmatter(attrs, body);

    writeFileSync(filePath, markdown);

    // Build metadata
    const meta: SpecMetadata = {
      id: slug,
      title: input.title,
      status,
      createdBy: 'human',
      createdAt: now,
      updatedAt: now,
      tags,
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
    this.metadataStore.write(slug, meta);

    return {
      id: slug,
      title: input.title,
      status,
      content,
      filePath,
      tags,
      createdBy: 'human',
      createdAt: now,
      updatedAt: now,
    };
  }

  getById(id: string): Spec | null {
    const meta = this.metadataStore.read(id);
    if (!meta) return null;

    const filePath = join(this.specsDir, `${id}.md`);
    if (!existsSync(filePath)) return null;

    const raw = readFileSync(filePath, 'utf-8');
    const { attrs, body } = parseFrontmatter(raw);

    // Extract content from body (strip the heading line)
    const content = this.extractContent(body);

    return {
      id: meta.id,
      title: meta.title,
      status: (attrs.status as SpecStatus) ?? meta.status,
      content,
      filePath,
      tags: meta.tags,
      createdBy: meta.createdBy,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }

  list(options?: SpecListOptions): Spec[] {
    const allMeta = this.metadataStore.list();
    let filtered = allMeta;

    if (options?.status) {
      filtered = filtered.filter((m) => m.status === options.status);
    }
    if (options?.tags && options.tags.length > 0) {
      const requiredTags = options.tags;
      filtered = filtered.filter((m) => requiredTags.some((t) => m.tags.includes(t)));
    }

    return filtered
      .map((m) => this.getById(m.id))
      .filter((s): s is Spec => s !== null);
  }

  update(id: string, input: SpecUpdateInput, summary?: string): Spec | null {
    const meta = this.metadataStore.read(id);
    if (!meta) return null;

    const filePath = join(this.specsDir, `${id}.md`);
    if (!existsSync(filePath)) return null;

    const now = new Date();

    // Update metadata fields
    if (input.status !== undefined) meta.status = input.status;
    if (input.tags !== undefined) meta.tags = input.tags;
    meta.updatedAt = now;

    // Read current file and update
    const raw = readFileSync(filePath, 'utf-8');
    const { attrs, body } = parseFrontmatter(raw);

    const newAttrs = { ...attrs };
    if (input.status !== undefined) newAttrs.status = input.status;
    if (input.tags !== undefined) newAttrs.tags = input.tags;

    let newBody = body;
    if (input.content !== undefined) {
      newBody = `\n# ${meta.title}\n\n${input.content}\n`;
    }

    writeFileSync(filePath, serializeFrontmatter(newAttrs, newBody));

    // Add version
    const nextVersion = meta.versions.length + 1;
    const version: SpecVersion = {
      version: nextVersion,
      timestamp: now,
      author: 'human',
      summary: summary ?? 'Updated spec',
    };
    meta.versions.push(version);
    this.metadataStore.write(id, meta);

    return this.getById(id);
  }

  addComment(id: string, comment: Omit<SpecComment, 'id' | 'createdAt'>): SpecComment {
    return this.metadataStore.addComment(id, comment);
  }

  getVersions(id: string): SpecVersion[] {
    const meta = this.metadataStore.read(id);
    if (!meta) return [];
    return meta.versions;
  }

  restore(_id: string, _version: number): Spec | null {
    // Placeholder: would need git integration to restore historical versions
    return null;
  }

  private extractContent(body: string): string {
    // Strip leading whitespace, the heading line, and trailing whitespace
    const lines = body.split('\n');
    const contentLines: string[] = [];
    let pastHeading = false;
    for (const line of lines) {
      if (!pastHeading) {
        if (line.trim() === '' || line.startsWith('# ')) {
          if (line.startsWith('# ')) pastHeading = true;
          continue;
        }
        pastHeading = true;
      }
      if (pastHeading) {
        contentLines.push(line);
      }
    }
    // Trim trailing empty lines
    while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === '') {
      contentLines.pop();
    }
    // Trim leading empty lines
    while (contentLines.length > 0 && contentLines[0].trim() === '') {
      contentLines.shift();
    }
    return contentLines.join('\n');
  }
}
