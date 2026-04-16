import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolveConfig } from '../config.js';
import { createDatabase, createVecTable } from '../database.js';
import { MemoryStore } from '../memory-store.js';
import { TaskStore } from '../tasks.js';
import { SpecStore } from '../specs.js';
import { getEmbeddingDimensions } from '../types.js';
import type { Task, TaskPriority, KanbanColumn } from '../types.js';

// ── Color helpers ──

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  critical: `${RED}${BOLD} CRIT ${RESET}`,
  high: `${RED} HIGH ${RESET}`,
  medium: `${YELLOW} MED  ${RESET}`,
  low: `${DIM} LOW  ${RESET}`,
};

const STATUS_BADGE: Record<string, string> = {
  open: `${GREEN} open ${RESET}`,
  'in-progress': `${BLUE} in-progress ${RESET}`,
  done: `${DIM} done ${RESET}`,
  archived: `${DIM} archived ${RESET}`,
};

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatTags(tags: string[]): string {
  if (tags.length === 0) return '';
  return tags.map((t) => `${CYAN}#${t}${RESET}`).join(' ');
}

function ensureInit(projectRoot: string): {
  db: ReturnType<typeof createDatabase>;
  taskStore: TaskStore;
  config: ReturnType<typeof resolveConfig>;
} {
  const config = resolveConfig(projectRoot);
  if (!existsSync(config.dbPath)) {
    console.error('Not initialized. Run `ctxcore init` first.');
    process.exit(1);
  }
  const db = createDatabase(config.dbPath);
  createVecTable(db, getEmbeddingDimensions(config.ollamaModel));
  const taskStore = new TaskStore(db);
  return { db, taskStore, config };
}

/**
 * Resolve a column name (e.g. "in-progress", "review") to a column ID.
 * Seeds default columns if none exist.
 */
function resolveColumn(
  taskStore: TaskStore,
  db: ReturnType<typeof createDatabase>,
  columnName: string,
  projectId: string,
): KanbanColumn | null {
  // Ensure columns exist
  taskStore.seedDefaultColumns(projectId);

  const rows = db
    .prepare('SELECT * FROM kanban_columns WHERE project_id = ? ORDER BY column_order ASC')
    .all(projectId) as Array<Record<string, unknown>>;

  const normalised = columnName.toLowerCase().replace(/[\s_]+/g, '-');

  for (const row of rows) {
    const title = (row.title as string).toLowerCase().replace(/[\s_]+/g, '-');
    if (title === normalised) {
      return {
        id: row.id as string,
        projectId: row.project_id as string,
        title: row.title as string,
        columnOrder: row.column_order as number,
        wipLimit: (row.wip_limit as number) ?? null,
        color: (row.color as string) ?? null,
      };
    }
  }
  return null;
}

function getProjectId(): string {
  return process.cwd();
}

