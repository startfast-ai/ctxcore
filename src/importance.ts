import type { IImportanceClassifier, ImportanceLevel } from './types.js';

interface PatternGroup {
  patterns: RegExp[];
  weight: number;
}

/**
 * Auto-classifies memory content into importance levels by analyzing
 * linguistic signals: decision language, error/fix patterns, scope
 * indicators, and breakthrough signals.
 */
export class ImportanceClassifier implements IImportanceClassifier {
  private readonly breakthroughPatterns: PatternGroup = {
    patterns: [
      /\b(discovered|realized|key insight|root cause|eureka|fundamental|revelation)\b/i,
      /\b(breakthrough|critical finding|the real issue|finally found|turns out)\b/i,
      /\b(underlying problem|the actual reason|game.?changer)\b/i,
    ],
    weight: 0.9,
  };

  private readonly decisionPatterns: PatternGroup = {
    patterns: [
      /\b(chose|decided|selected|opted for|went with|picked)\b/i,
      /\b(architecture|migration|design decision|trade.?off|approach)\b/i,
      /\b(strategy|adopted|committed to|settled on|evaluated)\b/i,
      /\b(over|instead of|rather than|compared to)\b.*\b(because|due to|for)\b/i,
    ],
    weight: 0.7,
  };

  private readonly operationalPatterns: PatternGroup = {
    patterns: [
      /\b(bug|fix|fixed|resolved|patched|workaround|error)\b/i,
      /\b(implemented|added|created|built|refactored|updated)\b/i,
      /\b(configured|deployed|setup|installed|integrated)\b/i,
      /\b(timeout|retry|fallback|handled|exception)\b/i,
    ],
    weight: 0.45,
  };

  private readonly routinePatterns: PatternGroup = {
    patterns: [
      /\b(renamed|reformatted|formatting|typo|whitespace)\b/i,
      /\b(minor|trivial|cleanup|cosmetic|lint)\b/i,
      /\b(moved|reorganized|sorted|alphabetized)\b/i,
    ],
    weight: 0.2,
  };

  classify(content: string): { level: ImportanceLevel; score: number } {
    const scores = {
      breakthrough: this.matchScore(content, this.breakthroughPatterns),
      decision: this.matchScore(content, this.decisionPatterns),
      operational: this.matchScore(content, this.operationalPatterns),
      routine: this.matchScore(content, this.routinePatterns),
    };

    // Find the highest-scoring category
    let bestLevel: ImportanceLevel = 'routine';
    let bestScore = scores.routine;

    if (scores.operational > bestScore) {
      bestLevel = 'operational';
      bestScore = scores.operational;
    }
    if (scores.decision > bestScore) {
      bestLevel = 'decision';
      bestScore = scores.decision;
    }
    if (scores.breakthrough > bestScore) {
      bestLevel = 'breakthrough';
      bestScore = scores.breakthrough;
    }

    // If nothing matched meaningfully, default to routine with a base score
    if (bestScore < 0.1) {
      return { level: 'routine', score: 0.15 };
    }

    // Clamp score to the level's expected range
    const score = this.clampToRange(bestLevel, bestScore);

    return { level: bestLevel, score };
  }

  private matchScore(content: string, group: PatternGroup): number {
    let matches = 0;
    for (const pattern of group.patterns) {
      if (pattern.test(content)) {
        matches++;
      }
    }

    if (matches === 0) return 0;

    // More pattern matches → higher confidence within the group's weight
    const matchRatio = matches / group.patterns.length;
    // Base weight + bonus for multiple matches (up to 0.15 bonus)
    return group.weight + matchRatio * 0.15;
  }

  private clampToRange(level: ImportanceLevel, score: number): number {
    const ranges: Record<ImportanceLevel, [number, number]> = {
      routine: [0.1, 0.3],
      operational: [0.3, 0.6],
      decision: [0.6, 0.8],
      breakthrough: [0.8, 1.0],
    };

    const [min, max] = ranges[level];
    return Math.max(min, Math.min(max, score));
  }
}
