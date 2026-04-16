import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { IScheduler, CronStatus } from './types.js';

const CRON_MARKER = '# ctxcore';
const HOOK_BEGIN = '# >>> ctxcore hooks >>>';
const HOOK_END = '# <<< ctxcore hooks <<<';
const LAUNCHD_LABEL = 'com.ctxcore.reflexion';
const LAUNCHD_PLIST_DIR = join(homedir(), 'Library', 'LaunchAgents');
const LAUNCHD_PLIST_PATH = join(LAUNCHD_PLIST_DIR, `${LAUNCHD_LABEL}.plist`);
const GLOBAL_DIR = join(homedir(), '.ctxcore');
const LAST_REFLEXION_FILE = join(GLOBAL_DIR, 'last-reflexion');
const STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Last reflexion tracking ──

export function getLastReflexionTime(): Date | null {
  try {
    if (!existsSync(LAST_REFLEXION_FILE)) return null;
    const ts = readFileSync(LAST_REFLEXION_FILE, 'utf-8').trim();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function touchLastReflexion(): void {
  if (!existsSync(GLOBAL_DIR)) {
    mkdirSync(GLOBAL_DIR, { recursive: true });
  }
  writeFileSync(LAST_REFLEXION_FILE, new Date().toISOString(), 'utf-8');
}

export function isReflexionStale(thresholdMs: number = STALENESS_THRESHOLD_MS): boolean {
  const last = getLastReflexionTime();
  if (!last) return true;
  return Date.now() - last.getTime() > thresholdMs;
}

/**
 * Silently spawns a background reflexion if >24h since last run.
 * Fully detached — no output, no blocking, no user-visible side effects.
 */
export function maybeBackgroundReflexion(): void {
  if (!isReflexionStale()) return;

  // Find ctxcore binary path
  const ctxcoreBin = process.argv[1];
  if (!ctxcoreBin) return;

  try {
    const child = spawn(process.execPath, [ctxcoreBin, 'reflect', '--auto', '--quiet'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CTXCORE_BACKGROUND: '1' },
    });
    child.unref();
  } catch {
    // Silent fail — user never notices
  }
}

// ── launchd (macOS) ──

function resolveCtxcorePath(): string {
  try {
    return execSync('which ctxcore 2>/dev/null', { encoding: 'utf-8' }).trim();
  } catch {
    // Fallback: use the current running binary
    return process.argv[1] ?? 'ctxcore';
  }
}

function buildLaunchdPlist(ctxcorePath: string): string {
  // Resolve node path for npx/node-based installs
  const nodePath = process.execPath;
  const isNodeScript = ctxcorePath.endsWith('.ts') || ctxcorePath.endsWith('.js');
  const userPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';

  const programArgs = isNodeScript
    ? `    <array>
      <string>${nodePath}</string>
      <string>${ctxcorePath}</string>
      <string>reflect</string>
      <string>--auto</string>
      <string>--quiet</string>
    </array>`
    : `    <array>
      <string>${ctxcorePath}</string>
      <string>reflect</string>
      <string>--auto</string>
      <string>--quiet</string>
    </array>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
${programArgs}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${userPath}</string>
    <key>CTXCORE_BACKGROUND</key>
    <string>1</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>23</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(GLOBAL_DIR, 'reflexion.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(GLOBAL_DIR, 'reflexion.log')}</string>
  <key>RunAtLoad</key>
  <false/>
  <key>Nice</key>
  <integer>10</integer>
</dict>
</plist>
`;
}

function installLaunchd(): void {
  if (!existsSync(LAUNCHD_PLIST_DIR)) {
    mkdirSync(LAUNCHD_PLIST_DIR, { recursive: true });
  }

  // Unload existing if present
  if (existsSync(LAUNCHD_PLIST_PATH)) {
    try {
      execSync(`launchctl unload "${LAUNCHD_PLIST_PATH}" 2>/dev/null`, { encoding: 'utf-8' });
    } catch {
      // May not be loaded
    }
  }

  const ctxcorePath = resolveCtxcorePath();
  const plist = buildLaunchdPlist(ctxcorePath);
  writeFileSync(LAUNCHD_PLIST_PATH, plist, 'utf-8');
  execSync(`launchctl load "${LAUNCHD_PLIST_PATH}"`, { encoding: 'utf-8' });
}

function removeLaunchd(): void {
  if (existsSync(LAUNCHD_PLIST_PATH)) {
    try {
      execSync(`launchctl unload "${LAUNCHD_PLIST_PATH}" 2>/dev/null`, { encoding: 'utf-8' });
    } catch {
      // May not be loaded
    }
    unlinkSync(LAUNCHD_PLIST_PATH);
  }
}

function getLaunchdStatus(): CronStatus | null {
  if (!existsSync(LAUNCHD_PLIST_PATH)) return null;
  return {
    schedule: 'daily at 2:23 AM (launchd)',
    lastRun: getLastReflexionTime(),
    nextRun: null,
    command: 'ctxcore reflect --auto --quiet',
  };
}

// ── crontab (Linux/fallback) ──

export function readCrontab(): string[] {
  try {
    const output = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
    return output.split('\n');
  } catch {
    return [];
  }
}

export function writeCrontab(lines: string[]): void {
  const content = lines.join('\n');
  execSync(`echo ${JSON.stringify(content)} | crontab -`, { encoding: 'utf-8' });
}

export function buildCronEntry(schedule: string, command: string): string {
  return `${schedule} ${command} ${CRON_MARKER}`;
}

export function parseCronEntry(lines: string[]): CronStatus | null {
  for (const line of lines) {
    if (line.includes(CRON_MARKER) && !line.trimStart().startsWith('#')) {
      const stripped = line.replace(CRON_MARKER, '').trim();
      const parts = stripped.split(/\s+/);
      if (parts.length >= 6) {
        const schedule = parts.slice(0, 5).join(' ');
        const command = parts.slice(5).join(' ');
        return {
          schedule,
          lastRun: getLastReflexionTime(),
          nextRun: null,
          command,
        };
      }
    }
  }
  return null;
}

export function removeCronEntries(lines: string[]): string[] {
  return lines.filter((line) => !line.includes(CRON_MARKER));
}

// ── Git hooks ──

export function buildHookBlock(hookType: 'post-commit' | 'post-merge'): string {
  const command =
    hookType === 'post-commit'
      ? 'ctxcore reflect --consolidate --auto --quiet'
      : 'ctxcore rescan --incremental';

  return [HOOK_BEGIN, command, HOOK_END].join('\n');
}

export function insertHookBlock(existingContent: string | null, hookType: 'post-commit' | 'post-merge'): string {
  const block = buildHookBlock(hookType);

  if (!existingContent || existingContent.trim() === '') {
    return `#!/bin/sh\n${block}\n`;
  }

  if (existingContent.includes(HOOK_BEGIN)) {
    const beforeIdx = existingContent.indexOf(HOOK_BEGIN);
    const afterIdx = existingContent.indexOf(HOOK_END);
    if (afterIdx !== -1) {
      const before = existingContent.substring(0, beforeIdx);
      const after = existingContent.substring(afterIdx + HOOK_END.length);
      return `${before}${block}${after}`;
    }
  }

  const lines = existingContent.split('\n');
  if (lines[0].startsWith('#!')) {
    return `${lines[0]}\n${block}\n${lines.slice(1).join('\n')}`;
  }

  return `${block}\n${existingContent}`;
}

export function removeHookBlock(content: string): string | null {
  if (!content.includes(HOOK_BEGIN)) {
    return content;
  }

  const beforeIdx = content.indexOf(HOOK_BEGIN);
  const afterIdx = content.indexOf(HOOK_END);
  if (afterIdx === -1) {
    return content;
  }

  const before = content.substring(0, beforeIdx);
  const after = content.substring(afterIdx + HOOK_END.length);
  const result = (before + after).trim();

  if (result === '#!/bin/sh' || result === '#!/bin/bash' || result === '') {
    return null;
  }

  return result + '\n';
}

// ── Scheduler class ──

export class Scheduler implements IScheduler {
  private readonly isMac = platform() === 'darwin';

  installCron(schedule: string, command: string): void {
    if (this.isMac) {
      installLaunchd();
      return;
    }

    // Linux: use crontab
    const lines = readCrontab();
    const cleaned = removeCronEntries(lines);
    const entry = buildCronEntry(schedule, command);
    cleaned.push(entry);
    const final = cleaned.filter((l, i) => i < cleaned.length - 1 || l.trim() !== '');
    writeCrontab(final);
  }

  removeCron(): void {
    if (this.isMac) {
      removeLaunchd();
      return;
    }

    const lines = readCrontab();
    const cleaned = removeCronEntries(lines);
    writeCrontab(cleaned);
  }

  getCronStatus(): CronStatus | null {
    if (this.isMac) {
      return getLaunchdStatus();
    }

    const lines = readCrontab();
    return parseCronEntry(lines);
  }

  installGitHooks(projectRoot: string): void {
    const hooksDir = join(projectRoot, '.git', 'hooks');
    if (!existsSync(join(projectRoot, '.git'))) {
      throw new Error(`Not a git repository: ${projectRoot}`);
    }
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    for (const hookType of ['post-commit', 'post-merge'] as const) {
      const hookPath = join(hooksDir, hookType);
      const existing = existsSync(hookPath) ? readFileSync(hookPath, 'utf-8') : null;
      const newContent = insertHookBlock(existing, hookType);
      writeFileSync(hookPath, newContent, 'utf-8');
      chmodSync(hookPath, 0o755);
    }
  }

  removeGitHooks(projectRoot: string): void {
    const hooksDir = join(projectRoot, '.git', 'hooks');

    for (const hookType of ['post-commit', 'post-merge'] as const) {
      const hookPath = join(hooksDir, hookType);
      if (!existsSync(hookPath)) continue;

      const content = readFileSync(hookPath, 'utf-8');
      const cleaned = removeHookBlock(content);

      if (cleaned === null) {
        unlinkSync(hookPath);
      } else {
        writeFileSync(hookPath, cleaned, 'utf-8');
      }
    }
  }
}
