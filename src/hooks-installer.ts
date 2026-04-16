import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The hooks and permissions config that ctxcore installs into
 * <project>/.claude/settings.json.
 *
 * This is NOT the MCP config (that goes in .mcp.json).
 * This is the Claude Code project settings file for hooks and tool permissions.
 */

interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  permissions?: { allow?: string[]; deny?: string[] };
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

interface HookEntry {
  type: string;
  command: string;
  timeout: number;
}

/**
 * Install hook scripts into <projectRoot>/.ctxcore/hooks/ and return
 * the hook config referencing them. This avoids inline bash escaping hell.
 */
function installHookScripts(projectRoot: string): void {
  const hooksDir = join(projectRoot, '.ctxcore', 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  // Find source hooks directory
  // When running from dist/src/hooks-installer.js → ../../src/hooks
  // When running from src/hooks-installer.ts → ../src/hooks (same dir)
  // When installed via npm → look in package root's src/hooks/
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(thisDir, '..', 'src', 'hooks'),      // dev: src/ → src/hooks/
    join(thisDir, 'hooks'),                     // if hooks are next to this file
    join(thisDir, '..', 'hooks'),               // dist/src/ → dist/hooks/
    join(thisDir, '..', '..', 'src', 'hooks'),  // dist/src/ → src/hooks/ (npm link / build)
  ];
  let srcHooksDir = candidates[0];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      srcHooksDir = candidate;
      break;
    }
  }

  const scripts = ['user-prompt.sh', 'session-start.sh', 'session-end.sh', 'pre-compact.sh', 'post-compact.sh', 'pre-web-search.sh', 'post-web-fetch.sh'];
  for (const script of scripts) {
    const srcPath = join(srcHooksDir, script);
    const destPath = join(hooksDir, script);
    if (existsSync(srcPath)) {
      copyFileSync(srcPath, destPath);
      try { chmodSync(destPath, 0o755); } catch { /* ignore on Windows */ }
    }
  }
}

function buildHooks(projectRoot: string): Record<string, HookGroup[]> {
  const hooksDir = join(projectRoot, '.ctxcore', 'hooks');

  return {
    PreToolUse: [
      {
        matcher: 'mcp__ctxcore__*',
        hooks: [
          {
            type: 'command',
            command: "echo '{\"hookSpecificOutput\":{\"permissionDecision\":\"allow\"}}'",
            timeout: 1,
          },
        ],
      },
      {
        matcher: 'WebSearch',
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'pre-web-search.sh')}"`,
            timeout: 5,
          },
        ],
      },
      {
        matcher: 'WebFetch',
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'pre-web-search.sh')}"`,
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'WebSearch',
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'post-web-fetch.sh')}"`,
            timeout: 10,
          },
        ],
      },
      {
        matcher: 'WebFetch',
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'post-web-fetch.sh')}"`,
            timeout: 10,
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'user-prompt.sh')}"`,
            timeout: 5,
          },
        ],
      },
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'session-start.sh')}"`,
            timeout: 10,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'session-end.sh')}"`,
            timeout: 30,
          },
        ],
      },
    ],
    PreCompact: [
      {
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'pre-compact.sh')}"`,
            timeout: 15,
          },
        ],
      },
    ],
    PostCompact: [
      {
        hooks: [
          {
            type: 'command',
            command: `bash "${join(hooksDir, 'post-compact.sh')}"`,
            timeout: 15,
          },
        ],
      },
    ],
  };
}

const CTXCORE_PERMISSIONS = [
  'mcp__ctxcore__memory_search',
  'mcp__ctxcore__memory_store',
  'mcp__ctxcore__memory_context',
  'mcp__ctxcore__memory_decide',
  'mcp__ctxcore__memory_reflect',
  'mcp__ctxcore__memory_task_create',
  'mcp__ctxcore__memory_task_update',
  'mcp__ctxcore__memory_task_comment',
  'mcp__ctxcore__memory_task_list',
  'mcp__ctxcore__memory_task_link',
  'mcp__ctxcore__memory_spec_create',
  'mcp__ctxcore__memory_spec_read',
  'mcp__ctxcore__memory_spec_update',
  'mcp__ctxcore__memory_spec_list',
  'mcp__ctxcore__memory_spec_link',
];

