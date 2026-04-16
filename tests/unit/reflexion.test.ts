import { describe, it, expect, vi } from 'vitest';
import { ReflexionEngine } from '../../src/reflexion.js';
import type { Memory, IClaudeCliRunner, IMemoryStore } from '../../src/types.js';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    content: 'Test memory content',
    tier: 'operational',
    importance: 0.5,
    actuality: 0.8,
    embedding: null,
    tags: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date(),
    accessCount: 1,
    archived: false,
    ...overrides,
  };
}

function mockCliRunner(response: string): IClaudeCliRunner {
  return {
    run: vi.fn().mockResolvedValue(response),
  };
}

function mockCliRunnerRejecting(error: string): IClaudeCliRunner {
  return {
    run: vi.fn().mockRejectedValue(new Error(error)),
  };
}

describe('ReflexionEngine', () => {
  const memories: Memory[] = [
    makeMemory({ id: 'mem-1', content: 'Chose PostgreSQL for ACID compliance' }),
    makeMemory({ id: 'mem-2', content: 'Chose MongoDB for flexibility' }),
  ];

  describe('runConsolidation', () => {
    it('returns merge suggestions from valid JSON response', async () => {
      const cliResponse = JSON.stringify({
        memoriesAffected: ['mem-1', 'mem-2'],
        suggestions: [
          {
            action: 'merge',
            targetIds: ['mem-1', 'mem-2'],
            reason: 'Both discuss database choice',
            data: { mergedContent: 'Database choice: PostgreSQL for ACID' },
          },
        ],
      });
      const cli = mockCliRunner(cliResponse);
      const engine = new ReflexionEngine(cli);

      const result = await engine.runConsolidation(memories);

      expect(result.type).toBe('consolidation');
      expect(result.memoriesAffected).toEqual(['mem-1', 'mem-2']);
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].action).toBe('merge');
      expect(result.suggestions[0].targetIds).toEqual(['mem-1', 'mem-2']);
      expect(result.journal.type).toBe('consolidation');
      expect(result.journal.id).toBeDefined();
    });

    it('handles JSON wrapped in markdown code fences', async () => {
      const cliResponse =
        '```json\n' +
        JSON.stringify({
          memoriesAffected: ['mem-1'],
          suggestions: [
            { action: 'merge', targetIds: ['mem-1', 'mem-2'], reason: 'Related' },
          ],
        }) +
        '\n```';
      const cli = mockCliRunner(cliResponse);
      const engine = new ReflexionEngine(cli);

      const result = await engine.runConsolidation(memories);

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].action).toBe('merge');
    });
  });

  describe('detectContradictions', () => {
    it('returns contradiction suggestions', async () => {
      const cliResponse = JSON.stringify({
        memoriesAffected: ['mem-1', 'mem-2'],
        suggestions: [
          {
            action: 'archive',
            targetIds: ['mem-2'],
            reason: 'Outdated — PostgreSQL was the final choice',
          },
          {
            action: 'create-connection',
            targetIds: ['mem-1', 'mem-2'],
            reason: 'These memories contradict each other on database choice',
            data: { connectionType: 'contradicts' },
          },
        ],
      });
      const cli = mockCliRunner(cliResponse);
      const engine = new ReflexionEngine(cli);

      const result = await engine.detectContradictions(memories);

      expect(result.type).toBe('contradiction');
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0].action).toBe('archive');
      expect(result.suggestions[1].action).toBe('create-connection');
    });
  });

  describe('findPatterns', () => {
    it('returns pattern suggestions', async () => {
      const cliResponse = JSON.stringify({
        memoriesAffected: ['mem-1', 'mem-2'],
        suggestions: [
          {
            action: 'create-connection',
            targetIds: ['mem-1', 'mem-2'],
            reason: 'Both relate to database selection pattern',
            data: { connectionType: 'similar', pattern: 'Database selection' },
          },
        ],
      });
      const cli = mockCliRunner(cliResponse);
      const engine = new ReflexionEngine(cli);

      const result = await engine.findPatterns(memories);

      expect(result.type).toBe('pattern');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].data?.pattern).toBe('Database selection');
    });
  });

  describe('recalibrateImportance', () => {
    it('returns importance adjustment suggestions', async () => {
      const cliResponse = JSON.stringify({
        memoriesAffected: ['mem-1'],
        suggestions: [
          {
            action: 'update-importance',
            targetIds: ['mem-1'],
            reason: 'Architectural decision deserves higher importance',
            data: { newImportance: 0.8 },
          },
        ],
      });
      const cli = mockCliRunner(cliResponse);
      const engine = new ReflexionEngine(cli);

      const result = await engine.recalibrateImportance(memories);

      expect(result.type).toBe('recalibration');
      expect(result.suggestions[0].action).toBe('update-importance');
      expect(result.suggestions[0].data?.newImportance).toBe(0.8);
    });
  });

  describe('error handling', () => {
    it('returns graceful error result when CLI returns garbage', async () => {
      const cli = mockCliRunner('This is not JSON at all, just random text without any structure');
      const engine = new ReflexionEngine(cli);

      const result = await engine.runConsolidation(memories);

      expect(result.type).toBe('consolidation');
      expect(result.memoriesAffected).toEqual([]);
      expect(result.suggestions).toEqual([]);
      expect(result.journal.output).toHaveProperty('error');
    });

    it('returns graceful error result when CLI throws', async () => {
      const cli = mockCliRunnerRejecting('Connection timeout');
      const engine = new ReflexionEngine(cli);

      const result = await engine.detectContradictions(memories);

      expect(result.type).toBe('contradiction');
      expect(result.memoriesAffected).toEqual([]);
      expect(result.suggestions).toEqual([]);
      expect(result.journal.output).toHaveProperty('error');
      expect((result.journal.output as Record<string, string>).error).toContain(
        'Connection timeout',
      );
    });

    it('handles empty suggestions array gracefully', async () => {
      const cliResponse = JSON.stringify({
        memoriesAffected: [],
        suggestions: [],
      });
      const cli = mockCliRunner(cliResponse);
      const engine = new ReflexionEngine(cli);

      const result = await engine.runConsolidation(memories);

      expect(result.suggestions).toEqual([]);
      expect(result.memoriesAffected).toEqual([]);
    });
  });

  describe('runFull', () => {
    it('runs all four reflexion types', async () => {
      const cliResponse = JSON.stringify({
        memoriesAffected: [],
        suggestions: [],
      });
      const cli = mockCliRunner(cliResponse);
      const engine = new ReflexionEngine(cli);

      const mockStore: IMemoryStore = {
        list: vi.fn().mockReturnValue(memories),
        create: vi.fn(),
        getById: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        archive: vi.fn(),
        recordAccess: vi.fn(),
        searchByKeyword: vi.fn(),
        createConnection: vi.fn(),
        getConnectionById: vi.fn(),
        getConnectionsFor: vi.fn(),
        deleteConnection: vi.fn(),
        getEvents: vi.fn(),
        stats: vi.fn(),
      } as unknown as IMemoryStore;

      const results = await engine.runFull(mockStore);

      expect(results).toHaveLength(4);
      expect(results.map((r) => r.type)).toEqual([
        'consolidation',
        'contradiction',
        'pattern',
        'recalibration',
      ]);
      expect(mockStore.list).toHaveBeenCalledWith({ includeArchived: false });
    });
  });

  describe('journal entries', () => {
    it('creates journal entries with correct metadata', async () => {
      const cliResponse = JSON.stringify({
        memoriesAffected: ['mem-1'],
        suggestions: [],
      });
      const cli = mockCliRunner(cliResponse);
      const engine = new ReflexionEngine(cli);

      const result = await engine.runConsolidation(memories);

      expect(result.journal.id).toBeTruthy();
      expect(result.journal.type).toBe('consolidation');
      expect(result.journal.input).toHaveProperty('memoryIds');
      expect(result.journal.input).toHaveProperty('memoryCount', 2);
      expect(result.journal.createdAt).toBeInstanceOf(Date);
    });
  });
});
