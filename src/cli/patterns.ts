import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolveConfig } from '../config.js';
import { createDatabase, createVecTable } from '../database.js';
import { MemoryStore } from '../memory-store.js';
import { getEmbeddingDimensions } from '../types.js';

export function registerPatternsCommand(program: Command): void {
  program
    .command('patterns')
    .description('Show detected patterns in the knowledge base')
    .option('--days <n>', 'Show patterns from last N days', '30')
    .action((opts: { days: string }) => {
      const projectRoot = process.cwd();
      const config = resolveConfig(projectRoot);

      if (!existsSync(config.dbPath)) {
        console.error('Not initialized. Run `ctxcore init` first.');
        process.exit(1);
      }

      const db = createDatabase(config.dbPath);
      createVecTable(db, getEmbeddingDimensions(config.ollamaModel));
      const store = new MemoryStore(db);

      const memories = store.list({ includeArchived: false, limit: 100000 });
      const days = parseInt(opts.days, 10) || 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Find pattern connections
      const patterns: Array<{
        memoryIds: string[];
        contents: string[];
        type: string;
      }> = [];

      const seen = new Set<string>();
      for (const m of memories) {
        const connections = store.getConnectionsFor(m.id);
        const patternConns = connections.filter(c => c.type === 'similar' || c.type === 'supports');

        if (patternConns.length >= 2) {
          const key = m.id;
          if (seen.has(key)) continue;
          seen.add(key);

          const relatedIds = patternConns.map(c => c.sourceId === m.id ? c.targetId : c.sourceId);
          const relatedContents = relatedIds
            .map(id => store.getById(id))
            .filter(Boolean)
            .map(mem => mem!.content);

          patterns.push({
            memoryIds: [m.id, ...relatedIds],
            contents: [m.content, ...relatedContents],
            type: patternConns[0].type,
          });
        }
      }

      // Find tag clusters (recurring themes)
      const tagCounts: Record<string, string[]> = {};
      const recentMemories = memories.filter(m => m.createdAt >= cutoff);
      for (const m of recentMemories) {
        for (const tag of m.tags) {
          if (!tagCounts[tag]) tagCounts[tag] = [];
          tagCounts[tag].push(m.id);
        }
      }

      const frequentTags = Object.entries(tagCounts)
        .filter(([_, ids]) => ids.length >= 3)
        .sort((a, b) => b[1].length - a[1].length);

      if (patterns.length === 0 && frequentTags.length === 0) {
        console.log('\n  No patterns detected yet.\n');
        console.log('  Run `ctxcore reflect --patterns` to analyze the knowledge base.');
        db.close();
        return;
      }

      console.log(`\n  Patterns detected (last ${days} days):\n`);

      let idx = 1;

      // Show graph-based patterns
      for (const p of patterns.slice(0, 10)) {
        console.log(`  ${idx}. Cluster of ${p.memoryIds.length} related memories (${p.type})`);
        for (const content of p.contents.slice(0, 3)) {
          console.log(`     - ${truncate(content, 70)}`);
        }
        if (p.contents.length > 3) {
          console.log(`     ... and ${p.contents.length - 3} more`);
        }
        console.log();
        idx++;
      }

      // Show tag-based patterns
      if (frequentTags.length > 0) {
        console.log('  Recurring themes:');
        for (const [tag, ids] of frequentTags.slice(0, 10)) {
          console.log(`    ${tag}: ${ids.length} memories in last ${days} days`);
        }
        console.log();
      }

      console.log(`  Run \`ctxcore reflect --patterns\` for deeper analysis.\n`);
      db.close();
    });
}

function truncate(s: string, max: number): string {
  const cleaned = s.replace(/\n/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max - 3) + '...' : cleaned;
}
