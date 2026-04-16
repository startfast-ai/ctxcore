import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { runMigrations, getLatestVersion, getMigrationInfo } from '../../src/migrations.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);
  return db;
}

describe('Migrations', () => {
  it('runs all migrations on a fresh database', () => {
    const db = freshDb();
    const applied = runMigrations(db);
    expect(applied).toBe(getLatestVersion());

    // Verify core tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain('memories');
    expect(names).toContain('connections');
    expect(names).toContain('reflexions');
    expect(names).toContain('memory_events');
    expect(names).toContain('tasks');
    expect(names).toContain('kanban_columns');
    expect(names).toContain('task_comments');
    expect(names).toContain('task_memory_links');
    expect(names).toContain('task_spec_links');
    expect(names).toContain('meta');

    db.close();
  });

  it('is idempotent — running twice applies nothing the second time', () => {
    const db = freshDb();
    const first = runMigrations(db);
    expect(first).toBeGreaterThan(0);

    const second = runMigrations(db);
    expect(second).toBe(0);

    db.close();
  });

  it('preserves existing data across migrations', () => {
    const db = freshDb();

    // Apply v1 only (memories table)
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
    `);
    // Manually create v1 tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'short-term',
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
    `);

    // Insert a memory
    db.prepare("INSERT INTO memories (id, content) VALUES ('test-1', 'Important decision')").run();

    // Now run migrations — should apply v2 but not touch v1 data
    const applied = runMigrations(db);
    expect(applied).toBe(getLatestVersion() - 1); // v2+ applied, v1 skipped

    // Verify memory still exists
    const row = db.prepare("SELECT content FROM memories WHERE id = 'test-1'").get() as { content: string };
    expect(row.content).toBe('Important decision');

    // Verify new tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('tasks');

    db.close();
  });

  it('tracks version correctly', () => {
    const db = freshDb();
    runMigrations(db);

    const info = getMigrationInfo(db);
    expect(info.currentVersion).toBe(getLatestVersion());
    expect(info.pendingCount).toBe(0);

    db.close();
  });

  it('reports pending migrations on old database', () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
    `);

    const info = getMigrationInfo(db);
    expect(info.currentVersion).toBe(1);
    expect(info.latestVersion).toBe(getLatestVersion());
    expect(info.pendingCount).toBe(getLatestVersion() - 1);

    db.close();
  });
});
