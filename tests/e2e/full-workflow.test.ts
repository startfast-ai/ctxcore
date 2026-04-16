import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, createVecTable } from '../../src/database.js';
import { MemoryStore } from '../../src/memory-store.js';
import { NullEmbeddingClient } from '../../src/embeddings/null.js';
import { SqliteEmbeddingStore } from '../../src/embeddings/store.js';
import { RetrievalEngine } from '../../src/retrieval.js';
import { DecayEngine } from '../../src/decay.js';
import { PromotionEngine } from '../../src/promotion.js';
import { HealthCalculator, recordIntelligenceScore, getIntelligenceHistory, computeTrend } from '../../src/health.js';
import { ProjectScanner } from '../../src/project-scanner.js';
import { MemorySeeder } from '../../src/seed-memories.js';
import { ContextBuilder } from '../../src/context-builder.js';
import { ClaudeMdManager } from '../../src/claudemd.js';
import { TriggerEngine } from '../../src/triggers.js';
import type { CtxcoreConfig, TriggerRule } from '../../src/types.js';
import type Database from 'better-sqlite3';

const DIMENSIONS = 384;

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ctxcore-e2e-full-'));
}

function makeDb(dir: string): Database.Database {
  const db = createDatabase(join(dir, '.memory.db'));
  createVecTable(db, DIMENSIONS);
  return db;
}

function makeConfig(root: string): CtxcoreConfig {
  return {
    projectRoot: root,
    dbPath: join(root, '.memory.db'),
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'jina-code',
    embeddingProvider: 'auto',
    decay: { shortTerm: 0.95, operational: 0.995, longTerm: 0.9995 },
    embedding: { dimensions: DIMENSIONS, batchSize: 32 },
  } as CtxcoreConfig;
}

function scaffoldNodeProject(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test-api',
    version: '1.0.0',
    type: 'module',
    dependencies: { express: '^4.18.0', prisma: '^5.0.0' },
    devDependencies: { vitest: '^3.0.0', typescript: '^5.0.0' },
    scripts: { test: 'vitest run', build: 'tsc', start: 'node dist/index.js' },
  }));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
  }));
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const app = "hello";');
  writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm install');
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\non: push');
}

function scaffoldPythonProject(dir: string): void {
  writeFileSync(join(dir, 'requirements.txt'), 'flask==3.0.0\nsqlalchemy==2.0.0\npytest==8.0.0');
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "my-api"\nversion = "0.1.0"');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.py'), 'from flask import Flask\napp = Flask(__name__)');
}

function scaffoldGoProject(dir: string): void {
  writeFileSync(join(dir, 'go.mod'), 'module example.com/myapi\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.0');
  mkdirSync(join(dir, 'cmd'), { recursive: true });
  mkdirSync(join(dir, 'internal'), { recursive: true });
  writeFileSync(join(dir, 'cmd', 'main.go'), 'package main\nfunc main() {}');
  writeFileSync(join(dir, 'Makefile'), 'build:\n\tgo build ./cmd/...');
}

