import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { createDatabase, createVecTable } from '../database.js';
import { resolveConfig } from '../config.js';
import { getEmbeddingDimensions } from '../types.js';
import { installHooks } from '../hooks-installer.js';
import { registerMcpServer } from '../mcp-register.js';
import { ClaudeMdManager } from '../claudemd.js';
import { ContextBuilder } from '../context-builder.js';
import { MemoryStore } from '../memory-store.js';
import { getLatestVersion } from '../migrations.js';
import { Progress } from '../utils/progress.js';
import Database from 'better-sqlite3';

/**
 * Get schema version from DB without running migrations.
 */
function getSchemaVersion(dbPath: string): number {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value: string } | undefined;
      db.close();
      return row ? parseInt(row.value, 10) : 0;
    } catch {
      db.close();
      return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * `ctxcore update` — re-applies all configuration without touching the
 * database content or memories.  Useful after `git pull + npm run build`
 * to pick up new hooks, permissions, templates, and migrations.
 */
export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Re-apply hooks, permissions, MCP config, and CLAUDE.md template (keeps memories intact)')
    .option('--verbose', 'Show detailed output')
    .action(async (opts: { verbose?: boolean }) => {
      const projectRoot = process.cwd();
      const progress = new Progress();
      const verbose = opts.verbose ?? false;

      // Verify ctxcore is initialized
      const config = resolveConfig(projectRoot);
      if (!existsSync(config.dbPath)) {
        console.error('ctxcore is not initialized in this project. Run `ctxcore init` first.');
        process.exit(1);
      }

      console.log('Updating ctxcore configuration...\n');

      let updatedCount = 0;

      // ── 1. Run DB migrations ──
      progress.start('Running database migrations...');
      try {
        const versionBefore = getSchemaVersion(config.dbPath);
        const latestVersion = getLatestVersion();

        const db = createDatabase(config.dbPath); // runs migrations internally
        const dimensions = getEmbeddingDimensions(config.ollamaModel);
        createVecTable(db, dimensions);

        const migrationsApplied = latestVersion - versionBefore;
        if (migrationsApplied > 0) {
          progress.succeed(`Database migrated: v${versionBefore} → v${latestVersion} (${migrationsApplied} migration${migrationsApplied > 1 ? 's' : ''} applied)`);
          updatedCount++;
        } else {
          if (verbose) {
            progress.succeed(`Database schema up to date (v${latestVersion})`);
          } else {
            progress.succeed('Database schema up to date');
          }
        }

        // ── 2. Install hook scripts ──
        progress.start('Installing hook scripts...');
        try {
          installHooks(projectRoot);
          progress.succeed('Hooks and permissions updated in .claude/settings.json');
          updatedCount++;
        } catch (err) {
          progress.fail(`Failed to install hooks: ${(err as Error).message}`);
        }

        // ── 3. Register MCP server ──
        progress.start('Updating MCP server config...');
        try {
          const registered = registerMcpServer(projectRoot);
          if (registered) {
            progress.succeed('MCP server config updated in .mcp.json');
            updatedCount++;
          } else {
            progress.fail('Could not register MCP server');
          }
        } catch (err) {
          progress.fail(`Failed to update MCP config: ${(err as Error).message}`);
        }

        // ── 4. Re-patch CLAUDE.md ──
        progress.start('Updating CLAUDE.md...');
        try {
          const store = new MemoryStore(db);
          const contextBuilder = new ContextBuilder(store);
          const claudeMd = new ClaudeMdManager(contextBuilder);
          claudeMd.patch(projectRoot);
          progress.succeed('CLAUDE.md updated with latest template and context');
          updatedCount++;
        } catch (err) {
          progress.fail(`Failed to update CLAUDE.md: ${(err as Error).message}`);
        }

        db.close();
      } catch (err) {
        progress.fail(`Database error: ${(err as Error).message}`);
        console.error('  Fix: check that .memory.db is not corrupted. Run `ctxcore doctor` for diagnostics.');
        process.exit(1);
      }

      // ── Summary ──
      console.log('\n' + '-'.repeat(40));
      if (updatedCount > 0) {
        console.log(`  ctxcore updated (${updatedCount} component${updatedCount > 1 ? 's' : ''} refreshed)`);
      } else {
        console.log('  ctxcore is already up to date');
      }
      console.log();
      console.log('  Restart Claude Code to pick up changes.');
      console.log('-'.repeat(40));
    });
}
