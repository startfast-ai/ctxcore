#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { createDatabase, createVecTable } from '../src/database.js';
import { MemoryStore } from '../src/memory-store.js';
import { OllamaEmbeddingClient, SqliteEmbeddingStore, createEmbeddingClient } from '../src/embeddings.js';
import { resolveConfig, saveProjectConfig, ensureGlobalDir, isValidEmbeddingModel } from '../src/config.js';
import { detectClaudeCli, verifyClaudeCli, ClaudeCliRunner, listAvailableModels } from '../src/claude-cli.js';
import { startServer } from '../src/server.js';
import { Ctxcore } from '../src/ctxcore.js';
import { EMBEDDING_MODELS, DEFAULT_EMBEDDING_MODEL, getEmbeddingDimensions } from '../src/types.js';
import type { Memory } from '../src/types.js';
import { Scheduler, maybeBackgroundReflexion } from '../src/scheduler.js';
import { registerPreferencesCommand } from '../src/cli/preferences.js';
import { registerDoctorCommand } from '../src/cli/doctor.js';
import { registerDiffCommand } from '../src/cli/diff.js';
import { registerHealthCommand, formatIntelligenceScore } from '../src/cli/health-cmd.js';
import { HealthCalculator, recordIntelligenceScore, computeTrend } from '../src/health.js';
import { registerAskCommand } from '../src/cli/ask.js';
import { registerVisualizeCommand } from '../src/cli/visualize.js';
import { registerUninstallCommand } from '../src/cli/uninstall.js';
import { registerUpdateCommand } from '../src/cli/update.js';
import { registerReflectCommand } from '../src/cli/reflect.js';
import { registerTaskCommand } from '../src/cli/task.js';
import { registerSpecCommand } from '../src/cli/spec.js';
import { registerResearchCommand } from '../src/cli/research.js';
import { registerContradictionsCommand } from '../src/cli/contradictions.js';
import { registerPatternsCommand } from '../src/cli/patterns.js';
import { registerHistoryCommand } from '../src/cli/history.js';
import { registerOnboardCommand } from '../src/cli/onboard.js';
import { ProjectScanner } from '../src/project-scanner.js';
import { MemorySeeder } from '../src/seed-memories.js';
import { ProjectAnalyzer } from '../src/project-analyzer.js';
import { ContextBuilder } from '../src/context-builder.js';
import { ClaudeMdManager } from '../src/claudemd.js';
import { registerMcpServer, isMcpServerRegistered } from '../src/mcp-register.js';
import { installHooks, uninstallHooks } from '../src/hooks-installer.js';
import { resolveAutoMemoryPath, importFromAutoMemory, exportToAutoMemory } from '../src/claude-memory-sync.js';
import { Progress, AnimatedStatus } from '../src/utils/progress.js';
import { interactiveSelect } from '../src/utils/select.js';

import {
  printLogo, printHeader, printDivider, printKeyValue,
  printSuccess, printWarning, printError, printInfo,
  printMemoryRow, printBox,
  tierBadge, importanceBar,
  DIM, BOLD, RESET, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE,
  BG_RED, BG_GREEN, BG_BLUE, BG_MAGENTA, BG_CYAN,
} from '../src/utils/ui.js';

function printMemoryTable(memories: Memory[]): void {
  for (const m of memories) {
    printMemoryRow(m.content, m.tier, m.importance);
  }
}

const OLLAMA_INSTALL_HINT = 'Ollama not running. Install: brew install ollama && ollama pull qwen3-embedding:0.6b';
const CLAUDE_CLI_HINT = 'Claude CLI not found. Reflexion disabled. Install: npm install -g @anthropic-ai/claude-code';

const CTXCORE_START_MARKER = '<!-- ctxcore:start -->';

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Re-initialization detection ──

interface InitStatus {
  memoryDb: boolean;
  projectConfig: boolean;
  claudeMdPatched: boolean;
  mcpRegistered: boolean;
  hooksInstalled: boolean;
  memoryCount: number;
}

function checkInitStatus(projectRoot: string): InitStatus {
  const dbPath = join(projectRoot, '.memory.db');
  const configPath = join(projectRoot, '.ctxcore.json');
  const claudeMdPath = join(projectRoot, 'CLAUDE.md');

  let claudeMdPatched = false;
  if (existsSync(claudeMdPath)) {
    try {
      const content = readFileSync(claudeMdPath, 'utf-8');
      claudeMdPatched = content.includes(CTXCORE_START_MARKER);
    } catch {
      // Ignore
    }
  }

  let memoryCount = 0;
  if (existsSync(dbPath)) {
    try {
      const db = createDatabase(dbPath);
      const store = new MemoryStore(db);
      memoryCount = store.stats().total;
      db.close();
    } catch {
      // DB exists but might be corrupted
    }
  }

  // Check if hooks are installed in .claude/settings.json
  let hooksInstalled = false;
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      hooksInstalled = !!settings.hooks && Object.values(settings.hooks).some(
        (groups: unknown) => Array.isArray(groups) && groups.some(
          (g: Record<string, unknown>) =>
            g.matcher === 'mcp__ctxcore__*' ||
            (Array.isArray(g.hooks) && g.hooks.some(
              (h: Record<string, unknown>) =>
                typeof h.command === 'string' && (h.command.includes('.ctxcore/hooks/') || h.command.startsWith('ctxcore '))
            ))
        )
      );
    } catch {
      // Ignore
    }
  }

  return {
    memoryDb: existsSync(dbPath),
    projectConfig: existsSync(configPath),
    claudeMdPatched,
    mcpRegistered: isMcpServerRegistered(projectRoot),
    hooksInstalled,
    memoryCount,
  };
}

