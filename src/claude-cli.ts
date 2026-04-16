import { existsSync } from 'node:fs';
import { execSync, execFile } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { IClaudeCliRunner } from './types.js';

const KNOWN_PATHS = [
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
  join(homedir(), '.npm-global/bin/claude'),
  join(homedir(), '.claude/bin/claude'),
];

export function detectClaudeCli(): string | null {
  // Check PATH first
  try {
    const path = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (path && existsSync(path)) return path;
  } catch {
    // Not in PATH
  }

  // Check known install locations
  for (const p of KNOWN_PATHS) {
    if (existsSync(p)) return p;
  }

  return null;
}

export function verifyClaudeCli(path: string): boolean {
  try {
    execSync(`"${path}" --version`, { encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps the runClaudeCli function as a class implementing IClaudeCliRunner.
 * Allows dependency injection in components that need to call Claude CLI.
 */
export class ClaudeCliRunner implements IClaudeCliRunner {
  constructor(
    private readonly cliPath: string,
    private readonly model?: string,
  ) {}

  async run(prompt: string, options?: { timeout?: number }): Promise<string> {
    return runClaudeCli(this.cliPath, prompt, { ...options, model: this.model });
  }
}

/**
 * List available model aliases from Claude CLI.
 */
export function listAvailableModels(cliPath: string): string[] {
  try {
    const output = execSync(`"${cliPath}" --help`, { encoding: 'utf-8', timeout: 5000 });
    // Extract model aliases from help text
    const modelMatch = output.match(/alias for the latest model \(e\.g\. '([^']+)' or '([^']+)'\)/);
    const models: string[] = [];
    if (modelMatch) {
      if (modelMatch[1]) models.push(modelMatch[1]);
      if (modelMatch[2]) models.push(modelMatch[2]);
    }
    // Known aliases — Claude CLI accepts these
    const knownAliases = ['haiku', 'sonnet', 'opus'];
    for (const alias of knownAliases) {
      if (!models.includes(alias)) models.push(alias);
    }
    return models;
  } catch {
    return ['haiku', 'sonnet', 'opus'];
  }
}

export async function runClaudeCli(
  cliPath: string,
  prompt: string,
  options?: { timeout?: number; maxTokens?: number; model?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'text'];
    if (options?.model) {
      args.push('--model', options.model);
    }
    if (options?.maxTokens) {
      args.push('--max-turns', '1');
    }
    args.push(prompt);

    execFile(
      cliPath,
      args,
      {
        timeout: options?.timeout ?? 60_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Claude CLI failed: ${error.message}\n${stderr}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}
