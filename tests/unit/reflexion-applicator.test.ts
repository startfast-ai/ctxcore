import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReflexionApplicator } from '../../src/reflexion-applicator.js';
import type { ReflexionSuggestion, IMemoryStore, Memory } from '../../src/types.js';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    content: 'Test memory content',
    tier: 'operational',
    importance: 0.5,
    actuality: 0.8,
    embedding: null,
    tags: ['tag-a'],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date(),
    accessCount: 1,
    archived: false,
    ...overrides,
  };
}

function makeMockStore(memories: Memory[]): IMemoryStore {
  const memoryMap = new Map(memories.map((m) => [m.id, { ...m }]));

  return {
    getById: vi.fn((id: string) => {
      const m = memoryMap.get(id);
      return m ? { ...m } : null;
    }),
    create: vi.fn((input) => {
      const m = makeMemory({
        id: 'merged-new',
        content: input.content,
        tier: input.tier ?? 'short-term',
        importance: input.importance ?? 0.3,
        tags: input.tags ?? [],
        metadata: input.metadata ?? {},
      });
      memoryMap.set(m.id, m);
      return m;
    }),
    update: vi.fn((id: string, input) => {
      const m = memoryMap.get(id);
      if (!m) return null;
      Object.assign(m, input);
      return { ...m };
    }),
    archive: vi.fn((id: string) => {
      const m = memoryMap.get(id);
      if (!m) return null;
      m.archived = true;
      return { ...m };
    }),
    createConnection: vi.fn((input) => ({
      id: 'conn-new',
      sourceId: input.sourceId,
      targetId: input.targetId,
      type: input.type,
      strength: input.strength ?? 0.5,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    })),
    delete: vi.fn(),
    recordAccess: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    searchByKeyword: vi.fn().mockReturnValue([]),
    getConnectionById: vi.fn(),
    getConnectionsFor: vi.fn().mockReturnValue([]),
    deleteConnection: vi.fn(),
    getEvents: vi.fn().mockReturnValue([]),
    stats: vi.fn().mockReturnValue({ total: 0, byTier: {}, archived: 0 }),
  };
}