function isFullyInitialized(status: InitStatus): boolean {
  return status.memoryDb && status.projectConfig && status.claudeMdPatched && status.mcpRegistered && status.hooksInstalled;
}

function isPartiallyInitialized(status: InitStatus): boolean {
  return (status.memoryDb || status.projectConfig || status.claudeMdPatched || status.mcpRegistered || status.hooksInstalled) && !isFullyInitialized(status);
}

// ── Gitignore update ──

function updateGitignore(projectRoot: string): void {
  const gitignorePath = join(projectRoot, '.gitignore');
  const entries = ['.memory.db', '.memory.db-wal', '.memory.db-shm'];
  const marker = '# ctxcore';

  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
  }

  // Check if ctxcore section already exists
  if (content.includes(marker)) {
    // Check each entry exists within the section
    const missing = entries.filter(e => !content.includes(e));
    if (missing.length === 0) return; // All entries present

    // Add missing entries after the marker
    const lines = content.split('\n');
    const markerIdx = lines.findIndex(l => l.trim() === marker);
    if (markerIdx >= 0) {
      for (const entry of missing) {
        lines.splice(markerIdx + 1, 0, entry);
      }
      writeFileSync(gitignorePath, lines.join('\n'), 'utf-8');
    }
    return;
  }

  // Add ctxcore section
  const section = `\n${marker}\n${entries.join('\n')}\n`;
  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  writeFileSync(gitignorePath, content + separator + section, 'utf-8');
}

// ── Ollama model pull ──

async function isOllamaRunning(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function isModelAvailable(baseUrl: string, model: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const data = (await response.json()) as { models: { name: string }[] };
    return data.models.some((m) => m.name.startsWith(model));
  } catch {
    return false;
  }
}

