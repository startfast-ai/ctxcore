import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { unregisterMcpServer } from '../mcp-register.js';
import { uninstallHooks } from '../hooks-installer.js';
import { Scheduler } from '../scheduler.js';

const GLOBAL_DIR = join(homedir(), '.ctxcore');

const CTXCORE_START = '<!-- ctxcore:start -->';
const CTXCORE_END = '<!-- ctxcore:end -->';

function promptConfirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return Promise.resolve(true);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * Remove ctxcore MCP server entry from .mcp.json and ~/.claude.json.
 */
export function removeMcpFromSettings(projectRoot?: string): boolean {
  return unregisterMcpServer(projectRoot);
}

/**
 * Remove the ctxcore section from CLAUDE.md.
 */
export function removeCtxcoreFromClaudeMd(projectRoot: string): boolean {
  const filePath = join(projectRoot, 'CLAUDE.md');
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, 'utf-8');
  const startIdx = content.indexOf(CTXCORE_START);
  const endIdx = content.indexOf(CTXCORE_END);

  if (startIdx === -1 || endIdx === -1) return false;

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + CTXCORE_END.length);
  const result = (before + after).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  writeFileSync(filePath, result, 'utf-8');
  return true;
}

/**
 * Remove the project config file (.ctxcore.json).
 */
export function removeProjectConfig(projectRoot: string): boolean {
  const configPath = join(projectRoot, '.ctxcore.json');
  if (!existsSync(configPath)) return false;
  unlinkSync(configPath);
  return true;
}

/**
 * Remove the memory database (.memory.db).
 */
export function removeMemoryDb(projectRoot: string): boolean {
  const dbPath = join(projectRoot, '.memory.db');
  if (!existsSync(dbPath)) return false;
  unlinkSync(dbPath);
  // Also remove WAL and SHM files if they exist
  for (const suffix of ['-wal', '-shm']) {
    const walPath = dbPath + suffix;
    if (existsSync(walPath)) unlinkSync(walPath);
  }
  return true;
}

/**
 * Remove the global ~/.ctxcore/ directory.
 */
export function removeGlobalDir(): boolean {
  if (!existsSync(GLOBAL_DIR)) return false;
  rmSync(GLOBAL_DIR, { recursive: true, force: true });
  return true;
}

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Remove ctxcore from this project')
    .option('--purge', 'Also delete memory database and global ~/.ctxcore/ directory')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (opts: { purge?: boolean; yes?: boolean }) => {
      const projectRoot = process.cwd();

      if (opts.purge) {
        console.log('This will remove ctxcore completely:');
        console.log('  - MCP server from Claude settings');
        console.log('  - Hooks from .claude/settings.json');
        console.log('  - ctxcore section from CLAUDE.md');
        console.log('  - .ctxcore.json config');
        console.log('  - .memory.db database');
        console.log('  - ~/.ctxcore/ global directory');
      } else {
        console.log('This will remove ctxcore configuration:');
        console.log('  - MCP server from Claude settings');
        console.log('  - Hooks from .claude/settings.json');
        console.log('  - ctxcore section from CLAUDE.md');
        console.log('  - .ctxcore.json config');
      }

      if (!opts.yes) {
        const confirmed = await promptConfirm('\nProceed?');
        if (!confirmed) {
          console.log('Aborted.');
          return;
        }
      }

      console.log();

      const mcpRemoved = removeMcpFromSettings(projectRoot);
      console.log(mcpRemoved ? '  Removed MCP server from .mcp.json / ~/.claude.json' : '  No MCP entry found');

      try {
        uninstallHooks(projectRoot);
        console.log('  Removed hooks from .claude/settings.json');
      } catch {
        console.log('  No hooks to remove');
      }

      const claudeMdRemoved = removeCtxcoreFromClaudeMd(projectRoot);
      console.log(claudeMdRemoved ? '  Removed ctxcore section from CLAUDE.md' : '  No ctxcore section in CLAUDE.md');

      try {
        const scheduler = new Scheduler();
        scheduler.removeCron();
        console.log('  Removed reflexion schedule');
      } catch {
        console.log('  No reflexion schedule to remove');
      }

      const configRemoved = removeProjectConfig(projectRoot);
      console.log(configRemoved ? '  Removed .ctxcore.json' : '  No .ctxcore.json found');

      if (opts.purge) {
        const dbRemoved = removeMemoryDb(projectRoot);
        console.log(dbRemoved ? '  Removed .memory.db' : '  No .memory.db found');

        const globalRemoved = removeGlobalDir();
        console.log(globalRemoved ? '  Removed ~/.ctxcore/' : '  No ~/.ctxcore/ found');
      }

      console.log('\nctxcore uninstalled.');
    });
}
