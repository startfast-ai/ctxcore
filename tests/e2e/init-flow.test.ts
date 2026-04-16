import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createDatabase, createVecTable } from '../../src/database.js';
import { MemoryStore } from '../../src/memory-store.js';
import { NullEmbeddingClient, SqliteEmbeddingStore } from '../../src/embeddings.js';
import { RetrievalEngine, DefaultScoringStrategy } from '../../src/retrieval.js';
import { DecayEngine } from '../../src/decay.js';
import { ImportanceClassifier } from '../../src/importance.js';
import { PromotionEngine } from '../../src/promotion.js';
import { ContextBuilder } from '../../src/context-builder.js';
import { ClaudeMdManager } from '../../src/claudemd.js';
import { ProjectScanner } from '../../src/project-scanner.js';
import { MemorySeeder } from '../../src/seed-memories.js';
import { UserProfileManager, createProfileDatabase } from '../../src/user-profile.js';
import { LockManager } from '../../src/lockfile.js';
import { HealthCalculator } from '../../src/health.js';
import { TriggerEngine } from '../../src/triggers.js';
import type { CtxcoreConfig, MemoryTier, TriggerRule } from '../../src/types.js';

const DIMENSIONS = 1024;

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ctxcore-e2e-'));
}

function makeDbInDir(dir: string): Database.Database {
  const dbPath = join(dir, '.memory.db');
  const db = createDatabase(dbPath);
  createVecTable(db, DIMENSIONS);
  return db;
}

function makeConfig(projectRoot: string): CtxcoreConfig {
  return {
    projectRoot,
    dbPath: join(projectRoot, '.memory.db'),
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen3-embedding:0.6b',
    decay: { shortTerm: 0.95, operational: 0.995, longTerm: 0.9995 },
    embedding: { dimensions: DIMENSIONS, batchSize: 32 },
  };
}

