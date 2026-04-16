import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { resolveConfig } from '../config.js';
import { createDatabase, createVecTable } from '../database.js';
import { MemoryStore } from '../memory-store.js';
import { HealthCalculator } from '../health.js';
import { getEmbeddingDimensions } from '../types.js';

export function registerOnboardCommand(program: Command): void {
  program
    .command('onboard')
    .description('Generate a project briefing from accumulated intelligence')
    .action(() => {
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

      const memories = store.list({ includeArchived: false, limit: 100000 });
      const projectName = basename(projectRoot);

      console.log(`\n# Project Briefing: ${projectName}\n`);
      console.log(`Intelligence Score: ${score.total}/100`);
      console.log(`Active Memories: ${memories.length}\n`);

      // Architecture & Decisions (high importance, long-term)
      const decisions = memories.filter(m =>
        m.importance >= 0.6 && (m.tier === 'long-term' || m.tier === 'operational')
      ).sort((a, b) => b.importance - a.importance);

      if (decisions.length > 0) {
        console.log('## Architecture & Decisions\n');
        for (const m of decisions.slice(0, 10)) {
          console.log(`- ${m.content.replace(/\n/g, ' ').trim()}`);
        }
        console.log();
      }

      // Conventions (tagged)
      const conventions = memories.filter(m =>
        m.tags.some(t => ['convention', 'style', 'pattern', 'best-practice'].includes(t))
      );

      if (conventions.length > 0) {
        console.log('## Conventions & Patterns\n');
        for (const m of conventions.slice(0, 10)) {
          console.log(`- ${m.content.replace(/\n/g, ' ').trim()}`);
        }
        console.log();
      }

      // Tech stack
      const stack = memories.filter(m =>
        m.tags.some(t => ['language', 'framework', 'dependency', 'infrastructure', 'tooling'].includes(t))
      );

      if (stack.length > 0) {
        console.log('## Tech Stack\n');
        for (const m of stack.slice(0, 15)) {
          console.log(`- ${m.content.replace(/\n/g, ' ').trim()}`);
        }
        console.log();
      }

      // Known issues / contradictions
      const issues: string[] = [];
      const seen = new Set<string>();
      for (const m of memories) {
        const connections = store.getConnectionsFor(m.id);
        for (const conn of connections) {
          if (conn.type !== 'contradicts') continue;
          const key = [conn.sourceId, conn.targetId].sort().join(':');
          if (seen.has(key)) continue;
          seen.add(key);

          const other = store.getById(conn.sourceId === m.id ? conn.targetId : conn.sourceId);
          if (other) {
            issues.push(`Conflict: "${truncate(m.content, 50)}" vs "${truncate(other.content, 50)}"`);
          }
        }
      }

      if (issues.length > 0) {
        console.log('## Open Questions & Contradictions\n');
        for (const issue of issues.slice(0, 5)) {
          console.log(`- ${issue}`);
        }
        console.log();
      }

      // Recent activity
      const recent = memories
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 5);

      if (recent.length > 0) {
        console.log('## Recent Activity\n');
        for (const m of recent) {
          const date = m.updatedAt.toLocaleDateString();
          console.log(`- [${date}] ${truncate(m.content, 70)}`);
        }
        console.log();
      }

      db.close();
    });
}

function truncate(s: string, max: number): string {
  const cleaned = s.replace(/\n/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max - 3) + '...' : cleaned;
}
