import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

/**
 * MCP server config locations (correct for Claude Code):
 *   Per-project: <project-root>/.mcp.json
 *   Global:      ~/.claude.json
 *
 * NOT ~/.claude/settings.json — that file is ignored for MCP servers.
 */

const GLOBAL_MCP_PATH = join(homedir(), '.claude.json');

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function buildMcpEntry(projectRoot: string): McpServerEntry {
  return {
    command: findCtxcoreBin(),
    args: ['serve'],
    env: {
      CTXCORE_PROJECT_ROOT: projectRoot,
    },
  };
}

function readMcpConfig(path: string): McpConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function writeMcpConfig(path: string, config: McpConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Register ctxcore as an MCP server.
 * Writes to per-project .mcp.json (primary) and global ~/.claude.json (fallback).
 * Reads existing config first to preserve other MCP servers.
 */
export function registerMcpServer(projectRoot: string): boolean {
  const entry = buildMcpEntry(projectRoot);
  let success = false;

  // Per-project: <project-root>/.mcp.json
  try {
    const projectMcpPath = join(projectRoot, '.mcp.json');
    const config = readMcpConfig(projectMcpPath);

    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    config.mcpServers['ctxcore'] = entry;

    writeMcpConfig(projectMcpPath, config);
    success = true;
  } catch {
    // Project-level failed
  }

  // Global: ~/.claude.json
  try {
    const config = readMcpConfig(GLOBAL_MCP_PATH);

    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    config.mcpServers['ctxcore'] = entry;

    writeMcpConfig(GLOBAL_MCP_PATH, config);
    success = true;
  } catch {
    // Global failed
  }

  return success;
}

/**
 * Remove ctxcore from MCP config (both project and global).
 */
export function unregisterMcpServer(projectRoot?: string): boolean {
  let removed = false;

  // Remove from project .mcp.json
  if (projectRoot) {
    try {
      const projectMcpPath = join(projectRoot, '.mcp.json');
      if (existsSync(projectMcpPath)) {
        const config = readMcpConfig(projectMcpPath);
        if (config.mcpServers?.['ctxcore']) {
          delete config.mcpServers['ctxcore'];
          writeMcpConfig(projectMcpPath, config);
          removed = true;
        }
      }
    } catch {
      // Ignore
    }
  }

  // Remove from global ~/.claude.json
  try {
    if (existsSync(GLOBAL_MCP_PATH)) {
      const config = readMcpConfig(GLOBAL_MCP_PATH);
      if (config.mcpServers?.['ctxcore']) {
        delete config.mcpServers['ctxcore'];
        writeMcpConfig(GLOBAL_MCP_PATH, config);
        removed = true;
      }
    }
  } catch {
    // Ignore
  }

  return removed;
}

/**
 * Check if ctxcore is registered as an MCP server (in either location).
 */
export function isMcpServerRegistered(projectRoot?: string): boolean {
  // Check project .mcp.json first
  if (projectRoot) {
    try {
      const config = readMcpConfig(join(projectRoot, '.mcp.json'));
      if (config.mcpServers?.['ctxcore']) return true;
    } catch {
      // Fall through
    }
  }

  // Check global ~/.claude.json
  try {
    const config = readMcpConfig(GLOBAL_MCP_PATH);
    return !!config.mcpServers?.['ctxcore'];
  } catch {
    return false;
  }
}

function findCtxcoreBin(): string {
  try {
    const path = execSync('which ctxcore', { encoding: 'utf-8' }).trim();
    if (path) return path;
  } catch {
    // Fall through
  }
  return 'npx';
}
