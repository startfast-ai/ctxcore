import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../../src/context-builder.js';
import type { IMemoryStore, Memory, MemoryTier, MemoryCreateInput, MemoryUpdateInput, Connection, ConnectionCreateInput, MemoryEvent } from '../../src/types.js';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date();
  return {
    id: 'test-id',
    content: 'test content',
    tier: 'short-term' as MemoryTier,
    importance: 0.5,
    actuality: 1.0,
    embedding: null,
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    archived: false,
    ...overrides,
  };
}

/** Minimal stub of IMemoryStore — only list() is needed by ContextBuilder */
function createMockStore(memories: Memory[]): IMemoryStore {
  return {
    list: () => memories,
    create: (_input: MemoryCreateInput) => memories[0]!,
    getById: (_id: string) => null,
    update: (_id: string, _input: MemoryUpdateInput) => null,
    delete: (_id: string) => false,
    archive: (_id: string) => null,
    recordAccess: (_id: string) => null,
    searchByKeyword: () => [],
    createConnection: (_input: ConnectionCreateInput) => ({} as Connection),
    getConnectionById: (_id: string) => null,
    getConnectionsFor: (_id: string) => [],
    deleteConnection: (_id: string) => false,
    getEvents: (_id: string) => [] as MemoryEvent[],
    stats: () => ({ total: memories.length, byTier: {}, archived: 0 }),
  };
}

describe('ContextBuilder', () => {
  describe('buildContext', () => {
    it('handles empty store', () => {
      const store = createMockStore([]);
      const builder = new ContextBuilder(store);
      const output = builder.buildContext();
      expect(output).toContain('No memories stored yet');
    });

    it('returns markdown output', () => {
      const memories = [
        makeMemory({ id: '1', content: 'Chose PostgreSQL for ACID compliance', tier: 'long-term', importance: 0.8, actuality: 0.9 }),
        makeMemory({ id: '2', content: 'Auth module uses JWT tokens', tier: 'operational', importance: 0.5, actuality: 0.8 }),
        makeMemory({ id: '3', content: 'Fixed timeout bug in retry logic', tier: 'short-term', importance: 0.3, actuality: 0.7 }),
      ];
      const store = createMockStore(memories);
      const builder = new ContextBuilder(store);
      const output = builder.buildContext();

      expect(output).toContain('### Key Decisions');
      expect(output).toContain('### Active Context');
      expect(output).toContain('### Recent Findings');
      expect(output).toContain('Chose PostgreSQL');
      expect(output).toContain('Auth module');
      expect(output).toContain('Fixed timeout');
    });

    it('prioritizes long-term over operational over short-term', () => {
      const memories = [
        makeMemory({ id: '1', content: 'short-term item', tier: 'short-term', importance: 0.9, actuality: 1.0 }),
        makeMemory({ id: '2', content: 'long-term item', tier: 'long-term', importance: 0.3, actuality: 0.5 }),
        makeMemory({ id: '3', content: 'operational item', tier: 'operational', importance: 0.5, actuality: 0.8 }),
      ];
      const store = createMockStore(memories);
      const builder = new ContextBuilder(store);
      const output = builder.buildContext();

      // Long-term appears in Key Decisions section, which comes first
      const longTermIdx = output.indexOf('long-term item');
      const operationalIdx = output.indexOf('operational item');
      const shortTermIdx = output.indexOf('short-term item');

      expect(longTermIdx).toBeLessThan(operationalIdx);
      expect(operationalIdx).toBeLessThan(shortTermIdx);
    });

    it('respects token budget', () => {
      // Create many memories that exceed a tiny budget
      const memories = Array.from({ length: 50 }, (_, i) =>
        makeMemory({
          id: `mem-${i}`,
          content: `Memory number ${i} with some extra content to use up tokens in the budget calculation`,
          tier: 'operational',
          importance: 0.5,
          actuality: 0.8,
        }),
      );
      const store = createMockStore(memories);
      const builder = new ContextBuilder(store);

      // Very small budget: 100 tokens = ~400 chars
      const output = builder.buildContext({ maxTokens: 100 });

      // Output should be significantly shorter than if we included all 50 memories
      const fullOutput = builder.buildContext({ maxTokens: 100000 });
      expect(output.length).toBeLessThan(fullOutput.length);
    });

    it('puts decision-tagged memories in Key Decisions section', () => {
      const memories = [
        makeMemory({
          id: '1',
          content: 'Use React for the frontend',
          tier: 'short-term',
          importance: 0.6,
          actuality: 0.9,
          tags: ['decision'],
        }),
      ];
      const store = createMockStore(memories);
      const builder = new ContextBuilder(store);
      const output = builder.buildContext();

      expect(output).toContain('### Key Decisions');
      expect(output).toContain('Use React for the frontend');
    });

    it('includes tags in output', () => {
      const memories = [
        makeMemory({
          id: '1',
          content: 'Some finding',
          tier: 'operational',
          importance: 0.5,
          actuality: 0.9,
          tags: ['auth', 'security'],
        }),
      ];
      const store = createMockStore(memories);
      const builder = new ContextBuilder(store);
      const output = builder.buildContext();

      expect(output).toContain('[auth, security]');
    });

    it('within same tier, higher importance * actuality sorts first', () => {
      const memories = [
        makeMemory({ id: '1', content: 'low-score', tier: 'operational', importance: 0.1, actuality: 0.1 }),
        makeMemory({ id: '2', content: 'high-score', tier: 'operational', importance: 0.9, actuality: 1.0 }),
      ];
      const store = createMockStore(memories);
      const builder = new ContextBuilder(store);
      const output = builder.buildContext();

      const highIdx = output.indexOf('high-score');
      const lowIdx = output.indexOf('low-score');
      expect(highIdx).toBeLessThan(lowIdx);
    });
  });
});
