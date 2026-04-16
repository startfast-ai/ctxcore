import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createDatabase, createVecTable } from '../database.js';
import { MemoryStore } from '../memory-store.js';
import { resolveConfig } from '../config.js';
import { ClaudeCliRunner } from '../claude-cli.js';
import { ReflexionEngine } from '../reflexion.js';
import { ReflexionApplicator } from '../reflexion-applicator.js';
import type { ReflexionResult, ReflexionSuggestion } from '../types.js';
import { getEmbeddingDimensions } from '../types.js';
import { Progress } from '../utils/progress.js';
import { touchLastReflexion } from '../scheduler.js';
import { HealthCalculator, recordIntelligenceScore } from '../health.js';

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatSuggestion(s: ReflexionSuggestion, index: number): string {
  const lines: string[] = [];
  lines.push(`  ${index + 1}. [${s.action}] targets: ${s.targetIds.join(', ')}`);
  lines.push(`     reason: ${s.reason}`);
  if (s.data) {
    const dataStr = JSON.stringify(s.data);
    if (dataStr.length <= 120) {
      lines.push(`     data: ${dataStr}`);
    }
  }
  return lines.join('\n');
}

function printResults(results: ReflexionResult[]): void {
  for (const r of results) {
    console.log(`\n  [${r.type}] ${r.suggestions.length} suggestion(s), ${r.memoriesAffected.length} memories affected`);
    for (let i = 0; i < r.suggestions.length; i++) {
      console.log(formatSuggestion(r.suggestions[i], i));
    }
  }
}

export function registerReflectCommand(program: Command): void {
  program
    .command('reflect')
    .description('Run reflexion cycle to analyze and improve the knowledge base')
    .option('--contradictions', 'Run contradiction detection only')
    .option('--consolidate', 'Run consolidation only')
    .option('--patterns', 'Run pattern detection only')
    .option('--recalibrate', 'Run importance recalibration only')
    .option('--model <model>', 'Claude model to use (e.g. haiku, sonnet, opus)')
    .option('--dry-run', 'Show suggestions without applying')
    .option('--auto', 'Auto-apply suggestions without confirmation')
    .option('--quiet', 'Suppress all output (for background/scheduled runs)')
    .action(
      async (opts: {
        contradictions?: boolean;
        consolidate?: boolean;
        patterns?: boolean;
        recalibrate?: boolean;
        model?: string;
        dryRun?: boolean;
        auto?: boolean;
        quiet?: boolean;
      }) => {
        const log = opts.quiet ? (..._args: unknown[]) => {} : console.log;
        const logError = opts.quiet ? (..._args: unknown[]) => {} : console.error;
        const projectRoot = process.cwd();
        const config = resolveConfig(projectRoot);

        if (!existsSync(config.dbPath)) {
          logError('Not initialized. Run `ctxcore init` first.');
          process.exit(1);
        }

        if (!config.claudeCliPath) {
          logError('Claude CLI not configured. Reflexion requires Claude CLI.');
          logError('Install: npm install -g @anthropic-ai/claude-code');
          process.exit(1);
        }

        const db = createDatabase(config.dbPath);
        createVecTable(db, getEmbeddingDimensions(config.ollamaModel));
        const store = new MemoryStore(db);
        const cli = new ClaudeCliRunner(config.claudeCliPath, opts.model ?? 'sonnet');
        const engine = new ReflexionEngine(cli);
        const progress = opts.quiet ? { start: () => {}, succeed: () => {}, fail: () => {} } : new Progress();

        const memories = store.list({ includeArchived: false });
        if (memories.length === 0) {
          log('No memories found. Store some memories first.');
          db.close();
          touchLastReflexion();
          return;
        }

        log(`\nReflexion cycle — ${memories.length} memories\n`);

        const results: ReflexionResult[] = [];

        // Determine which modes to run
        const specificMode =
          opts.contradictions || opts.consolidate || opts.patterns || opts.recalibrate;

        if (!specificMode || opts.consolidate) {
          progress.start('Running consolidation analysis...');
          const r = await engine.runConsolidation(memories);
          results.push(r);
          progress.succeed(`Consolidation: ${r.suggestions.length} suggestion(s)`);
        }

        if (!specificMode || opts.contradictions) {
          progress.start('Detecting contradictions...');
          const r = await engine.detectContradictions(memories);
          results.push(r);
          progress.succeed(`Contradictions: ${r.suggestions.length} suggestion(s)`);
        }

        if (!specificMode || opts.patterns) {
          progress.start('Finding patterns...');
          const r = await engine.findPatterns(memories);
          results.push(r);
          progress.succeed(`Patterns: ${r.suggestions.length} suggestion(s)`);
        }

        if (!specificMode || opts.recalibrate) {
          progress.start('Recalibrating importance...');
          const r = await engine.recalibrateImportance(memories);
          results.push(r);
          progress.succeed(`Recalibration: ${r.suggestions.length} suggestion(s)`);
        }

        const allSuggestions = results.flatMap((r) => r.suggestions);

        if (allSuggestions.length === 0) {
          log('\nNo suggestions — knowledge base looks good.');
          db.close();
          touchLastReflexion();
          return;
        }

        if (!opts.quiet) printResults(results);

        if (opts.dryRun) {
          log(`\n  Dry run — ${allSuggestions.length} suggestion(s) not applied.`);
          db.close();
          return;
        }

        let shouldApply = false;

        if (opts.auto) {
          shouldApply = true;
        } else if (process.stdin.isTTY) {
          const answer = await prompt(
            `\nApply ${allSuggestions.length} suggestion(s)? [y/N] `,
          );
          shouldApply = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
        } else {
          // Non-interactive without --auto: don't apply
          log('\n  Non-interactive mode — use --auto to apply without confirmation.');
          db.close();
          return;
        }

        if (shouldApply) {
          const applicator = new ReflexionApplicator();
          const result = applicator.apply(allSuggestions, store);

          log(`\n  Applied: ${result.applied}`);
          log(`  Skipped: ${result.skipped}`);
          if (result.errors.length > 0) {
            log(`  Errors:`);
            for (const err of result.errors) {
              log(`    - ${err}`);
            }
          }
        } else {
          log('\n  Suggestions not applied.');
        }

        // Record intelligence score after reflexion
        try {
          const calc = new HealthCalculator();
          const score = calc.calculateIntelligence(store);
          recordIntelligenceScore(db, score, 'reflexion');
        } catch {
          // Non-critical
        }

        touchLastReflexion();
        db.close();
      },
    );
}
