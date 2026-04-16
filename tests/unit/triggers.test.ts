import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TriggerEngine } from '../../src/triggers.js';
import type { IMemoryStore, Memory, TriggerRule, MemoryTier } from '../../src/types.js';

// ── Minimal mock memory store ──

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? `mem-${Math.random().toString(36).slice(2)}`,
    content: overrides.content ?? 'test memory',
    tier: overrides.tier ?? 'operational',
    importance: overrides.importance ?? 0.5,
    actuality: overrides.actuality ?? 0.8,
    embedding: null,
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    lastAccessedAt: overrides.lastAccessedAt ?? new Date(),
    accessCount: overrides.accessCount ?? 1,
    archived: overrides.archived ?? false,
  };
}

class MockMemoryStore implements Partial<IMemoryStore> {
  private memories: Memory[] = [];

  constructor(memories: Memory[]) {
    this.memories = memories;
  }

  list(options?: { tier?: MemoryTier; includeArchived?: boolean }): Memory[] {
    let result = this.memories;
    if (options?.tier) {
      result = result.filter((m) => m.tier === options.tier);
    }
    if (!options?.includeArchived) {
      result = result.filter((m) => !m.archived);
    }
    return result;
  }
}

// ── Tests ──

describe('TriggerEngine', () => {
  describe('stale-tier condition', () => {
    it('fires when average actuality drops below threshold', () => {
      const rule: TriggerRule = {
        name: 'stale-long-term',
        condition: { type: 'stale-tier', threshold: 0.3, tier: 'long-term' },
        action: 'alert',
        message: 'Long-term memories are stale (avg actuality {avg} in {tier} tier)',
      };

      const store = new MockMemoryStore([
        makeMemory({ tier: 'long-term', actuality: 0.1 }),
        makeMemory({ tier: 'long-term', actuality: 0.2 }),
        makeMemory({ tier: 'long-term', actuality: 0.15 }),
      ]) as unknown as IMemoryStore;

      const engine = new TriggerEngine([rule]);
      const alerts = engine.evaluate(store);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].triggered).toBe(true);
      expect(alerts[0].memoryIds).toHaveLength(3);
      expect(alerts[0].message).toContain('0.15');
    });

    it('does not fire when actuality is above threshold', () => {
      const rule: TriggerRule = {
        name: 'stale-long-term',
        condition: { type: 'stale-tier', threshold: 0.3, tier: 'long-term' },
        action: 'alert',
        message: 'Stale',
      };

      const store = new MockMemoryStore([
        makeMemory({ tier: 'long-term', actuality: 0.8 }),
        makeMemory({ tier: 'long-term', actuality: 0.9 }),
      ]) as unknown as IMemoryStore;

      const engine = new TriggerEngine([rule]);
      const alerts = engine.evaluate(store);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].triggered).toBe(false);
    });

    it('does not fire on empty tier', () => {
      const rule: TriggerRule = {
        name: 'stale-long-term',
        condition: { type: 'stale-tier', threshold: 0.3, tier: 'long-term' },
        action: 'alert',
        message: 'Stale',
      };

      const store = new MockMemoryStore([]) as unknown as IMemoryStore;

      const engine = new TriggerEngine([rule]);
      const alerts = engine.evaluate(store);

      expect(alerts[0].triggered).toBe(false);
    });
  });

  describe('low-coverage condition', () => {
    it('fires when tier has fewer than threshold memories', () => {
      const rule: TriggerRule = {
        name: 'low-coverage-operational',
        condition: { type: 'low-coverage', threshold: 5, tier: 'operational' },
        action: 'alert',
        message: 'Low coverage: only {count}/{threshold} memories in {tier} tier',
      };

      const store = new MockMemoryStore([
        makeMemory({ tier: 'operational' }),
        makeMemory({ tier: 'operational' }),
      ]) as unknown as IMemoryStore;

      const engine = new TriggerEngine([rule]);
      const alerts = engine.evaluate(store);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].triggered).toBe(true);
      expect(alerts[0].message).toContain('2');
      expect(alerts[0].message).toContain('5');
    });

    it('does not fire when tier has enough memories', () => {
      const rule: TriggerRule = {
        name: 'low-coverage-operational',
        condition: { type: 'low-coverage', threshold: 3, tier: 'operational' },
        action: 'alert',
        message: 'Low coverage',
      };

      const store = new MockMemoryStore([
        makeMemory({ tier: 'operational' }),
        makeMemory({ tier: 'operational' }),
        makeMemory({ tier: 'operational' }),
        makeMemory({ tier: 'operational' }),
      ]) as unknown as IMemoryStore;

      const engine = new TriggerEngine([rule]);
      const alerts = engine.evaluate(store);

      expect(alerts[0].triggered).toBe(false);
    });
  });

  describe('recurring-pattern condition', () => {
    it('fires when 3+ memories share keywords', () => {
      const rule: TriggerRule = {
        name: 'recurring-bugs',
        condition: { type: 'recurring-pattern', threshold: 3 },
        action: 'alert',
        message: 'Recurring pattern detected: {count} memories share common keywords',
      };

      const store = new MockMemoryStore([
        makeMemory({ content: 'Authentication timeout error in login service' }),
        makeMemory({ content: 'Authentication failure timeout in payment service' }),
        makeMemory({ content: 'Authentication timeout detected in API gateway' }),
      ]) as unknown as IMemoryStore;

      const engine = new TriggerEngine([rule]);
      const alerts = engine.evaluate(store);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].triggered).toBe(true);
      expect(alerts[0].memoryIds).toHaveLength(3);
    });

    it('does not fire when memories do not share enough keywords', () => {
      const rule: TriggerRule = {
        name: 'recurring-bugs',
        condition: { type: 'recurring-pattern', threshold: 3 },
        action: 'alert',
        message: 'Recurring pattern',
      };

      const store = new MockMemoryStore([
        makeMemory({ content: 'Fixed the login button color' }),
        makeMemory({ content: 'Updated database schema for users' }),
        makeMemory({ content: 'Deployed new API endpoint for payments' }),
      ]) as unknown as IMemoryStore;

      const engine = new TriggerEngine([rule]);
      const alerts = engine.evaluate(store);

      expect(alerts[0].triggered).toBe(false);
    });
  });

  describe('no false positives on healthy store', () => {
    it('returns no triggered alerts on a healthy memory store', () => {
      const rules: TriggerRule[] = [
        {
          name: 'stale-long-term',
          condition: { type: 'stale-tier', threshold: 0.3, tier: 'long-term' },
          action: 'alert',
          message: 'Stale',
        },
        {
          name: 'low-coverage-operational',
          condition: { type: 'low-coverage', threshold: 3, tier: 'operational' },
          action: 'alert',
          message: 'Low coverage',
        },
        {
          name: 'recurring-bugs',
          condition: { type: 'recurring-pattern', threshold: 3 },
          action: 'alert',
          message: 'Recurring',
        },
      ];

      const store = new MockMemoryStore([
        makeMemory({ tier: 'long-term', actuality: 0.9, content: 'Chose PostgreSQL for ACID compliance' }),
        makeMemory({ tier: 'long-term', actuality: 0.8, content: 'Event sourcing for audit trail' }),
        makeMemory({ tier: 'operational', actuality: 0.7, content: 'Auth retry count set to 3' }),
        makeMemory({ tier: 'operational', actuality: 0.6, content: 'Redis cache TTL is 300s' }),
        makeMemory({ tier: 'operational', actuality: 0.8, content: 'Deploy pipeline uses GitHub Actions' }),
        makeMemory({ tier: 'short-term', actuality: 0.9, content: 'Working on search feature' }),
      ]) as unknown as IMemoryStore;

      const engine = new TriggerEngine(rules);
      const alerts = engine.evaluate(store);

      const triggered = alerts.filter((a) => a.triggered);
      expect(triggered).toHaveLength(0);
    });
  });

  describe('loadRules', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(tmpdir(), `ctxcore-trigger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(tmpDir, { recursive: true });
    });

    it('loads rules from a JSON config file', () => {
      const configPath = join(tmpDir, 'triggers.json');
      const config = {
        rules: [
          {
            name: 'test-rule',
            condition: { type: 'low-coverage', threshold: 10, tier: 'operational' },
            action: 'alert',
            message: 'Test',
          },
        ],
      };
      writeFileSync(configPath, JSON.stringify(config));

      const engine = new TriggerEngine();
      engine.loadRules(configPath);

      const rules = engine.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('test-rule');

      // Clean up
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('multiple rules', () => {
    it('evaluates all rules and returns alerts for each', () => {
      const rules: TriggerRule[] = [
        {
          name: 'stale-long-term',
          condition: { type: 'stale-tier', threshold: 0.3, tier: 'long-term' },
          action: 'alert',
          message: 'Stale {tier}',
        },
        {
          name: 'low-coverage',
          condition: { type: 'low-coverage', threshold: 5, tier: 'operational' },
          action: 'alert',
          message: 'Low coverage',
        },
      ];

      const store = new MockMemoryStore([
        makeMemory({ tier: 'long-term', actuality: 0.1 }),
        makeMemory({ tier: 'operational' }),
      ]) as unknown as IMemoryStore;

      const engine = new TriggerEngine(rules);
      const alerts = engine.evaluate(store);

      expect(alerts).toHaveLength(2);
      expect(alerts[0].triggered).toBe(true); // stale-tier fires
      expect(alerts[1].triggered).toBe(true); // low-coverage fires
    });
  });
});