export function registerTaskCommand(program: Command): void {
  const taskCmd = program
    .command('task')
    .description('Manage tasks and kanban board');

  // ── task create ──
  taskCmd
    .command('create')
    .description('Create a new task')
    .argument('<title>', 'Task title')
    .option('-p, --priority <priority>', 'Priority: low, medium, high, critical', 'medium')
    .option('-a, --assignee <assignee>', 'Assignee (e.g. human, ai)')
    .option('--tag <tags...>', 'Tags')
    .option('-d, --description <desc>', 'Task description')
    .option('--column <column>', 'Kanban column name (e.g. backlog, todo, in-progress)')
    .action(
      (
        title: string,
        opts: {
          priority?: string;
          assignee?: string;
          tag?: string[];
          description?: string;
          column?: string;
        },
      ) => {
        const projectRoot = process.cwd();
        const { db, taskStore } = ensureInit(projectRoot);
        const projectId = getProjectId();

        // Seed default columns
        taskStore.seedDefaultColumns(projectId);

        // Default to backlog column if not specified
        const columnName = opts.column ?? 'backlog';
        const col = resolveColumn(taskStore, db, columnName, projectId);
        if (!col) {
          console.error(`Column not found: "${columnName}"`);
          console.error('Available columns: Backlog, Todo, In Progress, Review, Done');
          db.close();
          process.exit(1);
        }
        const columnId = col.id;

        const task = taskStore.create({
          projectId,
          title,
          description: opts.description,
          priority: (opts.priority as TaskPriority) ?? 'medium',
          assignee: opts.assignee,
          tags: opts.tag,
          columnId,
          createdBy: 'human',
        });

        console.log(`\n  ${GREEN}Created task${RESET} ${DIM}${task.id.slice(0, 8)}${RESET}`);
        console.log(`  Title:    ${BOLD}${task.title}${RESET}`);
        console.log(`  Priority: ${PRIORITY_BADGE[task.priority]}`);
        console.log(`  Status:   ${STATUS_BADGE[task.status] ?? task.status}`);
        if (task.assignee) console.log(`  Assignee: ${task.assignee}`);
        if (task.tags.length > 0) console.log(`  Tags:     ${formatTags(task.tags)}`);
        console.log();

        db.close();
      },
    );

  // ── task list ──
  taskCmd
    .command('list')
    .description('List tasks with optional filters')
    .option('-s, --status <status>', 'Filter by status (open, in-progress, done, archived)')
    .option('-c, --column <column>', 'Filter by kanban column name')
    .option('-a, --assignee <assignee>', 'Filter by assignee')
    .option('--tag <tag>', 'Filter by tag')
    .option('-n, --limit <n>', 'Max results', parseInt)
    .action(
      (opts: {
        status?: string;
        column?: string;
        assignee?: string;
        tag?: string;
        limit?: number;
      }) => {
        const projectRoot = process.cwd();
        const { db, taskStore } = ensureInit(projectRoot);
        const projectId = getProjectId();

        let columnId: string | undefined;
        if (opts.column) {
          const col = resolveColumn(taskStore, db, opts.column, projectId);
          if (!col) {
            console.error(`Column not found: "${opts.column}"`);
            db.close();
            process.exit(1);
          }
          columnId = col.id;
        }

        const tasks = taskStore.list({
          status: opts.status as Task['status'],
          columnId,
          assignee: opts.assignee,
          tag: opts.tag,
          limit: opts.limit,
        });

        if (tasks.length === 0) {
          console.log('\n  No tasks found.\n');
          db.close();
          return;
        }

        console.log(`\n  ${BOLD}Tasks${RESET} (${tasks.length})\n`);

        for (const t of tasks) {
          const id = DIM + t.id.slice(0, 8) + RESET;
          const pri = PRIORITY_BADGE[t.priority];
          const status = STATUS_BADGE[t.status] ?? t.status;
          const titleStr = t.title.length > 60 ? t.title.slice(0, 57) + '...' : t.title;
          const tags = formatTags(t.tags);
          const assignee = t.assignee ? `${DIM}@${t.assignee}${RESET}` : '';

          console.log(`  ${id} ${pri} ${status} ${BOLD}${titleStr}${RESET} ${tags} ${assignee}`);
        }
        console.log();

        db.close();
      },
    );

  // ── task show ──
  taskCmd
    .command('show')
    .description('Show full task detail')
    .argument('<id>', 'Task ID (full or prefix)')
    .action((id: string) => {
      const projectRoot = process.cwd();
      const { db, taskStore } = ensureInit(projectRoot);

      const task = findTaskByPrefix(taskStore, db, id);
      if (!task) {
        console.error(`Task not found: ${id}`);
        db.close();
        process.exit(1);
      }

      console.log(`\n  ${BOLD}Task${RESET} ${DIM}${task.id}${RESET}`);
      console.log(`  Title:       ${BOLD}${task.title}${RESET}`);
      console.log(`  Priority:    ${PRIORITY_BADGE[task.priority]}`);
      console.log(`  Status:      ${STATUS_BADGE[task.status] ?? task.status}`);
      if (task.assignee) console.log(`  Assignee:    ${task.assignee}`);
      if (task.tags.length > 0) console.log(`  Tags:        ${formatTags(task.tags)}`);
      if (task.description) console.log(`  Description: ${task.description}`);
      console.log(`  Created:     ${formatDate(task.createdAt)}`);
      console.log(`  Updated:     ${formatDate(task.updatedAt)}`);
      if (task.completedAt) console.log(`  Completed:   ${formatDate(task.completedAt)}`);

      // Comments
      const comments = taskStore.getComments(task.id);
      if (comments.length > 0) {
        console.log(`\n  ${BOLD}Comments${RESET} (${comments.length})\n`);
        for (const c of comments) {
          const authorColor = c.authorType === 'ai' ? MAGENTA : CYAN;
          console.log(
            `  ${DIM}${formatDate(c.createdAt)}${RESET} ${authorColor}${c.author}${RESET}: ${c.content}`,
          );
        }
      }

      // Linked memories
      const memLinks = taskStore.getLinkedMemories(task.id);
      if (memLinks.length > 0) {
        console.log(`\n  ${BOLD}Linked Memories${RESET} (${memLinks.length})\n`);
        for (const link of memLinks) {
          console.log(`  ${DIM}${link.memoryId.slice(0, 8)}${RESET} [${link.linkType}]`);
        }
      }

      // Linked specs
      const specLinks = taskStore.getLinkedSpecs(task.id);
      if (specLinks.length > 0) {
        console.log(`\n  ${BOLD}Linked Specs${RESET} (${specLinks.length})\n`);
        for (const link of specLinks) {
          console.log(`  ${DIM}${link.specId}${RESET} [${link.linkType}]`);
        }
      }

      console.log();
      db.close();
    });

  // ── task move ──
  taskCmd
    .command('move')
    .description('Move a task to a kanban column')
    .argument('<id>', 'Task ID (full or prefix)')
    .argument('<column>', 'Target column name (e.g. in-progress, review, done)')
    .action((id: string, columnName: string) => {
      const projectRoot = process.cwd();
      const { db, taskStore } = ensureInit(projectRoot);
      const projectId = getProjectId();

      const task = findTaskByPrefix(taskStore, db, id);
      if (!task) {
        console.error(`Task not found: ${id}`);
        db.close();
        process.exit(1);
      }

      const col = resolveColumn(taskStore, db, columnName, projectId);
      if (!col) {
        console.error(`Column not found: "${columnName}"`);
        console.error('Available columns: Backlog, Todo, In Progress, Review, Done');
        db.close();
        process.exit(1);
      }

      if (taskStore.isColumnAtLimit(col.id)) {
        console.error(`Column "${col.title}" is at its WIP limit.`);
        db.close();
        process.exit(1);
      }

      // Derive status from column name
      const statusMap: Record<string, Task['status']> = {
        backlog: 'open',
        todo: 'open',
        'in-progress': 'in-progress',
        review: 'in-progress',
        done: 'done',
      };
      const normalised = col.title.toLowerCase().replace(/[\s_]+/g, '-');
      const newStatus = statusMap[normalised] ?? task.status;

      taskStore.move(task.id, col.id, Date.now());
      if (newStatus !== task.status) {
        taskStore.update(task.id, { status: newStatus });
      }

      console.log(
        `\n  ${GREEN}Moved${RESET} ${DIM}${task.id.slice(0, 8)}${RESET} → ${BOLD}${col.title}${RESET}\n`,
      );

      db.close();
    });

  // ── task comment ──
  taskCmd
    .command('comment')
    .description('Add a comment to a task')
    .argument('<id>', 'Task ID (full or prefix)')
    .argument('<text>', 'Comment text')
    .action((id: string, text: string) => {
      const projectRoot = process.cwd();
      const { db, taskStore } = ensureInit(projectRoot);

      const task = findTaskByPrefix(taskStore, db, id);
      if (!task) {
        console.error(`Task not found: ${id}`);
        db.close();
        process.exit(1);
      }

      const comment = taskStore.addComment(task.id, 'human', 'human', text);
      console.log(
        `\n  ${GREEN}Comment added${RESET} to ${DIM}${task.id.slice(0, 8)}${RESET} ${DIM}(${comment.id.slice(0, 8)})${RESET}\n`,
      );

      db.close();
    });

  // ── task link ──
  taskCmd
    .command('link')
    .description('Link a task to a memory or spec')
    .argument('<task-id>', 'Task ID (full or prefix)')
    .option('--memory <memory-id>', 'Memory ID to link')
    .option('--spec <spec-id>', 'Spec ID to link')
    .option('--type <link-type>', 'Link type (related, blocker, decision, spec, caused_by, implements, blocked_by)', 'related')
    .action(
      (
        taskId: string,
        opts: { memory?: string; spec?: string; type?: string },
      ) => {
        const projectRoot = process.cwd();
        const { db, taskStore } = ensureInit(projectRoot);

        const task = findTaskByPrefix(taskStore, db, taskId);
        if (!task) {
          console.error(`Task not found: ${taskId}`);
          db.close();
          process.exit(1);
        }

        if (!opts.memory && !opts.spec) {
          console.error('Specify --memory <id> or --spec <id>');
          db.close();
          process.exit(1);
        }

        if (opts.memory) {
          const memoryStore = new MemoryStore(db);
          const memory = memoryStore.getById(opts.memory);
          if (!memory) {
            console.error(`Memory not found: ${opts.memory}`);
            db.close();
            process.exit(1);
          }
          const linkType = (opts.type ?? 'related') as 'related' | 'blocker' | 'decision' | 'spec' | 'caused_by';
          taskStore.linkMemory(task.id, opts.memory, linkType);
          console.log(
            `\n  ${GREEN}Linked${RESET} task ${DIM}${task.id.slice(0, 8)}${RESET} ↔ memory ${DIM}${opts.memory.slice(0, 8)}${RESET} [${linkType}]\n`,
          );
        }

        if (opts.spec) {
          const specStore = new SpecStore(projectRoot);
          const spec = specStore.getById(opts.spec);
          if (!spec) {
            console.error(`Spec not found: ${opts.spec}`);
            db.close();
            process.exit(1);
          }
          const linkType = (opts.type ?? 'related') as 'implements' | 'related' | 'blocked_by';
          taskStore.linkSpec(task.id, opts.spec, linkType);
          console.log(
            `\n  ${GREEN}Linked${RESET} task ${DIM}${task.id.slice(0, 8)}${RESET} ↔ spec ${DIM}${opts.spec}${RESET} [${linkType}]\n`,
          );
        }

        db.close();
      },
    );
}

/**
 * Find a task by full ID or prefix match.
 */
function findTaskByPrefix(
  taskStore: TaskStore,
  db: ReturnType<typeof createDatabase>,
  idOrPrefix: string,
): Task | null {
  // Try exact match first
  const exact = taskStore.getById(idOrPrefix);
  if (exact) return exact;

  // Prefix search
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