/** Marker used to identify ctxcore-installed hook entries */
const CTXCORE_HOOK_MARKER_COMMAND_PREFIX = 'ctxcore ';
const CTXCORE_HOOK_MATCHER = 'mcp__ctxcore__*';
const CTXCORE_PERMISSION_PREFIX = 'mcp__ctxcore__';

function readSettings(settingsPath: string): ClaudeSettings {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(settingsPath: string, settings: ClaudeSettings): void {
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function isCtxcoreHookGroup(group: HookGroup): boolean {
  // Match by matcher pattern or by command prefix/content
  if (group.matcher === CTXCORE_HOOK_MATCHER) return true;
  if (group.hooks?.some(h => {
    const cmd = h.command ?? '';
    return cmd.startsWith(CTXCORE_HOOK_MARKER_COMMAND_PREFIX)   // "ctxcore ..."
      || cmd.includes('.ctxcore/hooks/')                        // script-based hooks
      || cmd.includes('ctxcore sync')                           // sync hooks
      || cmd.includes('ctxcore search')                         // old inline search hook
      || cmd.includes('permissionDecision')                     // auto-allow hook
      || cmd.includes('hookSpecificOutput');                    // any ctxcore message hook
  })) return true;
  return false;
}

/**
 * Install ctxcore hooks and permissions into <projectRoot>/.claude/settings.json.
 * Merges with existing content — does not overwrite other hooks or permissions.
 */
export function installHooks(projectRoot: string): void {
  // Copy hook scripts to .ctxcore/hooks/
  installHookScripts(projectRoot);

  const settingsDir = join(projectRoot, '.claude');
  mkdirSync(settingsDir, { recursive: true });
  const settingsPath = join(settingsDir, 'settings.json');

  const settings = readSettings(settingsPath);

  // Build hooks config (references script files, not inline bash)
  const CTXCORE_HOOKS = buildHooks(projectRoot);

  // ── Merge hooks ──
  if (!settings.hooks) {
    settings.hooks = {};
  }

  for (const [event, ctxcoreGroups] of Object.entries(CTXCORE_HOOKS)) {
    const existing = settings.hooks[event] ?? [];

    // Remove any previous ctxcore hook groups for this event
    const filtered = existing.filter((g: HookGroup) => !isCtxcoreHookGroup(g));

    // Add ctxcore groups
    settings.hooks[event] = [...filtered, ...ctxcoreGroups];
  }

  // ── Merge permissions ──
  if (!settings.permissions) {
    settings.permissions = {};
  }
  const existingAllow = new Set(settings.permissions.allow ?? []);
  for (const perm of CTXCORE_PERMISSIONS) {
    existingAllow.add(perm);
  }
  settings.permissions.allow = [...existingAllow];

  writeSettings(settingsPath, settings);
}

/**
 * Remove ctxcore hooks and permissions from <projectRoot>/.claude/settings.json.
 * Preserves all non-ctxcore entries.
 */
export function uninstallHooks(projectRoot: string): void {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return;

  const settings = readSettings(settingsPath);

  // ── Remove ctxcore hooks ──
  if (settings.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      const groups = settings.hooks[event];
      if (Array.isArray(groups)) {
        const filtered = groups.filter((g: HookGroup) => !isCtxcoreHookGroup(g));
        if (filtered.length > 0) {
          settings.hooks[event] = filtered;
        } else {
          delete settings.hooks[event];
        }
      }
    }
    // Clean up empty hooks object
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  }

  // ── Remove ctxcore permissions ──
  if (settings.permissions?.allow) {
    settings.permissions.allow = settings.permissions.allow.filter(
      (p: string) => !p.startsWith(CTXCORE_PERMISSION_PREFIX)
    );
    if (settings.permissions.allow.length === 0) {
      delete settings.permissions.allow;
    }
    if (Object.keys(settings.permissions).length === 0) {
      delete settings.permissions;
    }
  }

  writeSettings(settingsPath, settings);
}