describe('ReflexionApplicator', () => {
  let applicator: ReflexionApplicator;

  beforeEach(() => {
    applicator = new ReflexionApplicator();
  });

  describe('merge', () => {
    it('combines content, uses highest tier/importance, archives originals, creates connections', () => {
      const mem1 = makeMemory({ id: 'mem-1', content: 'Content A', tier: 'short-term', importance: 0.3, tags: ['a'] });
      const mem2 = makeMemory({ id: 'mem-2', content: 'Content B', tier: 'long-term', importance: 0.9, tags: ['b'] });
      const store = makeMockStore([mem1, mem2]);

      const suggestion: ReflexionSuggestion = {
        action: 'merge',
        targetIds: ['mem-1', 'mem-2'],
        reason: 'Related memories',
        data: { mergedContent: 'Combined content A and B' },
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Should create a merged memory with highest tier and importance
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Combined content A and B',
          tier: 'long-term',
          importance: 0.9,
          tags: expect.arrayContaining(['a', 'b']),
        }),
      );

      // Should archive both originals
      expect(store.archive).toHaveBeenCalledWith('mem-1');
      expect(store.archive).toHaveBeenCalledWith('mem-2');

      // Should create connections from merged to originals
      expect(store.createConnection).toHaveBeenCalledTimes(2);
    });

    it('falls back to concatenated content when mergedContent not provided', () => {
      const mem1 = makeMemory({ id: 'mem-1', content: 'Content A', tier: 'operational', importance: 0.5 });
      const mem2 = makeMemory({ id: 'mem-2', content: 'Content B', tier: 'operational', importance: 0.5 });
      const store = makeMockStore([mem1, mem2]);

      const suggestion: ReflexionSuggestion = {
        action: 'merge',
        targetIds: ['mem-1', 'mem-2'],
        reason: 'Related',
      };

      applicator.apply([suggestion], store);

      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Content A\n\nContent B',
        }),
      );
    });

    it('skips when a target memory is missing', () => {
      const mem1 = makeMemory({ id: 'mem-1', content: 'Content A' });
      const store = makeMockStore([mem1]); // mem-2 is missing

      const suggestion: ReflexionSuggestion = {
        action: 'merge',
        targetIds: ['mem-1', 'mem-missing'],
        reason: 'Related',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
      expect(store.create).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('archives all target memories', () => {
      const mem1 = makeMemory({ id: 'mem-1' });
      const mem2 = makeMemory({ id: 'mem-2' });
      const store = makeMockStore([mem1, mem2]);

      const suggestion: ReflexionSuggestion = {
        action: 'archive',
        targetIds: ['mem-1', 'mem-2'],
        reason: 'Outdated',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(1);
      expect(store.archive).toHaveBeenCalledWith('mem-1');
      expect(store.archive).toHaveBeenCalledWith('mem-2');
    });

    it('skips when all target memories are missing', () => {
      const store = makeMockStore([]);

      const suggestion: ReflexionSuggestion = {
        action: 'archive',
        targetIds: ['mem-missing'],
        reason: 'Outdated',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('promote', () => {
    it('promotes short-term to operational', () => {
      const mem = makeMemory({ id: 'mem-1', tier: 'short-term' });
      const store = makeMockStore([mem]);

      const suggestion: ReflexionSuggestion = {
        action: 'promote',
        targetIds: ['mem-1'],
        reason: 'Important pattern',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(1);
      expect(store.update).toHaveBeenCalledWith('mem-1', { tier: 'operational' });
    });

    it('promotes operational to long-term', () => {
      const mem = makeMemory({ id: 'mem-1', tier: 'operational' });
      const store = makeMockStore([mem]);

      const suggestion: ReflexionSuggestion = {
        action: 'promote',
        targetIds: ['mem-1'],
        reason: 'Important',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(1);
      expect(store.update).toHaveBeenCalledWith('mem-1', { tier: 'long-term' });
    });

    it('skips when already at long-term (no change needed)', () => {
      const mem = makeMemory({ id: 'mem-1', tier: 'long-term' });
      const store = makeMockStore([mem]);

      const suggestion: ReflexionSuggestion = {
        action: 'promote',
        targetIds: ['mem-1'],
        reason: 'Already top tier',
      };

      const result = applicator.apply([suggestion], store);

      // No tier change for long-term -> long-term, so skipped
      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
      expect(store.update).not.toHaveBeenCalled();
    });

    it('skips when target memory is missing', () => {
      const store = makeMockStore([]);

      const suggestion: ReflexionSuggestion = {
        action: 'promote',
        targetIds: ['mem-missing'],
        reason: 'Important',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('update-importance', () => {
    it('updates importance using data.importance field', () => {
      const mem = makeMemory({ id: 'mem-1', importance: 0.3 });
      const store = makeMockStore([mem]);

      const suggestion: ReflexionSuggestion = {
        action: 'update-importance',
        targetIds: ['mem-1'],
        reason: 'Architectural decision',
        data: { importance: 0.9 },
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(1);
      expect(store.update).toHaveBeenCalledWith('mem-1', { importance: 0.9 });
    });

    it('updates importance using data.newImportance field', () => {
      const mem = makeMemory({ id: 'mem-1', importance: 0.3 });
      const store = makeMockStore([mem]);

      const suggestion: ReflexionSuggestion = {
        action: 'update-importance',
        targetIds: ['mem-1'],
        reason: 'Recalibrated',
        data: { newImportance: 0.8 },
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(1);
      expect(store.update).toHaveBeenCalledWith('mem-1', { importance: 0.8 });
    });

    it('skips when no importance value in data', () => {
      const mem = makeMemory({ id: 'mem-1' });
      const store = makeMockStore([mem]);

      const suggestion: ReflexionSuggestion = {
        action: 'update-importance',
        targetIds: ['mem-1'],
        reason: 'Missing data',
        data: {},
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('skips when target memory is missing', () => {
      const store = makeMockStore([]);

      const suggestion: ReflexionSuggestion = {
        action: 'update-importance',
        targetIds: ['mem-missing'],
        reason: 'Recalibrated',
        data: { importance: 0.8 },
      };

      const result = applicator.apply([suggestion], store);

      // Returns false because no memory was found to update
      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('create-connection', () => {
    it('creates connection between two memories with specified type', () => {
      const mem1 = makeMemory({ id: 'mem-1' });
      const mem2 = makeMemory({ id: 'mem-2' });
      const store = makeMockStore([mem1, mem2]);

      const suggestion: ReflexionSuggestion = {
        action: 'create-connection',
        targetIds: ['mem-1', 'mem-2'],
        reason: 'Contradiction',
        data: { connectionType: 'contradicts' },
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(1);
      expect(store.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: 'mem-1',
          targetId: 'mem-2',
          type: 'contradicts',
        }),
      );
    });

    it('defaults to similar connection type when not specified', () => {
      const mem1 = makeMemory({ id: 'mem-1' });
      const mem2 = makeMemory({ id: 'mem-2' });
      const store = makeMockStore([mem1, mem2]);

      const suggestion: ReflexionSuggestion = {
        action: 'create-connection',
        targetIds: ['mem-1', 'mem-2'],
        reason: 'Related',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(1);
      expect(store.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'similar',
        }),
      );
    });

    it('skips when fewer than 2 target IDs', () => {
      const mem1 = makeMemory({ id: 'mem-1' });
      const store = makeMockStore([mem1]);

      const suggestion: ReflexionSuggestion = {
        action: 'create-connection',
        targetIds: ['mem-1'],
        reason: 'Missing target',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('skips when source memory is missing', () => {
      const mem2 = makeMemory({ id: 'mem-2' });
      const store = makeMockStore([mem2]);

      const suggestion: ReflexionSuggestion = {
        action: 'create-connection',
        targetIds: ['mem-missing', 'mem-2'],
        reason: 'Related',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('skips when target memory is missing', () => {
      const mem1 = makeMemory({ id: 'mem-1' });
      const store = makeMockStore([mem1]);

      const suggestion: ReflexionSuggestion = {
        action: 'create-connection',
        targetIds: ['mem-1', 'mem-missing'],
        reason: 'Related',
      };

      const result = applicator.apply([suggestion], store);

      expect(result.applied).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('error handling', () => {
    it('captures errors and continues processing remaining suggestions', () => {
      const mem1 = makeMemory({ id: 'mem-1' });
      const store = makeMockStore([mem1]);

      // Make archive throw an error
      (store.archive as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Database locked');
      });

      const suggestions: ReflexionSuggestion[] = [
        {
          action: 'archive',
          targetIds: ['mem-1'],
          reason: 'Will fail',
        },
        {
          action: 'promote',
          targetIds: ['mem-1'],
          reason: 'Will succeed',
        },
      ];

      // Patch mem-1 tier to short-term so promote works
      (store.getById as ReturnType<typeof vi.fn>).mockReturnValue(
        makeMemory({ id: 'mem-1', tier: 'short-term' }),
      );

      const result = applicator.apply(suggestions, store);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Database locked');
      expect(result.applied).toBe(1); // promote succeeded
    });
  });

  describe('mixed suggestions', () => {
    it('processes multiple suggestion types in a batch', () => {
      const mem1 = makeMemory({ id: 'mem-1', tier: 'short-term', importance: 0.3 });
      const mem2 = makeMemory({ id: 'mem-2', tier: 'operational', importance: 0.5 });
      const mem3 = makeMemory({ id: 'mem-3', tier: 'operational', importance: 0.4 });
      const store = makeMockStore([mem1, mem2, mem3]);

      const suggestions: ReflexionSuggestion[] = [
        {
          action: 'promote',
          targetIds: ['mem-1'],
          reason: 'Recurring pattern',
        },
        {
          action: 'update-importance',
          targetIds: ['mem-2'],
          reason: 'Key decision',
          data: { importance: 0.9 },
        },
        {
          action: 'create-connection',
          targetIds: ['mem-2', 'mem-3'],
          reason: 'Related decisions',
          data: { connectionType: 'similar' },
        },
      ];

      const result = applicator.apply(suggestions, store);

      expect(result.applied).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
