import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolveConfig } from '../config.js';
import { createDatabase, createVecTable } from '../database.js';
import { getIntelligenceHistory } from '../health.js';
import { getEmbeddingDimensions } from '../types.js';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('Show intelligence score timeline')
    .option('-n, --limit <n>', 'Number of entries to show', '20')
    .action((opts: { limit: string }) => {
      const projectRoot = process.cwd();
      const config = resolveConfig(projectRoot);

      if (!existsSync(config.dbPath)) {
        console.error('Not initialized. Run `ctxcore init` first.');
        process.exit(1);
      }

      const db = createDatabase(config.dbPath);
      createVecTable(db, getEmbeddingDimensions(config.ollamaModel));

      const limit = parseInt(opts.limit, 10) || 20;
      const history = getIntelligenceHistory(db, limit);

      if (history.length === 0) {
        console.log('\n  No intelligence history yet.\n');
        console.log('  Score is recorded after init, sessions, and reflexion cycles.');
        db.close();
        return;
      }

      console.log('\n  Intelligence Score Timeline:\n');

      const maxBar = 20;
      for (const entry of history.reverse()) {
        const date = entry.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const filled = Math.round((entry.scoreTotal / 100) * maxBar);
        const bar = '█'.repeat(filled) + '░'.repeat(maxBar - filled);
        const padScore = String(entry.scoreTotal).padStart(3);
        const event = entry.eventType.padEnd(10);
        console.log(`    ${date.padEnd(8)} ${bar}  ${padScore}  ${event}`);
      }

      console.log();
      db.close();
    });
}