async function pullOllamaModel(baseUrl: string, model: string, progress: Progress): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
    });

    if (!response.ok || !response.body) {
      return false;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lastPercent = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line) as { total?: number; completed?: number; status?: string };
          if (data.total && data.completed) {
            const percent = Math.round((data.completed / data.total) * 100);
            if (percent > lastPercent) {
              progress.update(`Pulling ${model}... ${percent}%`);
              lastPercent = percent;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

interface InitOpts {
  model?: string;
  analysisModel?: string;
  force?: boolean;
  analysis?: boolean;
  mcp?: boolean;
  claudeMd?: boolean;
  claudeCli?: string;
  verbose?: boolean;
}

const program = new Command();

program
  .name('ctxcore')
  .description('Persistent, intelligent memory for Claude Code')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize ctxcore in the current project')
  .option('-m, --model <model>', 'Embedding model to use')
  .option('--force', 'Overwrite existing initialization without prompting')
  .option('--no-analysis', 'Skip Claude CLI analysis, just set up infrastructure')
  .option('--no-mcp', 'Do not register MCP server')
  .option('--no-claude-md', 'Do not patch CLAUDE.md')
  .option('--claude-cli <path>', 'Explicit path to Claude CLI binary')
  .option('--analysis-model <model>', 'Claude model for project analysis (e.g. haiku, sonnet, opus)')
  .option('--verbose', 'Show detailed output')
  .action(async (opts: InitOpts) => {
    const projectRoot = process.cwd();
    const progress = new Progress();
    const verbose = opts.verbose ?? false;

    printLogo();
    printHeader('Initializing');

    // ── Re-initialization detection ──
    const initStatus = checkInitStatus(projectRoot);

    let freshStart = false;
    let skipDb = false;
    let skipConfig = false;
    let skipClaudeMd = opts.claudeMd === false;
    let skipMcp = opts.mcp === false;

    if (isFullyInitialized(initStatus) && !opts.force) {
      console.log('  ctxcore is already initialized in this project.\n');
      console.log(`    .memory.db         ${initStatus.memoryDb ? '+ exists' : '- missing'}${initStatus.memoryDb ? ` (${initStatus.memoryCount} memories)` : ''}`);
      console.log(`    .ctxcore.json      ${initStatus.projectConfig ? '+ exists' : '- missing'}`);
      console.log(`    CLAUDE.md          ${initStatus.claudeMdPatched ? '+ patched' : '- not patched'}`);
      console.log(`    MCP server         ${initStatus.mcpRegistered ? '+ registered' : '- not registered'}`);
      console.log(`    Hooks              ${initStatus.hooksInstalled ? '+ installed' : '- not installed'}`);
      console.log();

      if (process.stdin.isTTY) {
        console.log('  What would you like to do?\n');
        const reinitChoice = await interactiveSelect([
          { label: 'Re-initialize', value: 'reinit', hint: 'keeps memories, re-analyzes project' },
          { label: 'Force fresh start', value: 'fresh', hint: 'deletes all memories and starts over' },
          { label: 'Cancel', value: 'cancel', hint: '' },
        ], 0);

        if (reinitChoice === 'cancel') {
          console.log('\n  Cancelled.');
          process.exit(0);
        } else if (reinitChoice === 'fresh') {
          freshStart = true;
        } else {
          // Re-initialize: keep db, re-analyze
          skipDb = true;
          skipConfig = false;
        }
        console.log();
      } else {
        console.log('  Use --force to re-initialize non-interactively.');
        process.exit(0);
      }
    } else if (isPartiallyInitialized(initStatus) && !opts.force) {
      console.log('  ctxcore is partially initialized. Resuming setup...\n');
      console.log(`    .memory.db         ${initStatus.memoryDb ? '+ exists (skipping)' : '- not found (will create)'}`);
      console.log(`    .ctxcore.json      ${initStatus.projectConfig ? '+ exists (skipping)' : '- not found (will create)'}`);
      console.log(`    CLAUDE.md          ${initStatus.claudeMdPatched ? '+ patched (skipping)' : '- not patched (will fix)'}`);
      console.log(`    MCP server         ${initStatus.mcpRegistered ? '+ registered (skipping)' : '- not registered (will fix)'}`);
      console.log(`    Hooks              ${initStatus.hooksInstalled ? '+ installed (will update)' : '- not installed (will fix)'}`);
      console.log();

      // Resume: skip already-completed steps
      skipDb = initStatus.memoryDb;
      skipConfig = initStatus.projectConfig;
      if (initStatus.claudeMdPatched) skipClaudeMd = true;
      if (initStatus.mcpRegistered) skipMcp = true;
    }

    if (opts.force) {
      freshStart = true;
    }

    // If fresh start, delete existing artifacts
    if (freshStart) {
      const { rmSync } = await import('node:fs');
      const dbPath = join(projectRoot, '.memory.db');
      const dbWal = join(projectRoot, '.memory.db-wal');
      const dbShm = join(projectRoot, '.memory.db-shm');
      for (const p of [dbPath, dbWal, dbShm]) {
        if (existsSync(p)) rmSync(p);
      }
      skipDb = false;
      skipConfig = false;
      skipClaudeMd = opts.claudeMd === false;
      skipMcp = opts.mcp === false;
    }

    // ── 1. Detect Claude CLI ──
    let claudePath: string | null = null;
    if (opts.claudeCli) {
      claudePath = opts.claudeCli;
      if (verifyClaudeCli(claudePath)) {
        if (verbose) console.log(`  Claude CLI (provided): ${claudePath}`);
      } else {
        console.error(`  Provided Claude CLI path is not valid: ${claudePath}`);
        claudePath = null;
      }
    } else {
      progress.start('Detecting Claude CLI...');
      claudePath = detectClaudeCli();
      if (claudePath && verifyClaudeCli(claudePath)) {
        progress.succeed(`Claude CLI found: ${claudePath}`);
      } else {
        progress.fail(CLAUDE_CLI_HINT);
        claudePath = null;
      }
    }

    // ── 2. Select embedding model ──
    let selectedModel: string;

    if (opts.model) {
      if (!isValidEmbeddingModel(opts.model)) {
        console.error(`\n  Invalid model: "${opts.model}"`);
        console.error('  Available models:');
        for (const [key, m] of Object.entries(EMBEDDING_MODELS)) {
          console.error(`    ${key} -- ${m.description}`);
        }
        process.exit(1);
      }
      selectedModel = opts.model;
    } else if (process.stdin.isTTY && !opts.force) {
      console.log('  Select embedding model:\n');
      const models = Object.entries(EMBEDDING_MODELS);
      const defaultIdx = models.findIndex(([key]) => key === DEFAULT_EMBEDDING_MODEL);

      const choice = await interactiveSelect(
        models.map(([key, m]) => ({
          label: key,
          value: key,
          hint: `${m.dimensions}d — ${m.description}`,
        })),
        defaultIdx >= 0 ? defaultIdx : 0,
      );
      selectedModel = choice;
    } else {
      selectedModel = DEFAULT_EMBEDDING_MODEL;
    }

    const modelInfo = EMBEDDING_MODELS[selectedModel];
    console.log(`  Embedding model: ${selectedModel} (${modelInfo.dimensions}d)`);

    // ── 3. Initialize embedding provider ──
    progress.start('Setting up embeddings...');
    const ollamaUrl = 'http://localhost:11434';
    let embeddingClient: import('../src/types.js').IEmbeddingClient | null = null;
    let embeddingDimensions = modelInfo.dimensions;
    let embeddingProviderName = 'none';

    try {
      const result = await createEmbeddingClient({
        provider: modelInfo.provider === 'ollama' ? 'ollama' : modelInfo.provider === 'transformers' ? 'transformers' : 'auto',
        ollamaUrl,
        ollamaModel: modelInfo.id,
        transformersModel: modelInfo.id,
        onProgress: (msg) => progress.update(msg),
      });
      embeddingClient = result.client;
      embeddingDimensions = result.dimensions || modelInfo.dimensions;
      embeddingProviderName = result.provider;

      if (result.provider === 'transformers') {
        progress.succeed(`Local embeddings ready (${selectedModel}, ${embeddingDimensions}d)`);
      } else if (result.provider === 'ollama') {
        progress.succeed(`Ollama embeddings ready (${selectedModel}, ${embeddingDimensions}d)`);
      } else {
        progress.fail('No embedding provider available — using keyword-only search');
      }
    } catch (err) {
      progress.fail(`Embeddings failed: ${(err as Error).message}`);
      console.log('  (will use keyword-only search)');
    }

    const ollamaOk = embeddingProviderName !== 'none';

    // ── 4. Create database ──
    const dimensions = embeddingDimensions;
    const config = resolveConfig(projectRoot);

    let db;
    if (skipDb) {
      db = createDatabase(config.dbPath);
      createVecTable(db, dimensions);
      if (verbose) console.log(`  Database already exists: ${config.dbPath}`);
    } else {
      db = createDatabase(config.dbPath);
      createVecTable(db, dimensions);
      console.log(`  Database created: ${config.dbPath}`);
    }

    // ── 5. Save project config ──
    if (!skipConfig) {
      saveProjectConfig(projectRoot, {
        ollamaModel: selectedModel,
        embeddingProvider: embeddingProviderName,
        claudeCliPath: claudePath ?? undefined,
      } as Record<string, unknown>);
      console.log('  Project config saved: .ctxcore.json');
    } else if (verbose) {
      console.log('  Project config already exists (skipping)');
    }

    // ── 6. Ensure global dir ──
    ensureGlobalDir();

    // ── 7. Scan project and seed initial memories ──
    progress.start('Scanning project structure...');
    const scanner = new ProjectScanner();
    const seeder = new MemorySeeder();
    const store = new MemoryStore(db);
    let signals;
    let seededMemories: Memory[] = [];
    try {
      signals = await scanner.scan(projectRoot);
      seededMemories = seeder.seed(signals, store);
      if (seededMemories.length > 0) {
        const langNames = signals.language?.map(l => l.name).join(' + ') ?? 'unknown';
        const fwNames = signals.framework?.map(f => f.name).join(' + ');
        const detected = fwNames ? `${langNames} + ${fwNames}` : langNames;
        progress.succeed(`Detected: ${detected}`);

        // Categorized breakdown
        const byTag: Record<string, number> = {};
        for (const m of seededMemories) {
          const cat = m.tags[0] ?? 'general';
          byTag[cat] = (byTag[cat] ?? 0) + 1;
        }
        console.log(`\n  Seeded ${BOLD}${seededMemories.length}${RESET} memories:`);
        for (const [tag, count] of Object.entries(byTag)) {
          console.log(`    ${DIM}${count}${RESET} ${tag}`);
        }
      } else {
        progress.succeed('No project signals detected (empty project?)');
      }
    } catch (err) {
      progress.fail(`Project scan failed: ${(err as Error).message}`);
      console.log('  (you can run `ctxcore rescan` later)');
    }

    // ── 8. Deep analysis via Claude CLI (if available and not skipped) ──
    let analysisMemories: Memory[] = [];
    const skipAnalysis = opts.analysis === false;
    if (!skipAnalysis && claudePath && verifyClaudeCli(claudePath) && signals) {
      console.log();

      // Select analysis model
      let analysisModel: string = 'sonnet';

      if (opts.analysisModel) {
        analysisModel = opts.analysisModel;
      } else if (process.stdin.isTTY && !opts.force) {
        const models = listAvailableModels(claudePath);
        const defaultIdx = models.indexOf('sonnet');

        console.log('  Select Claude model for analysis:\n');
        const MODEL_HINTS: Record<string, string> = {
          haiku: 'fastest, cheapest',
          sonnet: 'balanced — recommended',
          opus: 'most capable, slowest',
        };

        analysisModel = await interactiveSelect(
          models.map(m => ({
            label: m,
            value: m,
            hint: MODEL_HINTS[m] ?? '',
          })),
          defaultIdx >= 0 ? defaultIdx : 0,
        );
      }

      console.log(`  Analysis model: ${analysisModel}`);

      const analysisStatus = new AnimatedStatus([
        `Claude (${analysisModel}) is reading your project...`,
        'Analyzing architecture and patterns...',
        'Mapping dependencies and data flow...',
        'Identifying conventions and decisions...',
        'Extracting key insights from code...',
        'Building knowledge graph connections...',
        'Evaluating infrastructure and deployment...',
        'Looking for security and performance patterns...',
        'Almost there, generating memories...',
      ], progress);

      analysisStatus.start();

      try {
        const cliRunner = new ClaudeCliRunner(claudePath, analysisModel);
        const analyzer = new ProjectAnalyzer(cliRunner);
        analysisMemories = await analyzer.analyze(projectRoot, signals, store, (file) => {
          analysisStatus.pin(`Reading ${file}...`);
        });
        if (analysisMemories.length > 0) {
          analysisStatus.succeed(`Claude generated ${analysisMemories.length} insights`);
          console.log();
          printMemoryTable(analysisMemories);
        } else {
          analysisStatus.succeed('Claude analysis complete (no additional insights)');
        }
      } catch (err) {
        analysisStatus.fail(`Claude analysis failed: ${(err as Error).message}`);
        console.log('  (you can run `ctxcore reflect` later)');
      }
    }

    // ── 8.5. Batch embed seeded memories ──
    if (embeddingClient && embeddingProviderName !== 'none') {
      const allMemories = [...seededMemories, ...analysisMemories];
      if (allMemories.length > 0) {
        const embedStatus = new AnimatedStatus([
          `Embedding ${allMemories.length} memories into vector space...`,
          'Computing semantic representations...',
          'Building similarity index...',
          'Encoding project knowledge...',
        ], progress);
        embedStatus.start();
        try {
          const embeddingStore = new SqliteEmbeddingStore(db);
          const texts = allMemories.map(m => m.content);
          const embeddings = await embeddingClient.embedBatch(texts);
          for (let i = 0; i < allMemories.length; i++) {
            embeddingStore.store(allMemories[i].id, embeddings[i]);
          }
          embedStatus.succeed(`Embedded ${allMemories.length} memories`);
        } catch (err) {
          embedStatus.fail(`Embedding failed: ${(err as Error).message}`);
          if (verbose) console.log('  (memories stored without embeddings)');
        }
      }
    }

    // ── 9. Patch CLAUDE.md ──
    if (!skipClaudeMd) {
      console.log();
      progress.start('Patching CLAUDE.md...');
      try {
        const contextBuilder = new ContextBuilder(store);
        const claudeMd = new ClaudeMdManager(contextBuilder);
        claudeMd.patch(projectRoot);
        progress.succeed('CLAUDE.md updated with memory tools and project context');
      } catch (err) {
        progress.fail(`Failed to patch CLAUDE.md: ${(err as Error).message}`);
      }
    }

    // ── 9.5. Update .gitignore ──
    progress.start('Updating .gitignore...');
    try {
      updateGitignore(projectRoot);
      progress.succeed('.gitignore updated with ctxcore entries');
    } catch (err) {
      progress.fail(`Failed to update .gitignore: ${(err as Error).message}`);
    }

    // ── 10. Register MCP server ──
    if (!skipMcp) {
      progress.start('Registering MCP server...');
      const registered = registerMcpServer(projectRoot);
      if (registered) {
        progress.succeed('MCP server registered in .mcp.json');
      } else {
        progress.fail('Could not register MCP server (create .mcp.json manually)');
      }
    }

    // ── 10.5. Install hooks into .claude/settings.json ──
    progress.start('Installing hooks...');
    try {
      installHooks(projectRoot);
      progress.succeed('Hooks installed in .claude/settings.json');
    } catch (err) {
      progress.fail(`Failed to install hooks: ${(err as Error).message}`);
    }

    // ── 10.6. Install nightly reflexion schedule ──
    progress.start('Setting up nightly reflexion...');
    try {
      const scheduler = new Scheduler();
      const existingCron = scheduler.getCronStatus();
      if (!existingCron) {
        scheduler.installCron('23 2 * * *', 'ctxcore reflect --auto --quiet');
        progress.succeed('Nightly reflexion scheduled (launchd, survives sleep)');
      } else {
        progress.succeed(`Reflexion already scheduled (${existingCron.schedule})`);
      }
    } catch (err) {
      progress.fail(`Failed to set up reflexion schedule: ${(err as Error).message}`);
    }

    // ── 10.7. Sync with Claude auto memory ──
    progress.start('Syncing with Claude auto memory...');
    try {
      const memoryDir = resolveAutoMemoryPath(projectRoot);
      const importCount = importFromAutoMemory(store, memoryDir);
      exportToAutoMemory(store, memoryDir);
      if (importCount > 0) {
        progress.succeed(`Claude auto memory: imported ${importCount}, exported knowledge`);
      } else {
        progress.succeed('Claude auto memory: exported knowledge');
      }
    } catch (err) {
      progress.fail(`Auto memory sync failed: ${(err as Error).message}`);
    }

    // ── Intelligence Score ──
    const stats = store.stats();
    const initCalculator = new HealthCalculator();
    const initScore = initCalculator.calculateIntelligence(store);
    try {
      recordIntelligenceScore(db, initScore, 'init');
    } catch {
      // Non-critical
    }

    const projectName = basename(projectRoot);
    const primaryLang = signals?.language?.[0]?.name ?? 'unknown';
    const framework = signals?.framework?.[0]?.name ?? 'none';

    db.close();

    printDivider();
    printHeader('Ready');

    printKeyValue('Project', `${BOLD}${projectName}${RESET}`);
    printKeyValue('Language', primaryLang);
    printKeyValue('Framework', framework);
    printKeyValue('Memories', `${BOLD}${stats.total}${RESET} stored`);
    printKeyValue('Embedding', `${selectedModel} via ${embeddingProviderName} (${embeddingDimensions}d)`);
    printKeyValue('Intelligence', `${BOLD}${initScore.total}/100${RESET}`);
    console.log();

    printKeyValue('Claude CLI', claudePath ? `${GREEN}available${RESET}` : `${YELLOW}not found${RESET}`);
    printKeyValue('Embeddings', embeddingProviderName !== 'none' ? `${GREEN}${embeddingProviderName}${RESET}` : `${YELLOW}keyword-only${RESET}`);
    console.log();

    const artifacts = [
      `.memory.db     ${DIM}${stats.total} memories${RESET}`,
      `.ctxcore.json  ${DIM}config${RESET}`,
      `CLAUDE.md      ${skipClaudeMd ? `${DIM}skipped${RESET}` : `${GREEN}patched${RESET}`}`,
      `.gitignore     ${GREEN}updated${RESET}`,
      `MCP server     ${skipMcp ? `${DIM}skipped${RESET}` : `${GREEN}registered${RESET}`}`,
      `Hooks          ${GREEN}installed${RESET}`,
      `Reflexion      ${GREEN}nightly + on-demand (background)${RESET}`,
    ];
    printBox(artifacts);

    console.log();
    console.log(`  ${BOLD}Next steps:${RESET}`);
    console.log(`    ${CYAN}1.${RESET} Restart Claude Code to activate MCP server`);
    console.log(`    ${CYAN}2.${RESET} Run ${CYAN}ctxcore status${RESET} to verify`);
    console.log(`    ${CYAN}3.${RESET} Run ${CYAN}ctxcore doctor${RESET} to check system health`);
    if (!claudePath) {
      console.log(`    ${CYAN}4.${RESET} Install Claude CLI: ${DIM}npm i -g @anthropic-ai/claude-code${RESET}`);
    }
    if (!ollamaOk) {
      console.log(`    ${CYAN}${claudePath ? '4' : '5'}.${RESET} Start Ollama: ${DIM}ollama pull ${selectedModel}${RESET}`);
    }
    console.log();
  });

program
  .command('store')
  .description('Store a new memory')
  .argument('<content>', 'Memory content')
  .option('-t, --tier <tier>', 'Memory tier', 'short-term')
  .option('-i, --importance <n>', 'Importance score (0-1)', parseFloat)
  .option('--tags <tags...>', 'Tags')
  .action(async (content: string, opts: { tier?: string; importance?: number; tags?: string[] }) => {
    const ctx = await Ctxcore.create(process.cwd());

    const memory = ctx.memoryStore.create({
      content,
      tier: (opts.tier as 'short-term' | 'operational' | 'long-term') ?? 'short-term',
      importance: opts.importance,
      tags: opts.tags,
    });

    try {
      const embedding = await ctx.embeddingClient.embed(content);
      ctx.embeddingStore.store(memory.id, embedding);
      printSuccess(`Memory stored ${DIM}${memory.id.slice(0, 8)}${RESET}`);
      printMemoryRow(content, memory.tier, memory.importance);
    } catch {
      printWarning(`Memory stored without embedding ${DIM}${memory.id.slice(0, 8)}${RESET}`);
      printMemoryRow(content, memory.tier, memory.importance);
    }

    ctx.close();
  });

program
  .command('search')
  .description('Search memories')
  .argument('<query>', 'Search query')
  .option('-n, --limit <n>', 'Max results', parseInt, 10)
  .option('-t, --tier <tier>', 'Filter by tier')
  .action(async (query: string, opts: { limit: number; tier?: string }) => {
    const ctx = await Ctxcore.create(process.cwd());

    const results = await ctx.retrievalEngine.search(query, {
      limit: opts.limit,
      tier: opts.tier as 'short-term' | 'operational' | 'long-term' | undefined,
    });

    if (results.length === 0) {
      console.log(`\n  ${DIM}No memories found for "${query}"${RESET}\n`);
    } else {
      console.log(`\n  ${DIM}Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}"${RESET}\n`);
      for (const r of results) {
        const badge = tierBadge(r.memory.tier);
        const score = `${DIM}${r.score.toFixed(2)}${RESET}`;
        const matchIcon = r.matchType === 'vector' ? `${MAGENTA}vec${RESET}` :
                          r.matchType === 'hybrid' ? `${GREEN}hyb${RESET}` :
                          `${DIM}key${RESET}`;
        console.log(`  ${badge} ${score} ${matchIcon}  ${r.memory.content}`);
        if (r.memory.tags.length > 0) {
          console.log(`               ${DIM}${r.memory.tags.join(', ')}${RESET}`);
        }
      }
      console.log();
    }

    ctx.close();
  });

program
  .command('status')
  .description('Show intelligence score and memory status')
  .action(() => {
    const projectRoot = process.cwd();
    const config = resolveConfig(projectRoot);
    if (!existsSync(config.dbPath)) {
      printError('Not initialized. Run `ctxcore init` first.');
      process.exit(1);
    }

    const db = createDatabase(config.dbPath);
    createVecTable(db, getEmbeddingDimensions(config.ollamaModel));
    const store = new MemoryStore(db);
    const stats = store.stats();

    const mInfo = isValidEmbeddingModel(config.ollamaModel)
      ? EMBEDDING_MODELS[config.ollamaModel]
      : null;

    // Intelligence Score
    const calculator = new HealthCalculator();
    const score = calculator.calculateIntelligence(store);
    const trend = computeTrend(db);
    score.trend = trend;

    const projectName = basename(projectRoot);
    printHeader(`${projectName}`);
    console.log(formatIntelligenceScore(score, trend));
    console.log();

    printKeyValue('Model', `${config.ollamaModel}${mInfo ? ` (${mInfo.dimensions}d)` : ''}`);
    printKeyValue('Provider', `${config.embeddingProvider ?? 'auto'}`);
    printKeyValue('Memories', `${BOLD}${stats.total}${RESET} active, ${stats.archived} archived`);
    console.log();

    // Tier bar chart
    const total = stats.total || 1;
    const maxBar = 25;
    const tiers: Array<[string, string, string]> = [
      ['long-term', BG_MAGENTA, MAGENTA],
      ['operational', BG_BLUE, BLUE],
      ['short-term', BG_GREEN, GREEN],
    ];

    for (const [tier, _bg, color] of tiers) {
      const count = stats.byTier[tier] ?? 0;
      const barLen = Math.max(0, Math.round((count / total) * maxBar));
      const bar = `${color}${'█'.repeat(barLen)}${DIM}${'░'.repeat(maxBar - barLen)}${RESET}`;
      const badge = tierBadge(tier);
      console.log(`    ${badge} ${bar} ${count}`);
    }

    // Recent memories preview
    const recent = store.list({ limit: 5 });
    if (recent.length > 0) {
      console.log();
      console.log(`  ${DIM}Recent memories:${RESET}`);
      for (const m of recent) {
        printMemoryRow(m.content, m.tier, m.importance);
      }
    }

    console.log();
    db.close();
  });

program
  .command('serve')
  .description('Start MCP server (used by Claude Code)')
  .option('--project <path>', 'Project root path')
  .action(async (opts: { project?: string }) => {
    const projectRoot = opts.project ?? process.env.CTXCORE_PROJECT_ROOT ?? process.cwd();
    await startServer(projectRoot);
  });

// Phase 5: User Profiling — preferences subcommands
registerPreferencesCommand(program);

// Phase 8: Observability & Health
registerDoctorCommand(program);
registerDiffCommand(program);
registerHealthCommand(program);

// Phase 9: Advanced Features
registerAskCommand(program);

// Phase 10: Distribution & Polish
registerVisualizeCommand(program);
registerUninstallCommand(program);
registerUpdateCommand(program);
registerReflectCommand(program);

// Phase 4: Task & Spec CLI commands
registerTaskCommand(program);
registerSpecCommand(program);

// Deep research command
registerResearchCommand(program);

// Phase 4: Contradictions & Patterns
registerContradictionsCommand(program);
registerPatternsCommand(program);
registerHistoryCommand(program);

// Phase 6: Compound intelligence
registerOnboardCommand(program);

// ── Phase 7: Schedule command ──

const scheduleCmd = program
  .command('schedule')
  .description('Manage automated reflexion schedule');

scheduleCmd
  .option('--cron <schedule>', 'Set up automated reflexion at given cron schedule')
  .option('--remove', 'Remove cron entry')
  .option('--status', 'Show current schedule')
  .action((opts: { cron?: string; remove?: boolean; status?: boolean }) => {
    const scheduler = new Scheduler();

    if (opts.status) {
      const status = scheduler.getCronStatus();
      if (status) {
        console.log('ctxcore schedule\n');
        console.log(`  Schedule: ${status.schedule}`);
        console.log(`  Command:  ${status.command}`);
      } else {
        console.log('No ctxcore cron schedule configured.');
      }
      return;
    }

    if (opts.remove) {
      scheduler.removeCron();
      console.log('Removed ctxcore cron entry.');
      return;
    }

    if (opts.cron) {
      const command = 'ctxcore reflect --auto --quiet';
      scheduler.installCron(opts.cron, command);
      const isMac = process.platform === 'darwin';
      console.log(`Installed reflexion schedule${isMac ? ' (launchd — survives sleep/restart)' : ' (crontab)'}`);
      console.log(`  Command: ${command}`);
      console.log(`  Modes:   consolidation + contradictions + patterns + recalibration`);
      if (isMac) {
        console.log(`  Note:    Runs missed jobs when Mac wakes up`);
      }
      return;
    }

    console.log('Usage: ctxcore schedule --cron "0 2 * * *" | --remove | --status');
  });

// ── Phase 7: Hooks command ──

const hooksCmd = program
  .command('hooks')
  .description('Manage git hooks for ctxcore');

hooksCmd
  .command('install')
  .description('Install git hooks (post-commit, post-merge)')
  .action(() => {
    const scheduler = new Scheduler();
    const projectRoot = process.cwd();
    try {
      scheduler.installGitHooks(projectRoot);
      console.log('Installed ctxcore git hooks:');
      console.log('  post-commit: ctxcore reflect --consolidate --auto');
      console.log('  post-merge:  ctxcore rescan --incremental');
    } catch (err) {
      console.error(`Failed to install hooks: ${(err as Error).message}`);
      process.exit(1);
    }
  });

hooksCmd
  .command('uninstall')
  .description('Remove ctxcore git hooks')
  .action(() => {
    const scheduler = new Scheduler();
    const projectRoot = process.cwd();
    try {
      scheduler.removeGitHooks(projectRoot);
      console.log('Removed ctxcore git hooks.');
    } catch (err) {
      console.error(`Failed to remove hooks: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── Phase 8: Export command ──

program
  .command('export')
  .description('Dump all memories as JSON to stdout')
  .option('--include-archived', 'Include archived memories')
  .action((opts: { includeArchived?: boolean }) => {
    const config = resolveConfig(process.cwd());
    if (!existsSync(config.dbPath)) {
      console.error('Not initialized. Run `ctxcore init` first.');
      process.exit(1);
    }

    const db = createDatabase(config.dbPath);
    createVecTable(db, getEmbeddingDimensions(config.ollamaModel));
    const store = new MemoryStore(db);
    const memories = store.list({ includeArchived: !!opts.includeArchived, limit: 100000 });

    const exported = memories.map((m) => ({
      ...m,
      connections: store.getConnectionsFor(m.id),
    }));

    console.log(JSON.stringify(exported, null, 2));
    db.close();
  });

// ── Phase 6: Rescan command ──

program
  .command('rescan')
  .description('Re-analyze project and update memories')
  .option('--incremental', 'Only analyze changes since last scan (uses git)')
  .action(async (opts: { incremental?: boolean }) => {
    const projectRoot = process.cwd();
    const progress = new Progress();
    const ctx = await Ctxcore.create(projectRoot);

    const scanner = ctx.projectScanner;
    const seeder = ctx.memorySeeder;

    try {
      let signals;
      if (opts.incremental) {
        // Use last scan timestamp from metadata or default to 1 week ago
        const lastScan = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        progress.start('Running incremental scan...');
        signals = await scanner.scanIncremental(projectRoot, lastScan);
      } else {
        progress.start('Running full project scan...');
        signals = await scanner.scan(projectRoot);
      }

      const memories = seeder.seed(signals, ctx.memoryStore);
      if (memories.length > 0) {
        progress.succeed(`Seeded ${memories.length} memories from project analysis.`);
      } else {
        progress.succeed('No new signals detected.');
      }
    } catch (err) {
      progress.fail(`Rescan failed: ${(err as Error).message}`);
      process.exit(1);
    }

    // Ensure reflexion cron is installed
    try {
      const scheduler = new Scheduler();
      if (!scheduler.getCronStatus()) {
        scheduler.installCron('23 2 * * *', 'ctxcore reflect --auto');
        progress.start('');
        progress.succeed('Nightly reflexion schedule installed (2:23 AM)');
      }
    } catch {
      // Non-critical — skip silently
    }

    ctx.close();
  });

// ── Sync command ──

program
  .command('sync')
  .description('Sync memories with Claude auto memory')
  .option('--import', 'One-way: Claude auto memory → ctxcore')
  .option('--export', 'One-way: ctxcore → Claude auto memory')
  .action(async (opts: { import?: boolean; export?: boolean }) => {
    const projectRoot = process.cwd();
    const config = resolveConfig(projectRoot);
    if (!existsSync(config.dbPath)) {
      console.error('Not initialized. Run `ctxcore init` first.');
      process.exit(1);
    }

    const dimensions = getEmbeddingDimensions(config.ollamaModel);
    const db = createDatabase(config.dbPath);
    createVecTable(db, dimensions);
    const syncStore = new MemoryStore(db);
    const memoryDir = resolveAutoMemoryPath(projectRoot);

    const doImport = opts.import || (!opts.import && !opts.export);
    const doExport = opts.export || (!opts.import && !opts.export);

    if (doImport) {
      const count = importFromAutoMemory(syncStore, memoryDir);
      console.log(`Imported ${count} memories from Claude auto memory`);
    }

    if (doExport) {
      exportToAutoMemory(syncStore, memoryDir);
      console.log('Exported memories to Claude auto memory');
    }

    db.close();
  });

// ── Background reflexion: silently run if >24h stale ──
// Skips if this IS the background reflexion process, or if running init/serve/reflect
const runningCommand = process.argv[2];
const skipBackgroundFor = ['init', 'reflect', 'serve', 'uninstall', 'schedule', 'hooks'];
if (!process.env.CTXCORE_BACKGROUND && !skipBackgroundFor.includes(runningCommand)) {
  maybeBackgroundReflexion();
}

program.parse();
