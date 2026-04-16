import { describe, it, expect, beforeEach } from 'vitest';
import { PromotionEngine } from '../../src/promotion.js';
import type { Memory } from '../../src/types.js';

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

describe('PromotionEngine', () => {
  let engine: PromotionEngine;

  beforeEach(() => {
    engine = new PromotionEngine();
  });

  describe('promotion: short-term → operational', () => {
    it('promotes when accessCount >= 3 AND actuality > 0.5', () => {
      const memory = makeMemory({ tier: 'short-term', accessCount: 3, actuality: 0.6 });
      expect(engine.evaluate(memory)).toBe('operational');
    });

    it('does not promote with insufficient access count', () => {
      const memory = makeMemory({ tier: 'short-term', accessCount: 2, actuality: 0.8 });
      expect(engine.evaluate(memory)).toBeNull();
    });

    it('does not promote with low actuality', () => {
      const memory = makeMemory({ tier: 'short-term', accessCount: 5, actuality: 0.4 });
      expect(engine.evaluate(memory)).toBeNull();
    });

    it('promotes at exact threshold', () => {
      const memory = makeMemory({ tier: 'short-term', accessCount: 3, actuality: 0.51 });
      expect(engine.evaluate(memory)).toBe('operational');
    });
  });

  describe('promotion: operational → long-term', () => {
    it('promotes when accessCount >= 10 AND importance >= 0.6', () => {
      const memory = makeMemory({ tier: 'operational', accessCount: 10, importance: 0.7 });
      expect(engine.evaluate(memory)).toBe('long-term');
    });

    it('does not promote with insufficient access count', () => {
      const memory = makeMemory({ tier: 'operational', accessCount: 9, importance: 0.8 });
      expect(engine.evaluate(memory)).toBeNull();
    });

    it('does not promote with low importance', () => {
      const memory = makeMemory({ tier: 'operational', accessCount: 15, importance: 0.5 });
      expect(engine.evaluate(memory)).toBeNull();
    });

    it('promotes at exact threshold', () => {
      const memory = makeMemory({ tier: 'operational', accessCount: 10, importance: 0.6 });
      expect(engine.evaluate(memory)).toBe('long-term');
    });
  });

  describe('demotion: long-term → operational', () => {
    it('demotes when actuality < 0.3', () => {
      const memory = makeMemory({ tier: 'long-term', actuality: 0.2 });
      expect(engine.evaluate(memory)).toBe('operational');
    });

    it('does not demote when actuality >= 0.3', () => {
      const memory = makeMemory({ tier: 'long-term', actuality: 0.3 });
      expect(engine.evaluate(memory)).toBeNull();
    });
  });

  describe('demotion: operational → short-term', () => {
    it('demotes when actuality < 0.1', () => {
      const memory = makeMemory({ tier: 'operational', actuality: 0.08 });
      expect(engine.evaluate(memory)).toBe('short-term');
    });

    it('does not demote when actuality >= 0.1', () => {
      const memory = makeMemory({ tier: 'operational', actuality: 0.1 });
      expect(engine.evaluate(memory)).toBeNull();
    });
  });

  describe('archival', () => {
    it('should archive when actuality < 0.05', () => {
      const memory = makeMemory({ actuality: 0.03 });
      expect(engine.shouldArchive(memory)).toBe(true);
    });

    it('should not archive when actuality >= 0.05', () => {
      const memory = makeMemory({ actuality: 0.05 });
      expect(engine.shouldArchive(memory)).toBe(false);
    });

    it('should not archive already-archived memories', () => {
      const memory = makeMemory({ actuality: 0.01, archived: true });
      expect(engine.shouldArchive(memory)).toBe(false);
    });
  });

  describe('no change scenarios', () => {
    it('returns null for archived memory', () => {
      const memory = makeMemory({ archived: true, tier: 'short-term', accessCount: 10 });
      expect(engine.evaluate(memory)).toBeNull();
    });

    it('returns null for healthy short-term memory with no promotion criteria', () => {
      const memory = makeMemory({ tier: 'short-term', accessCount: 1, actuality: 0.8 });
      expect(engine.evaluate(memory)).toBeNull();
    });

    it('returns null for healthy long-term memory', () => {
      const memory = makeMemory({ tier: 'long-term', actuality: 0.9, accessCount: 20 });
      expect(engine.evaluate(memory)).toBeNull();
    });
  });

  describe('demotion takes priority over promotion', () => {
    it('demotes operational with low actuality even if promotion criteria met', () => {
      // accessCount >= 10 and importance >= 0.6 would promote to long-term,
      // but actuality < 0.1 should demote to short-term instead
      const memory = makeMemory({
        tier: 'operational',
        accessCount: 15,
        importance: 0.8,
        actuality: 0.05,
      });
      expect(engine.evaluate(memory)).toBe('short-term');
    });
  });
});