describe('E2E: Full Workflow — Node.js Project', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    scaffoldNodeProject(tmpDir);
    db = makeDb(tmpDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scan → seed → intelligence score > 0', async () => {
    const store = new MemoryStore(db);
    const scanner = new ProjectScanner();
    const seeder = new MemorySeeder();

    const signals = await scanner.scan(tmpDir);
    expect(signals.language.length).toBeGreaterThan(0);
    expect(signals.language.map(l => l.name)).toContain('TypeScript');
    expect(signals.framework.map(f => f.name)).toContain('Express');

    const seeded = seeder.seed(signals, store);
    expect(seeded.length).toBeGreaterThan(5);

    const calculator = new HealthCalculator();
    const score = calculator.calculateIntelligence(store);
    expect(score.total).toBeGreaterThan(0);
    expect(score.memoryCounts.longTerm).toBeGreaterThan(0);
  });

  it('manual memories + seeded memories combine for higher score', async () => {
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();
    const scanner = new ProjectScanner();
    const seeder = new MemorySeeder();

    // Phase 1: seed
    const signals = await scanner.scan(tmpDir);
    seeder.seed(signals, store);
    const scoreAfterSeed = calculator.calculateIntelligence(store);

    // Phase 2: add high-value manual memories (simulating sessions)
    store.create({ content: 'Auth uses JWT with RS256 keys', tier: 'long-term', importance: 0.9, tags: ['decision', 'auth'] });
    store.create({ content: 'Payments module uses Stripe webhook handler', tier: 'long-term', importance: 0.8, tags: ['architecture'] });
    store.create({ content: 'Rate limiting at 100 req/min per IP', tier: 'long-term', importance: 0.7, tags: ['convention'] });
    store.create({ content: 'All database queries go through Prisma ORM', tier: 'long-term', importance: 0.9, tags: ['decision', 'database'] });
    store.create({ content: 'Error responses follow RFC 7807 problem details', tier: 'long-term', importance: 0.8, tags: ['convention', 'api'] });

    const scoreAfterManual = calculator.calculateIntelligence(store);
    // Depth should increase substantially with high-importance long-term memories
    expect(scoreAfterManual.depth).toBeGreaterThan(scoreAfterSeed.depth);
  });

  it('intelligence score tracks over time with events', async () => {
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();

    // Record init score
    store.create({ content: 'Initial memory', tier: 'short-term' });
    const s1 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s1, 'init');

    // Add memories (simulating session)
    for (let i = 0; i < 15; i++) {
      store.create({
        content: `Session memory ${i}`,
        tier: i < 5 ? 'long-term' : 'operational',
        importance: 0.5 + (i * 0.03),
        tags: [`tag-${i % 5}`],
      });
    }
    const s2 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s2, 'session');

    // Add connections (simulating reflexion)
    const memories = store.list({ limit: 10 });
    for (let i = 0; i < memories.length - 1; i++) {
      store.createConnection({
        sourceId: memories[i].id,
        targetId: memories[i + 1].id,
        type: 'supports',
        strength: 0.7,
      });
    }
    const s3 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s3, 'reflexion');

    const history = getIntelligenceHistory(db, 10);
    expect(history.length).toBe(3);

    const trend = computeTrend(db);
    expect(trend).toBe('rising');
  });

  it('CLAUDE.md patching includes seeded intelligence', async () => {
    const store = new MemoryStore(db);
    const scanner = new ProjectScanner();
    const seeder = new MemorySeeder();

    const signals = await scanner.scan(tmpDir);
    seeder.seed(signals, store);

    store.create({ content: 'Critical: never use raw SQL, always use Prisma', tier: 'long-term', importance: 0.9, tags: ['decision'] });

    const builder = new ContextBuilder(store);
    const manager = new ClaudeMdManager(builder);
    manager.patch(tmpDir);

    const claudeMd = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('<!-- ctxcore:start -->');
    expect(claudeMd).toContain('<!-- ctxcore:end -->');
    expect(claudeMd).toContain('Prisma');
  });

  it('decay + promotion lifecycle changes memory tiers', async () => {
    const store = new MemoryStore(db);
    const config = makeConfig(tmpDir);
    const decayEngine = new DecayEngine(config);
    const promotionEngine = new PromotionEngine();

    // Create memories
    const important = store.create({ content: 'Architecture: event sourcing for orders', tier: 'short-term', importance: 0.8 });
    const stale = store.create({ content: 'Temporary debug logging added', tier: 'short-term', importance: 0.1 });

    // Promote important memory via access
    for (let i = 0; i < 6; i++) store.recordAccess(important.id);
    await promotionEngine.runPromotionSweep(store);
    expect(store.getById(important.id)!.tier).toBe('operational');

    // Decay stale memory
    const oldDate = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE memories SET last_accessed_at = ? WHERE id = ?').run(oldDate, stale.id);
    await decayEngine.runDecaySweep(store);
    expect(store.getById(stale.id)!.actuality).toBeLessThan(0.5);

    // Archive if very low actuality
    store.update(stale.id, { actuality: 0.01 });
    await promotionEngine.runPromotionSweep(store);
    expect(store.getById(stale.id)!.archived).toBe(true);
  });

  it('contradictions are detectable via connections', () => {
    const store = new MemoryStore(db);

    const m1 = store.create({ content: 'We use PostgreSQL for all services', tier: 'long-term', importance: 0.8 });
    const m2 = store.create({ content: 'Payments migrating to MongoDB for document storage', tier: 'operational', importance: 0.6 });

    store.createConnection({ sourceId: m1.id, targetId: m2.id, type: 'contradicts', strength: 0.9 });

    const conns = store.getConnectionsFor(m1.id);
    const contradictions = conns.filter(c => c.type === 'contradicts');
    expect(contradictions.length).toBe(1);
    expect(contradictions[0].targetId).toBe(m2.id);
  });

  it('trigger engine fires on stale memories', () => {
    const store = new MemoryStore(db);

    const m1 = store.create({ content: 'Old decision A', tier: 'long-term' });
    const m2 = store.create({ content: 'Old decision B', tier: 'long-term' });
    store.update(m1.id, { actuality: 0.1 });
    store.update(m2.id, { actuality: 0.15 });

    const rules: TriggerRule[] = [{
      name: 'stale-lt',
      condition: { type: 'stale-tier', threshold: 0.5, tier: 'long-term' },
      action: 'notify',
      message: 'Long-term memories are stale',
    }];

    const engine = new TriggerEngine(rules);
    const alerts = engine.evaluate(store);
    expect(alerts.length).toBe(1);
    expect(alerts[0].triggered).toBe(true);
    expect(alerts[0].memoryIds.length).toBe(2);
  });

  it('search returns keyword matches with correct ranking', async () => {
    const store = new MemoryStore(db);
    const embeddingStore = new SqliteEmbeddingStore(db);
    const retrieval = new RetrievalEngine(store, embeddingStore, new NullEmbeddingClient());

    store.create({ content: 'Auth module uses JWT tokens with RS256', tier: 'long-term', importance: 0.9 });
    store.create({ content: 'Auth timeout set to 30 minutes', tier: 'operational', importance: 0.4 });
    store.create({ content: 'Unrelated: database migration plan', tier: 'short-term', importance: 0.3 });
    store.create({ content: 'Auth rate limiting at 100 req/min', tier: 'operational', importance: 0.5 });

    const results = await retrieval.search('auth');
    expect(results.length).toBe(3);
    expect(results.every(r => r.memory.content.toLowerCase().includes('auth'))).toBe(true);
    // Highest importance first
    expect(results[0].memory.importance).toBeGreaterThanOrEqual(results[1].memory.importance);
  });
});

