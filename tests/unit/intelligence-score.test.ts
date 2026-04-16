import { describe, it, expect, vi } from 'vitest';
import { HealthCalculator, recordIntelligenceScore, getIntelligenceHistory, computeTrend } from '../../src/health.js';
import { createTestDb } from '../helpers/test-db.js';
import { MemoryStore } from '../../src/memory-store.js';
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
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date(),
    accessCount: 0,
    archived: false,
    ...overrides,
  };
}

function makeMockStore(memories: Memory[], connections: Map<string, Connection[]> = new Map()): IMemoryStore {
  return {
    list: vi.fn().mockReturnValue(memories),
    getConnectionsFor: vi.fn((id: string) => connections.get(id) ?? []),
    stats: vi.fn().mockReturnValue({ total: memories.length, byTier: {}, archived: 0 }),
    create: vi.fn(), getById: vi.fn(), update: vi.fn(), delete: vi.fn(),
    archive: vi.fn(), recordAccess: vi.fn(), searchByKeyword: vi.fn(),
    createConnection: vi.fn(), getConnectionById: vi.fn(), deleteConnection: vi.fn(),
    getEvents: vi.fn(),
  } as unknown as IMemoryStore;
}

describe('IntelligenceScore', () => {
  const calculator = new HealthCalculator();

  it('calculateIntelligence returns all score dimensions', () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      makeMockMemory({ id: `m-${i}`, tier: i < 3 ? 'long-term' : 'operational', tags: ['arch'] }),
    );
    const store = makeMockStore(memories);
    const score = calculator.calculateIntelligence(store);

    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.depth).toBeGreaterThan(0);
    expect(score.freshness).toBeGreaterThan(0);
    expect(score.coverage).toBeGreaterThan(0);
    expect(score.trend).toBe('stable');
    expect(score.memoryCounts.longTerm).toBe(3);
    expect(score.memoryCounts.operational).toBe(7);
    expect(score.memoryCounts.shortTerm).toBe(0);
  });

  it('total is average of four dimensions', () => {
    const memories = Array.from({ length: 20 }, (_, i) =>
      makeMockMemory({ id: `m-${i}`, tier: 'operational', actuality: 0.8 }),
    );
    const store = makeMockStore(memories);
    const score = calculator.calculateIntelligence(store);

    const expectedAvg = Math.round((score.depth + score.freshness + score.coherence + score.coverage) / 4);
    expect(score.total).toBe(expectedAvg);
  });

  it('depth rewards long-term high-importance memories', () => {
    const shallow = Array.from({ length: 10 }, (_, i) =>
      makeMockMemory({ id: `m-${i}`, tier: 'short-term', importance: 0.1 }),
    );
    const deep = Array.from({ length: 10 }, (_, i) =>
      makeMockMemory({ id: `m-${i}`, tier: 'long-term', importance: 0.9 }),
    );

    const sScore = calculator.calculateIntelligence(makeMockStore(shallow));
    const dScore = calculator.calculateIntelligence(makeMockStore(deep));
    expect(dScore.depth).toBeGreaterThan(sScore.depth);
  });

  it('coverage rewards tag diversity', () => {
    const noTags = Array.from({ length: 10 }, (_, i) =>
      makeMockMemory({ id: `m-${i}`, tags: [] }),
    );
    const diverseTags = Array.from({ length: 10 }, (_, i) =>
      makeMockMemory({ id: `m-${i}`, tags: [`tag-${i}`] }),
    );

    const noTagScore = calculator.calculateIntelligence(makeMockStore(noTags));
    const diverseScore = calculator.calculateIntelligence(makeMockStore(diverseTags));
    expect(diverseScore.coverage).toBeGreaterThan(noTagScore.coverage);
  });
});

describe('Intelligence History', () => {
  it('records and retrieves score history', () => {
    const db = createTestDb();
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();

    // Create some memories
    for (let i = 0; i < 5; i++) {
      store.create({ content: `Memory ${i}`, tier: 'operational', importance: 0.5 });
    }

    const score = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, score, 'init');

    const history = getIntelligenceHistory(db, 10);
    expect(history.length).toBe(1);
    expect(history[0].eventType).toBe('init');
    expect(history[0].scoreTotal).toBe(score.total);
    expect(history[0].createdAt).toBeInstanceOf(Date);

    db.close();
  });

  it('records multiple events and returns in desc order', () => {
    const db = createTestDb();
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();

    store.create({ content: 'Memory 1', tier: 'short-term' });
    const s1 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s1, 'init');

    // Add more memories for a higher score
    for (let i = 0; i < 20; i++) {
      store.create({ content: `Memory ${i + 2}`, tier: 'long-term', importance: 0.8, tags: ['arch'] });
    }
    const s2 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s2, 'reflexion');

    const history = getIntelligenceHistory(db, 10);
    expect(history.length).toBe(2);
    // DESC order: most recent first
    expect(history[0].eventType).toBe('reflexion');
    expect(history[0].scoreTotal).toBeGreaterThanOrEqual(history[1].scoreTotal);

    db.close();
  });

  it('computeTrend detects rising trend', () => {
    const db = createTestDb();
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();

    // Record low score
    store.create({ content: 'M1', tier: 'short-term' });
    const s1 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s1, 'init');

    // Add lots of memories for higher score
    for (let i = 0; i < 50; i++) {
      store.create({ content: `M${i + 2}`, tier: 'long-term', importance: 0.9, tags: ['a', 'b', 'c', 'd', 'e'] });
    }
    const s2 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s2, 'reflexion');

    const trend = computeTrend(db);
    expect(trend).toBe('rising');

    db.close();
  });

  it('computeTrend returns stable with single entry', () => {
    const db = createTestDb();
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();

    store.create({ content: 'M1', tier: 'short-term' });
    const s = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s, 'init');

    expect(computeTrend(db)).toBe('stable');
    db.close();
  });

  it('respects limit parameter', () => {
    const db = createTestDb();
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();

    for (let i = 0; i < 10; i++) {
      store.create({ content: `M${i}`, tier: 'short-term' });
      const s = calculator.calculateIntelligence(store);
      recordIntelligenceScore(db, s, 'manual');
    }

    expect(getIntelligenceHistory(db, 3).length).toBe(3);
    expect(getIntelligenceHistory(db, 100).length).toBe(10);

    db.close();
  });
});
