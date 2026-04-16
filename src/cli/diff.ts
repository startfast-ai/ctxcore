import type { Command } from 'commander';
import type Database from 'better-sqlite3';
import type { MemoryEvent } from '../types.js';
import { existsSync } from 'node:fs';
import { resolveConfig } from '../config.js';
import { createDatabase, createVecTable } from '../database.js';
import { getEmbeddingDimensions } from '../types.js';

export interface DiffSummary {
  created: MemoryEvent[];
  promoted: MemoryEvent[];
  archived: MemoryEvent[];
  decayed: MemoryEvent[];
}

/**
 * Query memory_events since a given date and categorise them.
 */
export function queryEventsSince(db: Database.Database, since: Date): DiffSummary {
  const sinceStr = since.toISOString();

  const rows = db
    .prepare('SELECT * FROM memory_events WHERE created_at >= ? ORDER BY created_at ASC')
    .all(sinceStr) as Record<string, unknown>[];

  const events: MemoryEvent[] = rows.map((row) => ({
    id: row.id as string,
    memoryId: row.memory_id as string,
    eventType: row.event_type as MemoryEvent['eventType'],
    data: JSON.parse(row.data as string),
    createdAt: new Date(row.created_at as string),
  }));

  const summary: DiffSummary = {
    created: [],
    promoted: [],
    archived: [],
    decayed: [],
  };

  for (const event of events) {
    switch (event.eventType) {
      case 'created':
        summary.created.push(event);
        break;
      case 'promoted':
        summary.promoted.push(event);
        break;
      case 'archived':
        summary.archived.push(event);
        break;
      case 'decayed':
        summary.decayed.push(event);
        break;
    }
  }

  return summary;
}

export function formatDiff(summary: DiffSummary, since: Date): string {
  const lines: string[] = [`Memory changes since ${since.toISOString()}\n`];

  if (summary.created.length > 0) {
    lines.push(`+ ${summary.created.length} new memories`);
    for (const e of summary.created) {
      lines.push(`  + [${e.memoryId}] ${e.createdAt.toISOString()}`);
    }
  }

  if (summary.promoted.length > 0) {
    lines.push(`^ ${summary.promoted.length} promoted memories`);
    for (const e of summary.promoted) {
      lines.push(`  ^ [${e.memoryId}] ${e.createdAt.toISOString()}`);
    }
  }

  if (summary.decayed.length > 0) {
    lines.push(`v ${summary.decayed.length} decayed memories`);
    for (const e of summary.decayed) {
      lines.push(`  v [${e.memoryId}] ${e.createdAt.toISOString()}`);
    }
  }

  if (summary.archived.length > 0) {
    lines.push(`- ${summary.archived.length} archived memories`);
    for (const e of summary.archived) {
      lines.push(`  - [${e.memoryId}] ${e.createdAt.toISOString()}`);
    }
  }

  const total =
    summary.created.length + summary.promoted.length + summary.decayed.length + summary.archived.length;

  if (total === 0) {
    lines.push('No memory changes in this period.');
  } else {
    lines.push(`\n${total} total events.`);
  }

  return lines.join('\n');
}

function parseSinceDate(since: string): Date {
  // Support "yesterday", "1d", "7d", "2w", or ISO date strings
  const now = Date.now();
  if (since === 'yesterday') return new Date(now - 24 * 60 * 60 * 1000);
  const match = since.match(/^(\d+)([dhwm])$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const ms: Record<string, number> = {
      d: 24 * 60 * 60 * 1000,
      h: 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      m: 30 * 24 * 60 * 60 * 1000,
    };
    return new Date(now - n * ms[unit]);
  }
  const parsed = new Date(since);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Cannot parse date: "${since}". Use ISO format, "yesterday", or "7d".`);
  }
  return parsed;
}

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Show memory changes over time')
    .requiredOption('--since <date>', 'Show changes since date (ISO, "yesterday", "7d", "2w")')
    .action((opts: { since: string }) => {
      const projectRoot = process.cwd();
      const config = resolveConfig(projectRoot);

      if (!existsSync(config.dbPath)) {
        console.error('Not initialized. Run `ctxcore init` first.');
        process.exit(1);
      }

      let since: Date;
      try {
        since = parseSinceDate(opts.since);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
        return; // unreachable, for TS
      }

      const db = createDatabase(config.dbPath);
      createVecTable(db, getEmbeddingDimensions(config.ollamaModel));
      const summary = queryEventsSince(db, since);
      console.log(formatDiff(summary, since));
      db.close();
    });
}
