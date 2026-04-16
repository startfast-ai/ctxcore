import { readFileSync } from 'node:fs';
import type {
  ITriggerEngine,
  IMemoryStore,
  TriggerRule,
  TriggerAlert,
  Memory,
  MemoryTier,
} from './types.js';

/**
 * Extract significant words from text (lowercase, >= 4 chars, no stop words).
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'been', 'were', 'will',
    'would', 'could', 'should', 'their', 'them', 'they', 'what',
    'when', 'where', 'which', 'while', 'about', 'after', 'before',
    'between', 'does', 'each', 'than', 'then', 'there', 'these',
    'those', 'through', 'into', 'also', 'some', 'such', 'more',
    'other', 'very', 'just', 'because', 'being',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));
}

/**
 * Check how many keywords two sets share.
 */
function keywordOverlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  return a.filter((w) => setB.has(w)).length;
}

export class TriggerEngine implements ITriggerEngine {
  private rules: TriggerRule[] = [];

  constructor(rules?: TriggerRule[]) {
    if (rules) {
      this.rules = rules;
    }
  }

  loadRules(configPath: string): void {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { rules: TriggerRule[] };
    this.rules = parsed.rules ?? [];
  }

  getRules(): TriggerRule[] {
    return [...this.rules];
  }

  evaluate(store: IMemoryStore): TriggerAlert[] {
    const alerts: TriggerAlert[] = [];

    for (const rule of this.rules) {
      const alert = this.evaluateRule(rule, store);
      alerts.push(alert);
    }

    return alerts;
  }

  private evaluateRule(rule: TriggerRule, store: IMemoryStore): TriggerAlert {
    switch (rule.condition.type) {
      case 'stale-tier':
        return this.evaluateStaleTier(rule, store);
      case 'recurring-pattern':
        return this.evaluateRecurringPattern(rule, store);
      case 'low-coverage':
        return this.evaluateLowCoverage(rule, store);
      default:
        return {
          rule,
          triggered: false,
          message: `Unknown condition type: ${rule.condition.type}`,
          memoryIds: [],
        };
    }
  }

  private evaluateStaleTier(rule: TriggerRule, store: IMemoryStore): TriggerAlert {
    const tier = rule.condition.tier ?? 'long-term';
    const memories = store.list({ tier, includeArchived: false });

    if (memories.length === 0) {
      return { rule, triggered: false, message: `No memories in ${tier} tier`, memoryIds: [] };
    }

    const avgActuality = memories.reduce((sum, m) => sum + m.actuality, 0) / memories.length;

    if (avgActuality < rule.condition.threshold) {
      return {
        rule,
        triggered: true,
        message: rule.message.replace('{avg}', avgActuality.toFixed(2)).replace('{tier}', tier),
        memoryIds: memories.map((m) => m.id),
      };
    }

    return { rule, triggered: false, message: `${tier} tier is healthy (avg actuality ${avgActuality.toFixed(2)})`, memoryIds: [] };
  }

  private evaluateRecurringPattern(rule: TriggerRule, store: IMemoryStore): TriggerAlert {
    const memories = store.list({ includeArchived: false });
    const threshold = rule.condition.threshold;

    // Build keyword sets for each memory
    const memoryKeywords: Array<{ memory: Memory; keywords: string[] }> = memories.map((m) => ({
      memory: m,
      keywords: extractKeywords(m.content),
    }));

    // Find clusters of memories that share keywords
    const clusters: Map<string, string[]> = new Map();

    for (let i = 0; i < memoryKeywords.length; i++) {
      for (let j = i + 1; j < memoryKeywords.length; j++) {
        const overlap = keywordOverlap(memoryKeywords[i].keywords, memoryKeywords[j].keywords);
        if (overlap >= 2) {
          // Find shared keywords as cluster key
          const sharedWords = memoryKeywords[i].keywords.filter((w) =>
            memoryKeywords[j].keywords.includes(w),
          );
          const clusterKey = sharedWords.sort().join(',');
          if (!clusters.has(clusterKey)) {
            clusters.set(clusterKey, []);
          }
          const cluster = clusters.get(clusterKey)!;
          if (!cluster.includes(memoryKeywords[i].memory.id)) {
            cluster.push(memoryKeywords[i].memory.id);
          }
          if (!cluster.includes(memoryKeywords[j].memory.id)) {
            cluster.push(memoryKeywords[j].memory.id);
          }
        }
      }
    }

    // Check if any cluster meets the threshold
    for (const [, ids] of clusters) {
      if (ids.length >= threshold) {
        return {
          rule,
          triggered: true,
          message: rule.message.replace('{count}', ids.length.toString()),
          memoryIds: ids,
        };
      }
    }

    return { rule, triggered: false, message: 'No recurring patterns detected', memoryIds: [] };
  }

  private evaluateLowCoverage(rule: TriggerRule, store: IMemoryStore): TriggerAlert {
    const tier = rule.condition.tier ?? 'operational';
    const memories = store.list({ tier, includeArchived: false });

    if (memories.length < rule.condition.threshold) {
      return {
        rule,
        triggered: true,
        message: rule.message
          .replace('{count}', memories.length.toString())
          .replace('{threshold}', rule.condition.threshold.toString())
          .replace('{tier}', tier),
        memoryIds: memories.map((m) => m.id),
      };
    }

    return {
      rule,
      triggered: false,
      message: `${tier} tier has adequate coverage (${memories.length} memories)`,
      memoryIds: [],
    };
  }
}
