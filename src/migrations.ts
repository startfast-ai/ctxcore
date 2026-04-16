import type Database from 'better-sqlite3';

/**
 * Automated schema migration system for ctxcore.
 *
 * Each migration has a version number and an `up` function.
 * Migrations run in order. The current version is tracked in a `meta` table.
 * Migrations are idempotent — safe to re-run (uses IF NOT EXISTS / IF EXISTS).
 *
 * On every database open, `runMigrations(db)` checks the current version
 * and applies any pending migrations. Users never lose data.
 */

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: memories, connections, reflexions, memory_events',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          tier TEXT NOT NULL DEFAULT 'short-term' CHECK(tier IN ('short-term', 'operational', 'long-term')),
          importance REAL NOT NULL DEFAULT 0.3,
          actuality REAL NOT NULL DEFAULT 1.0,
          tags TEXT NOT NULL DEFAULT '[]',
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
          access_count INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS connections (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('causal', 'contradicts', 'supports', 'temporal', 'similar')),
          strength REAL NOT NULL DEFAULT 0.5,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(source_id, target_id, type)
        );

        CREATE TABLE IF NOT EXISTS reflexions (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('consolidation', 'contradiction', 'pattern', 'recalibration', 'user-profile')),
          input TEXT NOT NULL DEFAULT '{}',
          output TEXT NOT NULL DEFAULT '{}',
          memories_affected TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS memory_events (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL CHECK(event_type IN ('created', 'accessed', 'updated', 'promoted', 'demoted', 'archived', 'decayed', 'reinforced')),
          data TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
        CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);
        CREATE INDEX IF NOT EXISTS idx_memories_actuality ON memories(actuality);
        CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_id);
        CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_id);
        CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_id);
        CREATE INDEX IF NOT EXISTS idx_memory_events_type ON memory_events(event_type);
      `);
    },
  },
  {
    version: 2,
    description: 'Add kanban, tasks, task_comments, task links',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kanban_columns (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          column_order REAL NOT NULL DEFAULT 0,
          wip_limit INTEGER,
          color TEXT
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in-progress', 'done', 'archived')),
          column_id TEXT REFERENCES kanban_columns(id) ON DELETE SET NULL,
          column_order REAL NOT NULL DEFAULT 0,
          priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
          assignee TEXT,
          created_by TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          estimated_effort TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          metadata TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS task_comments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          author TEXT NOT NULL,
          author_type TEXT NOT NULL CHECK(author_type IN ('human', 'ai')),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          metadata TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS task_memory_links (
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          link_type TEXT NOT NULL CHECK(link_type IN ('related', 'blocker', 'decision', 'spec', 'caused_by')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY(task_id, memory_id)
        );

        CREATE TABLE IF NOT EXISTS task_spec_links (
          task_id TEXT NOT NULL,
          spec_id TEXT NOT NULL,
          link_type TEXT NOT NULL CHECK(link_type IN ('implements', 'related', 'blocked_by')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY(task_id, spec_id)
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
        CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
        CREATE INDEX IF NOT EXISTS idx_kanban_columns_project ON kanban_columns(project_id);
        CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_memory_links_task ON task_memory_links(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_memory_links_memory ON task_memory_links(memory_id);
        CREATE INDEX IF NOT EXISTS idx_task_spec_links_task ON task_spec_links(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_spec_links_spec ON task_spec_links(spec_id);
      `);
    },
  },
  {
    version: 3,
    description: 'Add intelligence_history table for score tracking',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS intelligence_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          score_total REAL NOT NULL,
          score_depth REAL NOT NULL,
          score_freshness REAL NOT NULL,
          score_coherence REAL NOT NULL,
          score_coverage REAL NOT NULL,
          event_type TEXT NOT NULL CHECK(event_type IN ('init', 'session', 'reflexion', 'manual')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_intelligence_history_created ON intelligence_history(created_at);
      `);
    },
  },
];

/**
 * Get the current schema version from the database.
 * Returns 0 if no meta table exists (fresh database).
 */
function getCurrentVersion(db: Database.Database): number {
  try {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    // meta table doesn't exist — version 0
    return 0;
  }
}

/**
 * Set the schema version in the meta table.
 */
function setVersion(db: Database.Database, version: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)")
    .run(version.toString());
}

/**
 * Run all pending migrations on the database.
 * Safe to call on every database open — only applies migrations
 * that haven't been applied yet.
 *
 * Returns the number of migrations applied.
 */
export function runMigrations(db: Database.Database): number {
  const currentVersion = getCurrentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length === 0) return 0;

  let applied = 0;

  for (const migration of pending) {
    try {
      db.exec('BEGIN');
      migration.up(db);
      setVersion(db, migration.version);
      db.exec('COMMIT');
      applied++;
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration v${migration.version} (${migration.description}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return applied;
}

/**
 * Get the latest schema version number.
 */
export function getLatestVersion(): number {
  return MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}

/**
 * Get migration info for display purposes.
 */
export function getMigrationInfo(db: Database.Database): {
  currentVersion: number;
  latestVersion: number;
  pendingCount: number;
} {
  const currentVersion = getCurrentVersion(db);
  const latestVersion = getLatestVersion();
  return {
    currentVersion,
    latestVersion,
    pendingCount: MIGRATIONS.filter((m) => m.version > currentVersion).length,
  };
}
