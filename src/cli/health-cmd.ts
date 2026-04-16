import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolveConfig } from '../config.js';
import { createDatabase, createVecTable } from '../database.js';
import { MemoryStore } from '../memory-store.js';
import { HealthCalculator, recordIntelligenceScore, getIntelligenceHistory, computeTrend } from '../health.js';
import { getEmbeddingDimensions } from '../types.js';
import type { HealthReport, IntelligenceScore } from '../types.js';

function scoreBar(value: number, width: number = 10): string {
  const filled = Math.round((value / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function trendIcon(trend: 'rising' | 'stable' | 'declining'): string {
  switch (trend) {
    case 'rising': return '+';
    case 'declining': return '-';
    case 'stable': return '=';
  }
}

export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = ['ctxcore health\n'];
  lines.push(`  Score: ${report.score}/100\n`);
  for (const detail of report.details) {
    lines.push(`  ${detail}`);
  }
  lines.push('');
  if (report.score >= 80) {
    lines.push('  Assessment: Healthy memory system.');
  } else if (report.score >= 50) {
    lines.push('  Assessment: Memory system needs attention.');
  } else if (report.score > 0) {
    lines.push('  Assessment: Memory system is weak. Consider adding more memories and connections.');
  } else {
    lines.push('  Assessment: No memories. Run `ctxcore init` and start storing memories.');
  }
  return lines.join('\n');
}

export function formatIntelligenceScore(score: IntelligenceScore, trend: 'rising' | 'stable' | 'declining'): string {
  const lines: string[] = [];
  const trendStr = trend === 'rising' ? ' (+)' : trend === 'declining' ? ' (-)' : '';

  lines.push(`  Intelligence Score: ${score.total}/100${trendStr}`);
  lines.push('');
  lines.push(`    Depth       ${scoreBar(score.depth)}  ${score.depth}%   ${score.memoryCounts.shortTerm + score.memoryCounts.operational + score.memoryCounts.longTerm} active memories`);

  const reflexionAge = score.lastReflexion
    ? formatTimeAgo(score.lastReflexion)
    : 'never';
  lines.push(`    Freshness   ${scoreBar(score.freshness)}  ${score.freshness}%   last reflexion ${reflexionAge}`);

  lines.push(`    Coherence   ${scoreBar(score.coherence)}  ${score.coherence}%   connected memory ratio`);
  lines.push(`    Coverage    ${scoreBar(score.coverage)}  ${score.coverage}%   memory count + tag diversity`);

  return lines.join('\n');
}

function formatTimeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function registerHealthCommand(program: Command): void {
  program
    .command('health')
    .description('Show intelligence score (0-100)')
    .option('--history', 'Show score history')
    .action((opts: { history?: boolean }) => {
      const projectRoot = process.cwd();
      const config = resolveConfig(projectRoot);

      if (!existsSync(config.dbPath)) {
        console.error('Not initialized. Run `ctxcore init` first.');
        process.exit(1);
      }

      const db = createDatabase(config.dbPath);
      createVecTable(db, getEmbeddingDimensions(config.ollamaModel));
      const store = new MemoryStore(db);
      const calculator = new HealthCalculator();
      const score = calculator.calculateIntelligence(store);
      const trend = computeTrend(db);
      score.trend = trend;

      console.log();
      console.log(formatIntelligenceScore(score, trend));

      if (opts.history) {
        const history = getIntelligenceHistory(db, 20);
        if (history.length > 0) {
          console.log('\n  Score History:');
          for (const entry of history.reverse()) {
            const date = entry.createdAt.toLocaleDateString();
            const bar = scoreBar(entry.scoreTotal, 15);
            console.log(`    ${date}  ${bar}  ${entry.scoreTotal}  (${entry.eventType})`);
          }
        } else {
          console.log('\n  No history yet.');
        }
      }

      console.log();
      db.close();
    });
}
