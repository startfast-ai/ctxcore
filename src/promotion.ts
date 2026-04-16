import type { IPromotionEngine, IMemoryStore, Memory, MemoryTier } from './types.js';

/**
 * Tier promotion/demotion engine.
 *
 * Promotion rules:
 *   short-term → operational: accessCount >= 3 AND actuality > 0.5
 *   operational → long-term:  accessCount >= 10 AND importance >= 0.6
 *
 * Demotion rules:
 *   long-term → operational:  actuality < 0.3
 *   operational → short-term: actuality < 0.1
 *
 * Archival:
 *   any tier → archived:     actuality < 0.05
 */
export class PromotionEngine implements IPromotionEngine {
  /**
   * Evaluates a memory and returns the new tier it should move to,
   * or null if no change is needed. For archival, returns null but
   * the caller should check separately via shouldArchive().
   */
  evaluate(memory: Memory): MemoryTier | null {
    // Archival takes precedence — checked separately via shouldArchive
    // but we don't return a tier for it since archived is a flag, not a tier
    if (memory.archived) return null;

    // Check demotion first (higher priority — prevent keeping stale memories in high tiers)
    if (memory.tier === 'long-term' && memory.actuality < 0.3) {
      return 'operational';
    }
    if (memory.tier === 'operational' && memory.actuality < 0.1) {
      return 'short-term';
    }

    // Check promotion
    if (memory.tier === 'short-term' && memory.accessCount >= 3 && memory.actuality > 0.5) {
      return 'operational';
    }
    if (memory.tier === 'operational' && memory.accessCount >= 10 && memory.importance >= 0.6) {
      return 'long-term';
    }

    return null;
  }

  /**
   * Returns true if the memory should be archived (actuality < 0.05).
   */
  shouldArchive(memory: Memory): boolean {
    return !memory.archived && memory.actuality < 0.05;
  }

  /**
   * Sweeps all active memories, applies promotion/demotion/archival changes.
   * Returns counts of changes made.
   */
  async runPromotionSweep(
    store: IMemoryStore,
  ): Promise<{ promoted: number; demoted: number; archived: number }> {
    const memories = store.list({ includeArchived: false, limit: 10000 });
    let promoted = 0;
    let demoted = 0;
    let archived = 0;

    for (const memory of memories) {
      // Check archival first
      if (this.shouldArchive(memory)) {
        store.archive(memory.id);
        archived++;
        continue;
      }

      const newTier = this.evaluate(memory);
      if (newTier !== null) {
        const tierOrder: Record<MemoryTier, number> = {
          'short-term': 0,
          operational: 1,
          'long-term': 2,
        };

        store.update(memory.id, { tier: newTier });

        if (tierOrder[newTier] > tierOrder[memory.tier]) {
          promoted++;
        } else {
          demoted++;
        }
      }
    }

    return { promoted, demoted, archived };
  }
}
