import { describe, it, expect } from 'vitest';
import { DecayEngine } from '../../src/decay.js';
import type { CtxcoreConfig, Memory, MemoryTier } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

function makeConfig(): CtxcoreConfig {
  return {
    ...DEFAULT_CONFIG,
    projectRoot: '/tmp/test',
    dbPath: ':memory:',
  } as CtxcoreConfig;
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date();
  return {
    id: 'test-id',
    content: 'test content',
    tier: 'short-term',
    importance: 0.3,
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

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe('DecayEngine', () => {
  const config = makeConfig();
  const engine = new DecayEngine(config);

  describe('computeDecayRate', () => {
    it.each([
      ['short-term', 0, config.decay.shortTerm],
      ['operational', 0, config.decay.operational],
      ['long-term', 0, config.decay.longTerm],
    ] as [MemoryTier, number, number][])(
      'returns base rate for %s tier with zero importance',
      (tier, importance, expectedBase) => {
        const memory = makeMemory({ tier, importance });
        const rate = engine.computeDecayRate(memory);
        expect(rate).toBeCloseTo(expectedBase, 6);
      },
    );

    it('importance shielding reduces the decay rate', () => {
      const low = makeMemory({ tier: 'short-term', importance: 0.1 });
      const high = makeMemory({ tier: 'short-term', importance: 0.9 });

      const rateLow = engine.computeDecayRate(low);
      const rateHigh = engine.computeDecayRate(high);

      // Higher importance → higher retention rate (closer to 1.0 = slower decay)
      expect(rateHigh).toBeGreaterThan(rateLow);
    });

    it('breakthrough importance (1.0) loses only 30% of normal hourly loss', () => {
      const memory = makeMemory({ tier: 'short-term', importance: 1.0 });
      const rate = engine.computeDecayRate(memory);
      const base = config.decay.shortTerm;

      // effective_rate = 1 - (1 - base) * (1 - 1.0 * 0.7) = 1 - 0.05 * 0.3 = 0.985
      const expected = 1 - (1 - base) * 0.3;
      expect(rate).toBeCloseTo(expected, 6);
      // Rate should be closer to 1.0 than base (slower decay)
      expect(rate).toBeGreaterThan(base);
    });

    it('zero importance gives base decay rate', () => {
      const memory = makeMemory({ tier: 'operational', importance: 0 });
      const rate = engine.computeDecayRate(memory);
      expect(rate).toBeCloseTo(config.decay.operational, 6);
    });
  });

  describe('applyDecay', () => {
    it('returns unchanged actuality when just accessed', () => {
      const memory = makeMemory({ actuality: 0.8, lastAccessedAt: new Date() });
      const newActuality = engine.applyDecay(memory);
      expect(newActuality).toBeCloseTo(0.8, 4);
    });

    it('decays actuality over time', () => {
      const memory = makeMemory({
        tier: 'short-term',
        actuality: 1.0,
        importance: 0,
        lastAccessedAt: hoursAgo(24),
      });

      const newActuality = engine.applyDecay(memory);
      expect(newActuality).toBeLessThan(1.0);
      expect(newActuality).toBeGreaterThan(0);
    });

    it('short-term decays faster than operational', () => {
      const shortTerm = makeMemory({
        tier: 'short-term',
        actuality: 1.0,
        importance: 0.3,
        lastAccessedAt: hoursAgo(48),
      });
      const operational = makeMemory({
        tier: 'operational',
        actuality: 1.0,
        importance: 0.3,
        lastAccessedAt: hoursAgo(48),
      });

      const decayedShort = engine.applyDecay(shortTerm);
      const decayedOp = engine.applyDecay(operational);

      expect(decayedShort).toBeLessThan(decayedOp);
    });

    it('operational decays faster than long-term', () => {
      const operational = makeMemory({
        tier: 'operational',
        actuality: 1.0,
        importance: 0.3,
        lastAccessedAt: hoursAgo(48),
      });
      const longTerm = makeMemory({
        tier: 'long-term',
        actuality: 1.0,
        importance: 0.3,
        lastAccessedAt: hoursAgo(48),
      });

      const decayedOp = engine.applyDecay(operational);
      const decayedLong = engine.applyDecay(longTerm);

      expect(decayedOp).toBeLessThan(decayedLong);
    });

    it('breakthroughs decay much slower than routine memories', () => {
      const routine = makeMemory({
        tier: 'short-term',
        actuality: 1.0,
        importance: 0.1,
        lastAccessedAt: hoursAgo(24),
      });
      const breakthrough = makeMemory({
        tier: 'short-term',
        actuality: 1.0,
        importance: 0.95,
        lastAccessedAt: hoursAgo(24),
      });

      const decayedRoutine = engine.applyDecay(routine);
      const decayedBreakthrough = engine.applyDecay(breakthrough);

      // Breakthrough should retain significantly more actuality
      expect(decayedBreakthrough).toBeGreaterThan(decayedRoutine);
      // With importance=0.95, decay is shielded by 66.5%, so it decays much slower
      expect(decayedBreakthrough / decayedRoutine).toBeGreaterThan(1.5);
    });

    it('clamps actuality to [0, 1]', () => {
      const memory = makeMemory({ actuality: 1.0, lastAccessedAt: hoursAgo(10000) });
      const newActuality = engine.applyDecay(memory);
      expect(newActuality).toBeGreaterThanOrEqual(0);
      expect(newActuality).toBeLessThanOrEqual(1);
    });

    it.each([1, 6, 12, 24, 72, 168, 720])('decays progressively over %d hours', (hours) => {
      const memory = makeMemory({
        tier: 'operational',
        actuality: 1.0,
        importance: 0.3,
        lastAccessedAt: hoursAgo(hours),
      });

      const newActuality = engine.applyDecay(memory);
      expect(newActuality).toBeLessThan(1.0);
      expect(newActuality).toBeGreaterThan(0);
    });
  });
});