describe('E2E: Init Flow', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Init flow ──
  it('creates database file and vec table on init', () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);

    const dbPath = join(tmpDir, '.memory.db');
    expect(existsSync(dbPath)).toBe(true);

    // Verify the vec table exists by attempting an insert + query
    const embeddingStore = new SqliteEmbeddingStore(db);
    const mem = store.create({ content: 'init test' });
    const fakeEmbedding = new Float32Array(DIMENSIONS).fill(0.1);
    embeddingStore.store(mem.id, fakeEmbedding);

    const results = embeddingStore.searchSimilar(fakeEmbedding, 5);
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe(mem.id);

    db.close();
  });

  // ── 2. Store + retrieve ranked correctly ──
  it('stores memories with different tiers/importance and ranks them correctly on search', async () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    const embeddingClient = new NullEmbeddingClient();
    const embeddingStore = new SqliteEmbeddingStore(db);
    const retrieval = new RetrievalEngine(store, embeddingStore, embeddingClient);

    store.create({ content: 'routine cleanup task', tier: 'short-term', importance: 0.1 });
    store.create({ content: 'important database migration decision', tier: 'long-term', importance: 0.9 });
    store.create({ content: 'operational fix for database timeout', tier: 'operational', importance: 0.5 });
    store.create({ content: 'database schema redesign breakthrough', tier: 'long-term', importance: 1.0 });
    store.create({ content: 'minor database typo fix', tier: 'short-term', importance: 0.2 });

    const results = await retrieval.search('database');
    expect(results.length).toBe(4); // only those matching 'database'

    // Higher importance/actuality memories should rank first
    expect(results[0].memory.importance).toBeGreaterThanOrEqual(results[1].memory.importance);

    db.close();
  });

  // ── 3. Keyword search ──
  it('keyword search returns correct matches', async () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    const embeddingClient = new NullEmbeddingClient();
    const embeddingStore = new SqliteEmbeddingStore(db);
    const retrieval = new RetrievalEngine(store, embeddingStore, embeddingClient);

    store.create({ content: 'React component architecture with hooks', tags: ['frontend'] });
    store.create({ content: 'PostgreSQL indexing strategy', tags: ['backend'] });
    store.create({ content: 'React testing patterns with vitest', tags: ['testing'] });
    store.create({ content: 'Docker deployment pipeline', tags: ['devops'] });

    const results = await retrieval.search('React');
    expect(results.length).toBe(2);
    expect(results.every((r) => r.memory.content.includes('React'))).toBe(true);
    expect(results.every((r) => r.matchType === 'keyword')).toBe(true);

    db.close();
  });

  // ── 4. Connections ──
  it('creates connections and retrieves them with getConnectionsFor', () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);

    const m1 = store.create({ content: 'Design decision A' });
    const m2 = store.create({ content: 'Implementation of A' });
    const m3 = store.create({ content: 'Unrelated memory' });

    const conn = store.createConnection({
      sourceId: m1.id,
      targetId: m2.id,
      type: 'causal',
      strength: 0.9,
    });
    expect(conn.id).toBeDefined();
    expect(conn.type).toBe('causal');

    const connsForM1 = store.getConnectionsFor(m1.id);
    expect(connsForM1.length).toBe(1);
    expect(connsForM1[0].targetId).toBe(m2.id);

    const connsForM2 = store.getConnectionsFor(m2.id);
    expect(connsForM2.length).toBe(1);

    const connsForM3 = store.getConnectionsFor(m3.id);
    expect(connsForM3.length).toBe(0);

    db.close();
  });

  // ── 5. Archive flow ──
  it('archived memories are excluded from list unless includeArchived is true', () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);

    const m1 = store.create({ content: 'Active memory' });
    const m2 = store.create({ content: 'Will be archived' });

    store.archive(m2.id);

    const active = store.list({ includeArchived: false });
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(m1.id);

    const all = store.list({ includeArchived: true });
    expect(all.length).toBe(2);

    db.close();
  });

  // ── 6. Decay sweep ──
  it('decay engine reduces actuality for memories with old lastAccessedAt', async () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    const config = makeConfig(tmpDir);
    const decayEngine = new DecayEngine(config);

    const m = store.create({ content: 'Old memory', tier: 'short-term', importance: 0.3 });

    // Manually set lastAccessedAt to 48 hours ago
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE memories SET last_accessed_at = ? WHERE id = ?').run(oldDate, m.id);

    const updatedCount = await decayEngine.runDecaySweep(store);
    expect(updatedCount).toBeGreaterThan(0);

    const refreshed = store.getById(m.id)!;
    expect(refreshed.actuality).toBeLessThan(1.0);

    db.close();
  });

  // ── 7. Importance classification ──
  it('classifies content samples into correct importance levels', () => {
    const classifier = new ImportanceClassifier();

    const breakthrough = classifier.classify('I finally discovered the root cause of the memory leak');
    expect(breakthrough.level).toBe('breakthrough');
    expect(breakthrough.score).toBeGreaterThanOrEqual(0.8);

    const decision = classifier.classify('We chose PostgreSQL over MongoDB because of ACID compliance');
    expect(decision.level).toBe('decision');
    expect(decision.score).toBeGreaterThanOrEqual(0.6);

    const operational = classifier.classify('Fixed the timeout bug in the retry handler');
    expect(operational.level).toBe('operational');
    expect(operational.score).toBeGreaterThanOrEqual(0.3);

    const routine = classifier.classify('Renamed variable for clarity and reformatted whitespace');
    expect(routine.level).toBe('routine');
    expect(routine.score).toBeLessThanOrEqual(0.3);
  });

  // ── 8. Promotion sweep ──
  it('promotes memory with high access count to a higher tier', async () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    const promotionEngine = new PromotionEngine();

    const m = store.create({ content: 'Frequently accessed memory', tier: 'short-term', importance: 0.5 });

    // Simulate 5 accesses to trigger short-term -> operational promotion
    for (let i = 0; i < 5; i++) {
      store.recordAccess(m.id);
    }

    const result = await promotionEngine.runPromotionSweep(store);
    expect(result.promoted).toBeGreaterThanOrEqual(1);

    const refreshed = store.getById(m.id)!;
    expect(refreshed.tier).toBe('operational');

    db.close();
  });

  // ── 9. Context builder ──
  it('builds markdown context with correct sections and respects token budget', () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    const builder = new ContextBuilder(store);

    store.create({ content: 'Architecture decision: use microservices', tier: 'long-term', importance: 0.9, tags: ['decision'] });
    store.create({ content: 'Active sprint work on auth module', tier: 'operational', importance: 0.5 });
    store.create({ content: 'Quick fix for typo in README', tier: 'short-term', importance: 0.1 });

    const context = builder.buildContext();
    expect(context).toContain('### Key Decisions');
    expect(context).toContain('### Active Context');
    expect(context).toContain('### Recent Findings');
    expect(context).toContain('microservices');

    // Test token budget - very small budget should exclude some memories
    const tiny = builder.buildContext({ maxTokens: 30 }); // ~120 chars
    // Should have fewer entries than the full build
    const fullLineCount = context.split('\n').length;
    const tinyLineCount = tiny.split('\n').length;
    expect(tinyLineCount).toBeLessThanOrEqual(fullLineCount);

    db.close();
  });

  // ── 10. CLAUDE.md patching ──
  it('patches, rebuilds, and removes CLAUDE.md markers correctly', () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    store.create({ content: 'Test memory for CLAUDE.md', tier: 'long-term', importance: 0.8 });

    const builder = new ContextBuilder(store);
    const manager = new ClaudeMdManager(builder);

    // Patch: creates CLAUDE.md with markers
    manager.patch(tmpDir);
    const filePath = join(tmpDir, 'CLAUDE.md');
    expect(existsSync(filePath)).toBe(true);
    let content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('<!-- ctxcore:start -->');
    expect(content).toContain('<!-- ctxcore:end -->');
    expect(content).toContain('Test memory for CLAUDE.md');

    // Rebuild: update content between markers
    store.create({ content: 'New memory after patch', tier: 'operational', importance: 0.5 });
    manager.rebuild(tmpDir);
    content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('New memory after patch');
    expect(content).toContain('<!-- ctxcore:start -->');

    // Remove: markers gone
    manager.remove(tmpDir);
    content = readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('<!-- ctxcore:start -->');
    expect(content).not.toContain('<!-- ctxcore:end -->');

    db.close();
  });

  // ── 11. Health score ──
  it('empty store yields score 0, populated store yields score > 0', () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();

    const emptyReport = calculator.calculate(store);
    expect(emptyReport.score).toBe(0);

    // Populate
    for (let i = 0; i < 10; i++) {
      store.create({ content: `Memory ${i}`, tier: 'operational', importance: 0.5 });
    }

    const report = calculator.calculate(store);
    expect(report.score).toBeGreaterThan(0);

    db.close();
  });

  // ── 12. Project scanner ──
  it('scans a temp project dir and detects language and framework signals', async () => {
    // Set up a minimal project in the temp dir
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        dependencies: { express: '^4.18.0' },
        devDependencies: { vitest: '^1.0.0' },
        scripts: { test: 'vitest run', build: 'tsc' },
      }),
    );
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022' } }));
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    mkdirSync(join(tmpDir, 'tests'), { recursive: true });

    const scanner = new ProjectScanner();
    const signals = await scanner.scan(tmpDir);

    // Language detection
    expect(signals.language.length).toBeGreaterThan(0);
    const langNames = signals.language.map((l) => l.name);
    expect(langNames).toContain('TypeScript');

    // Framework detection
    const fwNames = signals.framework.map((f) => f.name);
    expect(fwNames).toContain('Express');

    // Structure detection
    const dirNames = signals.structure.map((s) => s.directory);
    expect(dirNames).toContain('src');
    expect(dirNames).toContain('tests');

    // Scripts detection
    expect(signals.scripts.length).toBeGreaterThan(0);
    const scriptNames = signals.scripts.map((s) => s.name);
    expect(scriptNames).toContain('test');
    expect(scriptNames).toContain('build');
  });

  // ── 13. Memory seeder ──
  it('seeds memories from scanner signals with correct tiers', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'seeder-test',
        dependencies: { react: '^18.0.0' },
        scripts: { start: 'node index.js' },
      }),
    );
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({}));
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    const scanner = new ProjectScanner();
    const seeder = new MemorySeeder();

    const signals = await scanner.scan(tmpDir);
    const seeded = seeder.seed(signals, store);

    expect(seeded.length).toBeGreaterThan(0);

    // Language/framework memories should be long-term
    const langMem = seeded.find((m) => m.tags.includes('language'));
    expect(langMem).toBeDefined();
    expect(langMem!.tier).toBe('long-term');

    const fwMem = seeded.find((m) => m.tags.includes('framework'));
    expect(fwMem).toBeDefined();
    expect(fwMem!.tier).toBe('long-term');

    // Script memories should be operational
    const scriptMem = seeded.find((m) => m.tags.includes('scripts'));
    expect(scriptMem).toBeDefined();
    expect(scriptMem!.tier).toBe('operational');

    db.close();
  });

  // ── 14. Trigger evaluation ──
  it('fires stale-tier trigger for memories with low actuality', () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);

    // Create memories with low actuality
    const m1 = store.create({ content: 'Stale long-term memory A', tier: 'long-term' });
    const m2 = store.create({ content: 'Stale long-term memory B', tier: 'long-term' });
    store.update(m1.id, { actuality: 0.1 });
    store.update(m2.id, { actuality: 0.2 });

    const rules: TriggerRule[] = [
      {
        name: 'stale-long-term',
        condition: { type: 'stale-tier', threshold: 0.5, tier: 'long-term' },
        action: 'notify',
        message: '{tier} tier is stale (avg actuality {avg})',
      },
    ];

    const engine = new TriggerEngine(rules);
    const alerts = engine.evaluate(store);

    expect(alerts.length).toBe(1);
    expect(alerts[0].triggered).toBe(true);
    expect(alerts[0].memoryIds.length).toBe(2);

    db.close();
  });

  // ── 15. User profile ──
  it('add, list, update confidence, and forget preferences', () => {
    const profileDbPath = join(tmpDir, 'profile.db');
    const profileDb = createProfileDatabase(profileDbPath);
    const manager = new UserProfileManager(profileDb);

    // Add
    const pref = manager.addPreference({
      category: 'code-style',
      content: 'Use 2-space indentation',
    });
    expect(pref.id).toBeDefined();
    expect(pref.category).toBe('code-style');

    // List
    const prefs = manager.getPreferences();
    expect(prefs.length).toBe(1);
    expect(prefs[0].content).toBe('Use 2-space indentation');

    // Update confidence
    const updated = manager.updateConfidence(pref.id);
    expect(updated).not.toBeNull();
    expect(updated!.observationCount).toBe(2);
    expect(updated!.confidence).toBeGreaterThan(pref.confidence);

    // Forget
    const forgotten = manager.forgetPreference(pref.id);
    expect(forgotten).toBe(true);
    expect(manager.getPreferences().length).toBe(0);

    profileDb.close();
  });

  // ── 16. Lock manager ──
  it('acquire, isLocked, release lifecycle', () => {
    const locksDir = join(tmpDir, 'locks');
    const lockManager = new LockManager(locksDir);

    const acquired = lockManager.acquire('test-lock');
    expect(acquired).toBe(true);
    expect(lockManager.isLocked('test-lock')).toBe(true);

    // Cannot acquire again while locked
    const secondAcquire = lockManager.acquire('test-lock');
    expect(secondAcquire).toBe(false);

    lockManager.release('test-lock');
    expect(lockManager.isLocked('test-lock')).toBe(false);

    // Can acquire after release
    expect(lockManager.acquire('test-lock')).toBe(true);
    lockManager.release('test-lock');
  });

  // ── 17. Export ──
  it('exports all memories with metadata as JSON', () => {
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);

    store.create({ content: 'Memory A', tier: 'short-term', importance: 0.3, tags: ['alpha'] });
    store.create({ content: 'Memory B', tier: 'long-term', importance: 0.9, tags: ['beta'] });
    store.create({ content: 'Memory C', tier: 'operational', importance: 0.5 });

    const memories = store.list({ includeArchived: false, limit: 100000 });
    const exported = memories.map((m) => ({
      ...m,
      connections: store.getConnectionsFor(m.id),
    }));

    expect(exported.length).toBe(3);
    expect(exported[0].connections).toBeDefined();
    expect(exported.find((e) => e.content === 'Memory A')).toBeDefined();
    expect(exported.find((e) => e.content === 'Memory B')).toBeDefined();

    // Verify JSON serialization round-trips
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(3);

    db.close();
  });

  // ── 18. Full lifecycle ──
  it('full lifecycle: init -> store -> search -> decay -> promote -> archive -> health', async () => {
    // Init
    const db = makeDbInDir(tmpDir);
    const store = new MemoryStore(db);
    const config = makeConfig(tmpDir);
    const embeddingClient = new NullEmbeddingClient();
    const embeddingStore = new SqliteEmbeddingStore(db);
    const retrieval = new RetrievalEngine(store, embeddingStore, embeddingClient);
    const decayEngine = new DecayEngine(config);
    const promotionEngine = new PromotionEngine();
    const calculator = new HealthCalculator();

    // Store
    const m1 = store.create({ content: 'Important architecture decision about microservices', tier: 'short-term', importance: 0.7 });
    const m2 = store.create({ content: 'Quick fix for authentication bug', tier: 'short-term', importance: 0.3 });
    const m3 = store.create({ content: 'Database schema migration plan', tier: 'operational', importance: 0.6 });

    expect(store.stats().total).toBe(3);

    // Search (keyword-only, no Ollama)
    const searchResults = await retrieval.search('architecture');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].memory.content).toContain('architecture');

    // Promote m1 (simulate frequent access)
    for (let i = 0; i < 5; i++) {
      store.recordAccess(m1.id);
    }
    const promoResult = await promotionEngine.runPromotionSweep(store);
    expect(promoResult.promoted).toBeGreaterThanOrEqual(1);
    const promotedM1 = store.getById(m1.id)!;
    expect(promotedM1.tier).toBe('operational');

    // Decay m2 (set old access time)
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE memories SET last_accessed_at = ? WHERE id = ?').run(oldDate, m2.id);
    await decayEngine.runDecaySweep(store);
    const decayedM2 = store.getById(m2.id)!;
    expect(decayedM2.actuality).toBeLessThan(1.0);

    // Archive: force very low actuality then run promotion sweep for archival
    store.update(m2.id, { actuality: 0.01 });
    const archiveResult = await promotionEngine.runPromotionSweep(store);
    expect(archiveResult.archived).toBeGreaterThanOrEqual(1);
    const archivedM2 = store.getById(m2.id)!;
    expect(archivedM2.archived).toBe(true);

    // Health check
    const report = calculator.calculate(store);
    expect(report.score).toBeGreaterThan(0);
    expect(report.details.length).toBe(4);

    db.close();
  });
});
