import { describe, it, expect, vi } from 'vitest';
import { HealthCalculator } from '../../src/health.js';
import type { IMemoryStore, Memory, Connection } from '../../src/types.js';

function makeMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? 'mem-1',
    content: overrides.content ?? 'test memory',
    tier: overrides.tier ?? 'short-term',
    importance: overrides.importance ?? 0.5,
    actuality: overrides.actuality ?? 1.0,
    embedding: null,
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    lastAccessedAt: overrides.lastAccessedAt ?? new Date(),
    accessCount: overrides.accessCount ?? 0,
    archived: overrides.archived ?? false,
  };
}

function makeMockStore(memories: Memory[], connections: Map<string, Connection[]> = new Map()): IMemoryStore {
  return {
    list: vi.fn().mockReturnValue(memories),
    getConnectionsFor: vi.fn((id: string) => connections.get(id) ?? []),
    stats: vi.fn().mockReturnValue({ total: memories.length, byTier: {}, archived: 0 }),
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    archive: vi.fn(),
    recordAccess: vi.fn(),
    searchByKeyword: vi.fn(),
    createConnection: vi.fn(),
    getConnectionById: vi.fn(),
    deleteConnection: vi.fn(),
    getEvents: vi.fn(),
  } as unknown as IMemoryStore;
}

describe('HealthCalculator', () => {
  const calculator = new HealthCalculator();

  it('returns score 0 for empty store', () => {
    const store = makeMockStore([]);
    const report = calculator.calculate(store);

    expect(report.score).toBe(0);
    expect(report.coverage).toBe(0);
    expect(report.freshness).toBe(0);
    expect(report.depth).toBe(0);
    expect(report.coherence).toBe(0);
    expect(report.details.length).toBeGreaterThan(0);
  });

  it('score increases with more memories', () => {
    const few = Array.from({ length: 3 }, (_, i) =>
      makeMockMemory({ id: `mem-${i}` }),
    );
    const many = Array.from({ length: 20 }, (_, i) =>
      makeMockMemory({ id: `mem-${i}` }),
    );

    const fewReport = calculator.calculate(makeMockStore(few));
    const manyReport = calculator.calculate(makeMockStore(many));

    expect(manyReport.score).toBeGreaterThan(fewReport.score);
  });

  it('freshness reflects average actuality', () => {
    const fresh = [
      makeMockMemory({ id: 'a', actuality: 1.0 }),
      makeMockMemory({ id: 'b', actuality: 1.0 }),
    ];
    const stale = [
      makeMockMemory({ id: 'a', actuality: 0.3 }),
      makeMockMemory({ id: 'b', actuality: 0.3 }),
    ];

    const freshReport = calculator.calculate(makeMockStore(fresh));
    const staleReport = calculator.calculate(makeMockStore(stale));

    expect(freshReport.freshness).toBeGreaterThan(staleReport.freshness);
  });

  it('depth rewards long-term and high-importance memories', () => {
    const shallow = Array.from({ length: 10 }, (_, i) =>
      makeMockMemory({ id: `mem-${i}`, tier: 'short-term', importance: 0.1 }),
    );
    const deep = Array.from({ length: 10 }, (_, i) =>
      makeMockMemory({ id: `mem-${i}`, tier: 'long-term', importance: 0.9 }),
    );

    const shallowReport = calculator.calculate(makeMockStore(shallow));
    const deepReport = calculator.calculate(makeMockStore(deep));

    expect(deepReport.depth).toBeGreaterThan(shallowReport.depth);
  });

  it('coherence increases with connected memories', () => {
    const conn: Connection = {
      id: 'conn-1', sourceId: 'a', targetId: 'b',
      type: 'supports', strength: 0.8, metadata: {}, createdAt: new Date(),
    };

    const memories = [
      makeMockMemory({ id: 'a' }),
      makeMockMemory({ id: 'b' }),
      makeMockMemory({ id: 'c' }),
    ];

    const noConns = makeMockStore(memories);
    const withConns = makeMockStore(memories, new Map([['a', [conn]], ['b', [conn]]]));

    const noConnReport = calculator.calculate(noConns);
    const withConnReport = calculator.calculate(withConns);

    expect(withConnReport.coherence).toBeGreaterThan(noConnReport.coherence);
  });

  it('perfect store gets high score', () => {
    const conn: Connection = {
      id: 'conn-1', sourceId: 'a', targetId: 'b',
      type: 'supports', strength: 0.8, metadata: {}, createdAt: new Date(),
    };

    const memories = Array.from({ length: 50 }, (_, i) =>
      makeMockMemory({
        id: `mem-${i}`,
        tier: 'long-term',
        actuality: 1.0,
        importance: 0.9,
        tags: ['arch', 'convention', 'pattern', 'decision', 'bug'],
      }),
    );

    const connections = new Map<string, Connection[]>();
    for (const m of memories) connections.set(m.id, [conn]);

    const store = makeMockStore(memories, connections);
    const report = calculator.calculate(store);

    expect(report.score).toBeGreaterThanOrEqual(90);
  });

  it('score is between 0 and 100', () => {
    const memories = Array.from({ length: 5 }, (_, i) =>
      makeMockMemory({ id: `mem-${i}`, actuality: 0.5 }),
    );
    const store = makeMockStore(memories);
    const report = calculator.calculate(store);

    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it('details array contains four dimension explanations', () => {
    const memories = [makeMockMemory({ id: 'a' })];
    const store = makeMockStore(memories);
    const report = calculator.calculate(store);

    expect(report.details.length).toBe(4);
    expect(report.details[0]).toContain('Depth');
    expect(report.details[1]).toContain('Freshness');
    expect(report.details[2]).toContain('Coherence');
    expect(report.details[3]).toContain('Coverage');
  });

  it('calculateIntelligence returns full score object', () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      makeMockMemory({ id: `mem-${i}`, tier: i < 3 ? 'long-term' : 'operational' }),
    );
    const store = makeMockStore(memories);
    const score = calculator.calculateIntelligence(store);

    expect(score.total).toBeGreaterThan(0);
    expect(score.memoryCounts.longTerm).toBe(3);
    expect(score.memoryCounts.operational).toBe(7);
    expect(score.memoryCounts.shortTerm).toBe(0);
    expect(score.trend).toBe('stable');
  });
});
