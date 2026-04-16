import type { CtxcoreConfig, IDecayEngine, IMemoryStore, Memory } from './types.js';

/**
 * Actuality decay engine.
 *
 * Each memory's actuality decays exponentially over time based on its tier's
 * base decay rate. Importance shields memories from decay — a breakthrough
 * (importance ~1.0) decays at roughly 30% the normal rate.
 *
 * Formula:
 *   decay_rate = base_decay × (1 - importance × 0.7)
 *   new_actuality = actuality × (decay_rate ^ hours_since_last_access)
 */
export class DecayEngine implements IDecayEngine {
  private readonly decayRates: { 'short-term': number; operational: number; 'long-term': number };

  constructor(config: CtxcoreConfig) {
    this.decayRates = {
      'short-term': config.decay.shortTerm,
      operational: config.decay.operational,
      'long-term': config.decay.longTerm,
    };
  }

  /**
   * Returns the per-hour retention rate for a memory, accounting for importance shielding.
   *
   * The base decay rates (0.95, 0.995, 0.9995) represent how much actuality is
   * retained per hour. Importance shields memories from decay by reducing the
   * hourly loss: effective_rate = 1 - (1 - base_rate) × (1 - importance × 0.7)
   *
   * A breakthrough (importance=1.0) loses only 30% of the normal hourly loss.
   */
  computeDecayRate(memory: Memory): number {
    const baseDecay = this.decayRates[memory.tier];
    const hourlyLoss = 1 - baseDecay;
    const shieldedLoss = hourlyLoss * (1 - memory.importance * 0.7);
    return 1 - shieldedLoss;
  }

  /**
   * Computes and returns the new actuality for a memory based on time elapsed
   * since its last access. Does NOT mutate the memory object.
   */
  applyDecay(memory: Memory): number {
    const now = Date.now();
    const lastAccess = memory.lastAccessedAt.getTime();
    const hoursSinceAccess = Math.max(0, (now - lastAccess) / (1000 * 60 * 60));

    if (hoursSinceAccess === 0) return memory.actuality;

    const decayRate = this.computeDecayRate(memory);
    const newActuality = memory.actuality * Math.pow(decayRate, hoursSinceAccess);

    return Math.max(0, Math.min(1, newActuality));
  }

  /**
   * Sweeps all active memories, applies decay, and persists updated actuality values.
   */
  async runDecaySweep(store: IMemoryStore): Promise<number> {
    const memories = store.list({ includeArchived: false, limit: 10000 });
    let updated = 0;

    for (const memory of memories) {
      const newActuality = this.applyDecay(memory);

      // Only update if actuality actually changed meaningfully
      if (Math.abs(newActuality - memory.actuality) > 1e-6) {
        store.update(memory.id, { actuality: newActuality });
        updated++;
      }
    }

    return updated;
  }
}