describe('E2E: Python Project', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    scaffoldPythonProject(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Python + Flask and seeds memories', async () => {
    const scanner = new ProjectScanner();
    const signals = await scanner.scan(tmpDir);

    expect(signals.language.map(l => l.name)).toContain('Python');
    expect(signals.framework.map(f => f.name)).toContain('Flask');

    const db = makeDb(tmpDir);
    const store = new MemoryStore(db);
    const seeder = new MemorySeeder();
    const seeded = seeder.seed(signals, store);
    expect(seeded.length).toBeGreaterThan(0);

    const calculator = new HealthCalculator();
    const score = calculator.calculateIntelligence(store);
    expect(score.total).toBeGreaterThan(0);

    db.close();
  });
});

describe('E2E: Go Project', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    scaffoldGoProject(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Go + Gin and seeds memories', async () => {
    const scanner = new ProjectScanner();
    const signals = await scanner.scan(tmpDir);

    expect(signals.language.map(l => l.name)).toContain('Go');

    const db = makeDb(tmpDir);
    const store = new MemoryStore(db);
    const seeder = new MemorySeeder();
    const seeded = seeder.seed(signals, store);
    expect(seeded.length).toBeGreaterThan(0);

    db.close();
  });
});

describe('E2E: Empty Project', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles empty project gracefully with score 0', async () => {
    const scanner = new ProjectScanner();
    const signals = await scanner.scan(tmpDir);

    const db = makeDb(tmpDir);
    const store = new MemoryStore(db);
    const seeder = new MemorySeeder();
    const seeded = seeder.seed(signals, store);

    const calculator = new HealthCalculator();
    const score = calculator.calculateIntelligence(store);
    expect(score.total).toBe(0);

    db.close();
  });
});

describe('E2E: Multi-session simulation', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    scaffoldNodeProject(tmpDir);
    db = makeDb(tmpDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('intelligence grows across simulated sessions', async () => {
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();
    const scanner = new ProjectScanner();
    const seeder = new MemorySeeder();

    // Session 0: init
    const signals = await scanner.scan(tmpDir);
    seeder.seed(signals, store);
    const s0 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s0, 'init');

    // Session 1: developer works on auth
    store.create({ content: 'Auth uses JWT with RS256', tier: 'long-term', importance: 0.8, tags: ['decision'] });
    store.create({ content: 'Session tokens expire after 30min', tier: 'operational', importance: 0.5, tags: ['convention'] });
    store.create({ content: 'Refresh tokens stored in httpOnly cookies', tier: 'long-term', importance: 0.7, tags: ['decision', 'security'] });
    const s1 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s1, 'session');

    // Session 2: developer works on payments
    store.create({ content: 'Stripe webhook handler validates signature', tier: 'operational', importance: 0.6, tags: ['architecture'] });
    store.create({ content: 'Payment amounts stored in cents to avoid floating point', tier: 'long-term', importance: 0.7, tags: ['convention'] });
    store.create({ content: 'Idempotency keys used for all payment operations', tier: 'long-term', importance: 0.8, tags: ['decision', 'reliability'] });
    const s2 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s2, 'session');

    // Session 3: reflexion creates connections
    const memories = store.list({ limit: 100 });
    const decisions = memories.filter(m => m.tags.includes('decision'));
    for (let i = 0; i < decisions.length - 1; i++) {
      store.createConnection({
        sourceId: decisions[i].id,
        targetId: decisions[i + 1].id,
        type: 'supports',
        strength: 0.6,
      });
    }
    const s3 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s3, 'reflexion');

    // Verify growth
    const history = getIntelligenceHistory(db, 10);
    expect(history.length).toBe(4);

    expect(s3.total).toBeGreaterThan(s0.total);
    expect(computeTrend(db)).toBe('rising');

    // Verify memory counts
    expect(s3.memoryCounts.longTerm).toBeGreaterThan(0);
    expect(s3.memoryCounts.operational).toBeGreaterThan(0);
  });
});
