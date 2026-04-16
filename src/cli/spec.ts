import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolveConfig } from '../config.js';
import { createDatabase, createVecTable } from '../database.js';
import { TaskStore } from '../tasks.js';
import { SpecStore } from '../specs.js';
import { getEmbeddingDimensions } from '../types.js';
import type { SpecStatus } from '../types.js';

// ── Color helpers ──

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';

const STATUS_BADGE: Record<SpecStatus, string> = {
  draft: `${YELLOW} draft ${RESET}`,
  'in-review': `${BLUE} in-review ${RESET}`,
  approved: `${GREEN} approved ${RESET}`,
  'in-progress': `${MAGENTA} in-progress ${RESET}`,
  completed: `${DIM} completed ${RESET}`,
  archived: `${DIM} archived ${RESET}`,
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatTags(tags: string[]): string {
  if (tags.length === 0) return '';
  return tags.map((t) => `${CYAN}#${t}${RESET}`).join(' ');
}

export function registerSpecCommand(program: Command): void {
  const specCmd = program
    .command('spec')
    .description('Manage specifications');

  // ── spec create ──
  specCmd
    .command('create')
    .description('Create a new spec')
    .argument('<title>', 'Spec title')
    .option('--tag <tags...>', 'Tags')
    .option('-s, --status <status>', 'Initial status (draft, in-review, approved)', 'draft')
    .option('-c, --content <content>', 'Initial content')
    .action(
      (
        title: string,
        opts: {
          tag?: string[];
          status?: string;
          content?: string;
        },
      ) => {
        const projectRoot = process.cwd();
        ensureInit(projectRoot);
        const specStore = new SpecStore(projectRoot);

        const spec = specStore.create({
          title,
          tags: opts.tag,
          status: (opts.status as SpecStatus) ?? 'draft',
          content: opts.content,
        });

        console.log(`\n  ${GREEN}Created spec${RESET} ${DIM}${spec.id}${RESET}`);
        console.log(`  Title:   ${BOLD}${spec.title}${RESET}`);
        console.log(`  Status:  ${STATUS_BADGE[spec.status] ?? spec.status}`);
        if (spec.tags.length > 0) console.log(`  Tags:    ${formatTags(spec.tags)}`);
        console.log(`  File:    ${DIM}${spec.filePath}${RESET}`);
        console.log();
      },
    );

  // ── spec list ──
  specCmd
    .command('list')
    .description('List specs with optional filters')
    .option('-s, --status <status>', 'Filter by status')
    .option('--tag <tag>', 'Filter by tag')
    .action((opts: { status?: string; tag?: string }) => {
      const projectRoot = process.cwd();
      ensureInit(projectRoot);
      const specStore = new SpecStore(projectRoot);

      const specs = specStore.list({
        status: opts.status as SpecStatus | undefined,
        tags: opts.tag ? [opts.tag] : undefined,
      });

      if (specs.length === 0) {
        console.log('\n  No specs found.\n');
        return;
      }

      console.log(`\n  ${BOLD}Specs${RESET} (${specs.length})\n`);

      for (const s of specs) {
        const status = STATUS_BADGE[s.status] ?? s.status;
        const tags = formatTags(s.tags);
        const titleStr = s.title.length > 50 ? s.title.slice(0, 47) + '...' : s.title;
        console.log(`  ${DIM}${s.id}${RESET} ${status} ${BOLD}${titleStr}${RESET} ${tags}`);
      }
      console.log();
    });

  // ── spec show ──
  specCmd
    .command('show')
    .description('Show spec content')
    .argument('<id>', 'Spec ID (slug)')
    .action((id: string) => {
      const projectRoot = process.cwd();
      ensureInit(projectRoot);
      const specStore = new SpecStore(projectRoot);

      const spec = specStore.getById(id);
      if (!spec) {
        console.error(`Spec not found: ${id}`);
        process.exit(1);
      }

      console.log(`\n  ${BOLD}${spec.title}${RESET}`);
      console.log(`  Status: ${STATUS_BADGE[spec.status] ?? spec.status}`);
      if (spec.tags.length > 0) console.log(`  Tags:   ${formatTags(spec.tags)}`);
      console.log(`  File:   ${DIM}${spec.filePath}${RESET}`);
      console.log(`  Created: ${formatDate(spec.createdAt)}  Updated: ${formatDate(spec.updatedAt)}`);
      console.log();

      if (spec.content) {
        console.log(spec.content);
        console.log();
      }
    });

  // ── spec history ──
  specCmd
    .command('history')
    .description('Show version history for a spec')
    .argument('<id>', 'Spec ID (slug)')
    .action((id: string) => {
      const projectRoot = process.cwd();
      ensureInit(projectRoot);
      const specStore = new SpecStore(projectRoot);

      const spec = specStore.getById(id);
      if (!spec) {
        console.error(`Spec not found: ${id}`);
        process.exit(1);
      }

      const versions = specStore.getVersions(id);
      if (versions.length === 0) {
        console.log(`\n  No version history for ${id}.\n`);
        return;
      }

      console.log(`\n  ${BOLD}Version History${RESET} — ${spec.title}\n`);

      for (const v of versions) {
        const date = formatDate(v.timestamp);
        const commit = v.gitCommit ? ` ${DIM}(${v.gitCommit.slice(0, 7)})${RESET}` : '';
        console.log(`  ${BOLD}v${v.version}${RESET}  ${DIM}${date}${RESET}  ${v.author}  ${v.summary}${commit}`);
      }
      console.log();
    });

  // ── spec link ──
  specCmd
    .command('link')
    .description('Link a spec to a task')
    .argument('<spec-id>', 'Spec ID (slug)')
    .option('--task <task-id>', 'Task ID to link')
    .option('--type <link-type>', 'Link type (implements, related, blocked_by)', 'related')
    .action(
      (
        specId: string,
        opts: { task?: string; type?: string },
      ) => {
        const projectRoot = process.cwd();
        const { db } = ensureInit(projectRoot);
        const specStore = new SpecStore(projectRoot);
        const taskStore = new TaskStore(db);

        const spec = specStore.getById(specId);
        if (!spec) {
          console.error(`Spec not found: ${specId}`);
          db.close();
          process.exit(1);
        }

        if (!opts.task) {
          console.error('Specify --task <task-id>');
          db.close();
          process.exit(1);
        }

        const task = findTaskByPrefix(taskStore, db, opts.task);
        if (!task) {
          console.error(`Task not found: ${opts.task}`);
          db.close();
          process.exit(1);
        }

        const linkType = (opts.type ?? 'related') as 'implements' | 'related' | 'blocked_by';
        taskStore.linkSpec(task.id, specId, linkType);

        console.log(
          `\n  ${GREEN}Linked${RESET} spec ${DIM}${specId}${RESET} ↔ task ${DIM}${task.id.slice(0, 8)}${RESET} [${linkType}]\n`,
        );

        db.close();
      },
    );
}

function ensureInit(projectRoot: string): {
  db: ReturnType<typeof createDatabase>;
  config: ReturnType<typeof resolveConfig>;
} {
  const config = resolveConfig(projectRoot);
  if (!existsSync(config.dbPath)) {
    console.error('Not initialized. Run `ctxcore init` first.');
    process.exit(1);
  }
  const db = createDatabase(config.dbPath);
  createVecTable(db, getEmbeddingDimensions(config.ollamaModel));
  return { db, config };
}

/**
 * Find a task by full ID or prefix match.
 */
function findTaskByPrefix(
  taskStore: TaskStore,
  db: ReturnType<typeof createDatabase>,
  idOrPrefix: string,
): import('../types.js').Task | null {
  const exact = taskStore.getById(idOrPrefix);
  if (exact) return exact;

  const rows = db
    .prepare('SELECT * FROM tasks WHERE id LIKE ? LIMIT 2')
    .all(`${idOrPrefix}%`) as Array<Record<string, unknown>>;

  if (rows.length === 1) {
    return taskStore.getById(rows[0].id as string);
  }
  if (rows.length > 1) {
    console.error(`Ambiguous ID prefix "${idOrPrefix}" — matches multiple tasks.`);
    return null;
  }
  return null;
}
