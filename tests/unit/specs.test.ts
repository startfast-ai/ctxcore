import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore, slugify, parseFrontmatter, serializeFrontmatter } from '../../src/specs.js';

describe('SpecStore', () => {
  let tmpDir: string;
  let store: SpecStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctxcore-specs-'));
    store = new SpecStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('slugify', () => {
    it('converts title to lowercase slug', () => {
      expect(slugify('Auth System Redesign')).toBe('auth-system-redesign');
    });

    it('strips special characters', () => {
      expect(slugify('Hello, World! #1')).toBe('hello-world-1');
    });

    it('collapses multiple dashes', () => {
      expect(slugify('A  --  B')).toBe('a-b');
    });

    it('trims leading/trailing dashes', () => {
      expect(slugify('--leading-trailing--')).toBe('leading-trailing');
    });

    it('truncates to 80 characters', () => {
      const long = 'a'.repeat(100);
      expect(slugify(long).length).toBeLessThanOrEqual(80);
    });
  });

  describe('parseFrontmatter', () => {
    it('parses key-value pairs', () => {
      const md = '---\ntitle: My Spec\nstatus: draft\n---\nBody text';
      const { attrs, body } = parseFrontmatter(md);
      expect(attrs.title).toBe('My Spec');
      expect(attrs.status).toBe('draft');
      expect(body).toBe('Body text');
    });

    it('parses array values', () => {
      const md = '---\ntags: [auth, security]\n---\nBody';
      const { attrs } = parseFrontmatter(md);
      expect(attrs.tags).toEqual(['auth', 'security']);
    });

    it('parses empty arrays', () => {
      const md = '---\ntags: []\n---\nBody';
      const { attrs } = parseFrontmatter(md);
      expect(attrs.tags).toEqual([]);
    });

    it('returns raw content when no frontmatter', () => {
      const md = 'Just some text';
      const { attrs, body } = parseFrontmatter(md);
      expect(attrs).toEqual({});
      expect(body).toBe('Just some text');
    });
  });

  describe('serializeFrontmatter', () => {
    it('serializes attrs and body', () => {
      const result = serializeFrontmatter({ title: 'Test', status: 'draft' }, '\nContent');
      expect(result).toContain('---');
      expect(result).toContain('title: Test');
      expect(result).toContain('status: draft');
      expect(result).toContain('Content');
    });

    it('serializes arrays', () => {
      const result = serializeFrontmatter({ tags: ['a', 'b'] }, '');
      expect(result).toContain('tags: [a, b]');
    });
  });

  describe('create', () => {
    it('creates .md and .meta files', () => {
      const spec = store.create({ title: 'Auth System Redesign' });

      expect(spec.id).toBe('auth-system-redesign');
      expect(spec.title).toBe('Auth System Redesign');
      expect(spec.status).toBe('draft');
      expect(spec.tags).toEqual([]);
      expect(spec.createdBy).toBe('human');
      expect(spec.createdAt).toBeInstanceOf(Date);
      expect(spec.updatedAt).toBeInstanceOf(Date);

      // Verify .md file exists
      const mdPath = join(tmpDir, '.ctxcore', 'specs', 'auth-system-redesign.md');
      expect(existsSync(mdPath)).toBe(true);

      // Verify .meta file exists
      const metaPath = join(tmpDir, '.ctxcore', 'specs', '.meta', 'auth-system-redesign.json');
      expect(existsSync(metaPath)).toBe(true);

      // Verify frontmatter in .md
      const content = readFileSync(mdPath, 'utf-8');
      expect(content).toContain('title: Auth System Redesign');
      expect(content).toContain('status: draft');
    });

    it('creates spec with custom content and tags', () => {
      const spec = store.create({
        title: 'API Design',
        content: 'REST vs GraphQL analysis',
        tags: ['api', 'design'],
        status: 'in-review',
      });

      expect(spec.content).toBe('REST vs GraphQL analysis');
      expect(spec.tags).toEqual(['api', 'design']);
      expect(spec.status).toBe('in-review');
    });

    it('creates initial version in metadata', () => {
      const spec = store.create({ title: 'Test Spec' });
      const versions = store.getVersions(spec.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
      expect(versions[0].summary).toBe('Initial creation');
    });
  });

  describe('getById', () => {
    it('returns null for non-existent spec', () => {
      expect(store.getById('non-existent')).toBeNull();
    });

    it('returns the spec by id', () => {
      const created = store.create({
        title: 'Read Test',
        content: 'Some content here',
        tags: ['test'],
      });

      const found = store.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Read Test');
      expect(found!.content).toBe('Some content here');
      expect(found!.tags).toEqual(['test']);
    });
  });

  describe('update', () => {
    it('updates content and creates a new version', () => {
      const spec = store.create({ title: 'Update Test', content: 'Original' });

      const updated = store.update(spec.id, { content: 'Updated content' }, 'Changed content');
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe('Updated content');

      const versions = store.getVersions(spec.id);
      expect(versions).toHaveLength(2);
      expect(versions[1].summary).toBe('Changed content');
    });

    it('updates status', () => {
      const spec = store.create({ title: 'Status Test' });

      const updated = store.update(spec.id, { status: 'approved' });
      expect(updated!.status).toBe('approved');
    });

    it('updates tags', () => {
      const spec = store.create({ title: 'Tags Test', tags: ['old'] });

      const updated = store.update(spec.id, { tags: ['new', 'tags'] });
      expect(updated!.tags).toEqual(['new', 'tags']);
    });

    it('returns null for non-existent spec', () => {
      expect(store.update('non-existent', { content: 'x' })).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all specs', () => {
      store.create({ title: 'Spec A' });
      store.create({ title: 'Spec B' });

      const all = store.list();
      expect(all).toHaveLength(2);
    });

    it('filters by status', () => {
      store.create({ title: 'Draft', status: 'draft' });
      store.create({ title: 'Approved', status: 'approved' });

      const drafts = store.list({ status: 'draft' });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].title).toBe('Draft');
    });

    it('filters by tags', () => {
      store.create({ title: 'Tagged', tags: ['auth'] });
      store.create({ title: 'Untagged' });

      const filtered = store.list({ tags: ['auth'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Tagged');
    });
  });

  describe('addComment', () => {
    it('adds a comment to a spec', () => {
      const spec = store.create({ title: 'Comment Test' });

      const comment = store.addComment(spec.id, {
        author: 'alice',
        authorType: 'human',
        content: 'Looks good!',
      });

      expect(comment.id).toBeDefined();
      expect(comment.author).toBe('alice');
      expect(comment.content).toBe('Looks good!');
      expect(comment.createdAt).toBeInstanceOf(Date);
    });

    it('throws for non-existent spec', () => {
      expect(() =>
        store.addComment('non-existent', {
          author: 'alice',
          authorType: 'human',
          content: 'test',
        }),
      ).toThrow();
    });
  });

  describe('getVersions', () => {
    it('returns empty array for non-existent spec', () => {
      expect(store.getVersions('non-existent')).toEqual([]);
    });

    it('returns versions in order', () => {
      const spec = store.create({ title: 'Version Test' });
      store.update(spec.id, { content: 'v2' }, 'Second version');
      store.update(spec.id, { content: 'v3' }, 'Third version');

      const versions = store.getVersions(spec.id);
      expect(versions).toHaveLength(3);
      expect(versions[0].version).toBe(1);
      expect(versions[1].version).toBe(2);
      expect(versions[2].version).toBe(3);
    });
  });

  describe('restore', () => {
    it('returns null (placeholder)', () => {
      const spec = store.create({ title: 'Restore Test' });
      expect(store.restore(spec.id, 1)).toBeNull();
    });
  });
});
