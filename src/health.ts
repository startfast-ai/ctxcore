import type Database from 'better-sqlite3';
import type { IHealthCalculator, IMemoryStore, HealthReport, IntelligenceScore, IntelligenceHistoryEntry } from './types.js';
import { getLastReflexionTime } from './scheduler.js';

const EXPECTED_MIN_MEMORIES = 10;
const GOOD_MEMORY_TARGET = 50;

export class HealthCalculator implements IHealthCalculator {
  calculate(store: IMemoryStore): HealthReport {
    const score = this.calculateIntelligence(store);
    return {
      score: score.total,
      coverage: score.coverage,
      freshness: score.freshness,
      depth: score.depth,
      coherence: score.coherence,
      details: this.buildDetails(score, store),
    };
  }

  calculateIntelligence(store: IMemoryStore): IntelligenceScore {
    const memories = store.list({ includeArchived: false, limit: 100000 });
    const total = memories.length;

    const shortTerm = memories.filter(m => m.tier === 'short-term').length;
    const operational = memories.filter(m => m.tier === 'operational').length;
    const longTerm = memories.filter(m => m.tier === 'long-term').length;

    // ── Knowledge Depth (25%) ──
    // Memory count weighted by tier and importance
    let depth = 0;
    if (total > 0) {
      const tierWeights = { 'short-term': 0.3, 'operational': 0.6, 'long-term': 1.0 };
      let weightedSum = 0;
      for (const m of memories) {
        const tierWeight = tierWeights[m.tier] ?? 0.3;
        weightedSum += tierWeight * (1 + m.importance);
      }
      // Normalize: a project with 50+ well-classified memories scores 100
      depth = Math.min(100, (weightedSum / GOOD_MEMORY_TARGET) * 100);
    }

    // ── Freshness (25%) ──
    // Weighted average: high-importance memories matter more for freshness
    let freshness = 0;
    if (total > 0) {
      let weightedActuality = 0;
      let weightSum = 0;
      for (const m of memories) {
        const weight = 0.5 + m.importance;
        weightedActuality += m.actuality * weight;
        weightSum += weight;
      }
      freshness = (weightedActuality / weightSum) * 100;
    }

    // ── Coherence (25%) ──
    // Connected memory count (logarithmic) — adding memories never lowers this
    let coherence = 0;
    if (total > 0) {
      let connectedCount = 0;
      for (const m of memories) {
        const connections = store.getConnectionsFor(m.id);
        if (connections.length > 0) connectedCount++;
      }
      // 20+ connected memories = 100%. Logarithmic so first connections matter most.
      const CONNECTED_TARGET = 20;
      coherence = Math.min(100, (connectedCount / CONNECTED_TARGET) * 100);
    }

    // ── Coverage (25%) ──
    // Memory count (logarithmic) + tag diversity — always grows with more knowledge
    let coverage = 0;
    if (total > 0) {
      // Log scale: 10 memories = ~58%, 50 = ~85%, 100 = ~100%
      const countScore = Math.min(1, Math.log(total + 1) / Math.log(GOOD_MEMORY_TARGET + 1));
      const allTags = new Set(memories.flatMap(m => m.tags));
      const tagDiversity = Math.min(1, allTags.size / 8); // 8+ unique tags = full score
      coverage = ((countScore * 0.6 + tagDiversity * 0.4)) * 100;
    }

    const totalScore = Math.round((depth + freshness + coherence + coverage) / 4);

    return {
      total: totalScore,
      depth: Math.round(depth),
      freshness: Math.round(freshness),
      coherence: Math.round(coherence),
      coverage: Math.round(coverage),
      trend: 'stable', // Will be computed from history
      lastReflexion: getLastReflexionTime(),
      memoryCounts: { shortTerm, operational, longTerm },
    };
  }

  private buildDetails(score: IntelligenceScore, _store: IMemoryStore): string[] {
    const details: string[] = [];
    const { memoryCounts } = score;
    const total = memoryCounts.shortTerm + memoryCounts.operational + memoryCounts.longTerm;

    details.push(`Depth: ${score.depth}% — ${total} memories (${memoryCounts.longTerm} long-term, ${memoryCounts.operational} operational)`);
    details.push(`Freshness: ${score.freshness}% — average actuality across active memories`);
    details.push(`Coherence: ${score.coherence}% — ratio of connected memories`);
    details.push(`Coverage: ${score.coverage}% — memory count + tag diversity`);

    return details;
  }
}

// ── Intelligence History ──

export function recordIntelligenceScore(
  db: Database.Database,
  score: IntelligenceScore,
  eventType: IntelligenceHistoryEntry['eventType'],
): void {
  db.prepare(`
    INSERT INTO intelligence_history (score_total, score_depth, score_freshness, score_coherence, score_coverage, event_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(score.total, score.depth, score.freshness, score.coherence, score.coverage, eventType);
}

export function getIntelligenceHistory(
  db: Database.Database,
  limit: number = 30,
): IntelligenceHistoryEntry[] {
  const rows = db.prepare(`
    SELECT id, score_total, score_depth, score_freshness, score_coherence, score_coverage, event_type, created_at
    FROM intelligence_history
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number;
    score_total: number;
    score_depth: number;
    score_freshness: number;
    score_coherence: number;
    score_coverage: number;
    event_type: string;
    created_at: string;
  }>;

  return rows.map(r => ({
    id: r.id,
    scoreTotal: r.score_total,
    scoreDepth: r.score_depth,
    scoreFreshness: r.score_freshness,
    scoreCoherence: r.score_coherence,
    scoreCoverage: r.score_coverage,
    eventType: r.event_type as IntelligenceHistoryEntry['eventType'],
    createdAt: new Date(r.created_at),
  }));
}

export function computeTrend(db: Database.Database): 'rising' | 'stable' | 'declining' {
  const history = getIntelligenceHistory(db, 5);
  if (history.length < 2) return 'stable';

  const recent = history[0].scoreTotal;
  const older = history[history.length - 1].scoreTotal;
  const diff = recent - older;

  if (diff > 3) return 'rising';
  if (diff < -3) return 'declining';
  return 'stable';
}
