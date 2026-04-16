import type { Command } from 'commander';
import { existsSync, accessSync, constants } from 'node:fs';
import { resolveConfig } from '../config.js';

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
}

export type CheckFn = () => DoctorCheck;

/**
 * Run a set of diagnostic checks and return structured results.
 * Exported separately so tests can exercise the logic without Commander.
 */
export function runDoctorChecks(checks: CheckFn[]): DoctorCheck[] {
  return checks.map((fn) => fn());
}

export function formatDoctorResults(results: DoctorCheck[]): string {
  const lines: string[] = ['ctxcore doctor\n'];

  for (const r of results) {
    const icon = r.passed ? '\u2714' : '\u2718';
    lines.push(`  ${icon} ${r.name}: ${r.message}`);
    if (!r.passed && r.fix) {
      lines.push(`    Fix: ${r.fix}`);
    }
  }

  const passCount = results.filter((r) => r.passed).length;
  lines.push(`\n${passCount}/${results.length} checks passed.`);
  return lines.join('\n');
}

function checkDatabaseExists(dbPath: string): DoctorCheck {
  const exists = existsSync(dbPath);
  return {
    name: 'Database exists',
    passed: exists,
    message: exists ? `Found at ${dbPath}` : `Not found at ${dbPath}`,
    fix: 'Run `ctxcore init` to create the database.',
  };
}

function checkDatabaseWritable(dbPath: string): DoctorCheck {
  if (!existsSync(dbPath)) {
    return {
      name: 'Database writable',
      passed: false,
      message: 'Database does not exist',
      fix: 'Run `ctxcore init` first.',
    };
  }
  try {
    accessSync(dbPath, constants.W_OK);
    return { name: 'Database writable', passed: true, message: 'Database is writable' };
  } catch {
    return {
      name: 'Database writable',
      passed: false,
      message: 'Database is not writable',
      fix: `Check file permissions on ${dbPath}`,
    };
  }
}

function checkOllamaRunning(ollamaUrl: string): DoctorCheck {
  // Synchronous check — we just verify the URL is configured.
  // Actual connectivity is best checked asynchronously; for doctor we report config.
  return {
    name: 'Ollama configured',
    passed: !!ollamaUrl,
    message: ollamaUrl ? `URL: ${ollamaUrl}` : 'No Ollama URL configured',
    fix: 'Ensure Ollama is running: `ollama serve`',
  };
}

function checkClaudeCliPath(claudeCliPath: string | undefined): DoctorCheck {
  if (!claudeCliPath) {
    return {
      name: 'Claude CLI',
      passed: false,
      message: 'Not configured',
      fix: 'Install Claude CLI: https://docs.anthropic.com/en/docs/claude-cli',
    };
  }
  const exists = existsSync(claudeCliPath);
  return {
    name: 'Claude CLI',
    passed: exists,
    message: exists ? `Found at ${claudeCliPath}` : `Not found at ${claudeCliPath}`,
    fix: 'Install Claude CLI or update path in .ctxcore.json',
  };
}

function checkModelConfigured(model: string): DoctorCheck {
  return {
    name: 'Embedding model',
    passed: !!model,
    message: model ? `Model: ${model}` : 'No model configured',
    fix: `Run: ollama pull <model>`,
  };
}

export function buildDefaultChecks(projectRoot: string): CheckFn[] {
  const config = resolveConfig(projectRoot);
  return [
    () => checkDatabaseExists(config.dbPath),
    () => checkDatabaseWritable(config.dbPath),
    () => checkOllamaRunning(config.ollamaUrl),
    () => checkModelConfigured(config.ollamaModel),
    () => checkClaudeCliPath(config.claudeCliPath),
  ];
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose installation issues')
    .action(() => {
      const projectRoot = process.cwd();
      const checks = buildDefaultChecks(projectRoot);
      const results = runDoctorChecks(checks);
      console.log(formatDoctorResults(results));

      const allPassed = results.every((r) => r.passed);
      if (!allPassed) {
        process.exitCode = 1;
      }
    });
}
