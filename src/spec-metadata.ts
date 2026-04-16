import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SpecMetadata, SpecVersion, SpecComment, SpecStatus } from './types.js';

export class MetadataStore {
  private readonly metaDir: string;

  constructor(specsDir: string) {
    this.metaDir = join(specsDir, '.meta');
    if (!existsSync(this.metaDir)) {
      mkdirSync(this.metaDir, { recursive: true });
    }
  }

  read(specId: string): SpecMetadata | null {
    const filePath = join(this.metaDir, `${specId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      return this.deserialize(raw);
    } catch {
      return null;
    }
  }

  write(specId: string, metadata: SpecMetadata): void {
    const filePath = join(this.metaDir, `${specId}.json`);
    writeFileSync(filePath, JSON.stringify(this.serialize(metadata), null, 2));
  }

  addVersion(specId: string, version: SpecVersion): void {
    const meta = this.read(specId);
    if (!meta) return;
    meta.versions.push(version);
    meta.updatedAt = new Date();
    this.write(specId, meta);
  }

  addComment(specId: string, comment: Omit<SpecComment, 'id' | 'createdAt'>): SpecComment {
    const meta = this.read(specId);
    if (!meta) throw new Error(`Spec not found: ${specId}`);

    const full: SpecComment = {
      id: randomUUID(),
      ...comment,
      createdAt: new Date(),
    };
    meta.comments.push(full);
    meta.updatedAt = new Date();
    this.write(specId, meta);
    return full;
  }

  list(): SpecMetadata[] {
    if (!existsSync(this.metaDir)) return [];
    const files = readdirSync(this.metaDir).filter((f) => f.endsWith('.json'));
    const results: SpecMetadata[] = [];
    for (const file of files) {
      const id = file.replace(/\.json$/, '');
      const meta = this.read(id);
      if (meta) results.push(meta);
    }
    return results;
  }

  private serialize(meta: SpecMetadata): Record<string, unknown> {
    return {
      ...meta,
      createdAt: meta.createdAt.toISOString(),
      updatedAt: meta.updatedAt.toISOString(),
      comments: meta.comments.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
      versions: meta.versions.map((v) => ({
        ...v,
        timestamp: v.timestamp.toISOString(),
      })),
    };
  }

  private deserialize(raw: Record<string, unknown>): SpecMetadata {
    const data = raw as Record<string, unknown>;
    return {
      id: data.id as string,
      title: data.title as string,
      status: data.status as SpecStatus,
      createdBy: data.createdBy as string,
      createdAt: new Date(data.createdAt as string),
      updatedAt: new Date(data.updatedAt as string),
      tags: (data.tags as string[]) ?? [],
      linkedTasks: (data.linkedTasks as string[]) ?? [],
      linkedMemories: (data.linkedMemories as string[]) ?? [],
      comments: ((data.comments as Array<Record<string, unknown>>) ?? []).map((c) => ({
        id: c.id as string,
        author: c.author as string,
        authorType: c.authorType as 'human' | 'ai',
        content: c.content as string,
        target: c.target as string | undefined,
        createdAt: new Date(c.createdAt as string),
      })),
      versions: ((data.versions as Array<Record<string, unknown>>) ?? []).map((v) => ({
        version: v.version as number,
        timestamp: new Date(v.timestamp as string),
        author: v.author as string,
        summary: v.summary as string,
        gitCommit: v.gitCommit as string | undefined,
      })),
    };
  }
}
