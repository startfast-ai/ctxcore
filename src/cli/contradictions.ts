import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolveConfig } from '../config.js';
import { createDatabase, createVecTable } from '../database.js';
import { MemoryStore } from '../memory-store.js';
import { getEmbeddingDimensions } from '../types.js';

export function registerContradictionsCommand(program: Command): void {
  program
    .command('contradictions')
    .description('Show contradictions in the knowledge base')
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

      // Find all contradiction connections
      const memories = store.list({ includeArchived: false, limit: 100000 });
      const contradictions: Array<{
        sourceId: string;
        targetId: string;
        sourceContent: string;
        targetContent: string;
        createdAt: Date;
      }> = [];

      const seen = new Set<string>();
      for (const m of memories) {
        const connections = store.getConnectionsFor(m.id);
        for (const conn of connections) {
          if (conn.type !== 'contradicts') continue;
          const key = [conn.sourceId, conn.targetId].sort().join(':');
          if (seen.has(key)) continue;
          seen.add(key);

          const source = store.getById(conn.sourceId);
          const target = store.getById(conn.targetId);
          if (!source || !target) continue;

          contradictions.push({
            sourceId: conn.sourceId,
            targetId: conn.targetId,
            sourceContent: source.content,
            targetContent: target.content,
            createdAt: conn.createdAt,
          });
        }
      }

      if (contradictions.length === 0) {
        console.log('\n  No contradictions found — knowledge base is coherent.\n');
        console.log('  Run `ctxcore reflect --contradictions` to scan for hidden conflicts.');
        db.close();
        return;
      }

      console.log(`\n  ${contradictions.length} contradiction(s) found:\n`);

      for (let i = 0; i < contradictions.length; i++) {
        const c = contradictions[i];
        const date = c.createdAt.toLocaleDateString();
        console.log(`  #${i + 1}  Detected: ${date}`);
        console.log(`     A: "${truncate(c.sourceContent, 80)}"  [${c.sourceId.slice(0, 8)}]`);
        console.log(`     B: "${truncate(c.targetContent, 80)}"  [${c.targetId.slice(0, 8)}]`);
        console.log();
      }

      console.log(`  Run \`ctxcore reflect --contradictions\` to resolve.\n`);
      db.close();
    });
}

function truncate(s: string, max: number): string {
  const cleaned = s.replace(/\n/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max - 3) + '...' : cleaned;
}
