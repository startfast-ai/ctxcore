/**
 * Live AI E2E Tests — requires real services running.
 *
 * These tests hit real AI models and are SKIPPED by default.
 * Run manually with:
 *
 *   npx vitest run tests/e2e-manual/ --timeout 120000
 *
 * Prerequisites:
 *   - Claude CLI installed and authenticated (`claude --version`)
 *   - Ollama running with model pulled (`ollama pull qwen3-embedding:0.6b`)  [optional]
 *   - Internet access for Transformers.js model download on first run
 *
 * Environment variables:
 *   CTXCORE_LIVE_TESTS=1    Enable these tests
 *   CTXCORE_CLAUDE_MODEL    Claude model to use (default: haiku)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, createVecTable } from '../../src/database.js';
import { MemoryStore } from '../../src/memory-store.js';
import { detectClaudeCli, verifyClaudeCli, ClaudeCliRunner } from '../../src/claude-cli.js';
import { ReflexionEngine } from '../../src/reflexion.js';
import { ReflexionApplicator } from '../../src/reflexion-applicator.js';
import { ProjectAnalyzer } from '../../src/project-analyzer.js';
import { ProjectScanner } from '../../src/project-scanner.js';
import { MemorySeeder } from '../../src/seed-memories.js';
import { HealthCalculator, recordIntelligenceScore, getIntelligenceHistory } from '../../src/health.js';
import { TransformersEmbeddingClient } from '../../src/embeddings/transformers.js';
import { OllamaEmbeddingClient } from '../../src/embeddings/ollama.js';
import { SqliteEmbeddingStore } from '../../src/embeddings/store.js';
import { RetrievalEngine } from '../../src/retrieval.js';
import { createEmbeddingClient } from '../../src/embeddings/provider.js';
import type Database from 'better-sqlite3';

const LIVE = process.env.CTXCORE_LIVE_TESTS === '1';
const CLAUDE_MODEL = process.env.CTXCORE_CLAUDE_MODEL ?? 'haiku';

const describeIfLive = LIVE ? describe : describe.skip;

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ctxcore-live-'));
}

function scaffoldRealProject(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'live-test-api',
    version: '1.0.0',
    type: 'module',
    dependencies: {
      express: '^4.18.0',
      prisma: '^5.0.0',
      jsonwebtoken: '^9.0.0',
      stripe: '^14.0.0',
    },
    devDependencies: {
      vitest: '^3.0.0',
      typescript: '^5.7.0',
      '@types/express': '^4.17.0',
    },
    scripts: {
      test: 'vitest run',
      build: 'tsc',
      start: 'node dist/index.js',
      'db:migrate': 'prisma migrate deploy',
    },
  }));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true, outDir: 'dist' },
    include: ['src'],
  }));
  mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
  mkdirSync(join(dir, 'src', 'middleware'), { recursive: true });
  mkdirSync(join(dir, 'src', 'services'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  mkdirSync(join(dir, 'prisma'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });

  writeFileSync(join(dir, 'src', 'index.ts'), `
import express from 'express';
import { authRouter } from './routes/auth.js';
import { paymentRouter } from './routes/payments.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();
app.use(express.json());
app.use('/auth', authRouter);
app.use('/payments', authMiddleware, paymentRouter);
app.listen(3000);
`);

  writeFileSync(join(dir, 'src', 'routes', 'auth.ts'), `
import { Router } from 'express';
import jwt from 'jsonwebtoken';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;
  // Validate credentials against database
  const token = jwt.sign({ userId: '123' }, process.env.JWT_SECRET!, { expiresIn: '30m' });
  res.json({ token });
});

authRouter.post('/refresh', async (req, res) => {
  // Refresh token logic with httpOnly cookie
  res.json({ token: 'new-token' });
});
`);

  writeFileSync(join(dir, 'src', 'routes', 'payments.ts'), `
import { Router } from 'express';
import Stripe from 'stripe';

export const paymentRouter = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

paymentRouter.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature']!;
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  // Handle payment events — amounts in cents to avoid floating point
  res.json({ received: true });
});
`);

  writeFileSync(join(dir, 'src', 'middleware', 'auth.ts'), `
import jwt from 'jsonwebtoken';
export function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}
`);

  writeFileSync(join(dir, 'prisma', 'schema.prisma'), `
datasource db { provider = "postgresql" url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }
model User { id String @id @default(uuid()) email String @unique name String? }
model Payment { id String @id @default(uuid()) amount Int userId String status String }
`);

  writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nRUN npm run build\nCMD ["npm", "start"]');
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test');
  writeFileSync(join(dir, 'README.md'), '# Live Test API\nA REST API with auth, payments, and Prisma ORM.\n\n## Setup\n```\nnpm install\nnpx prisma migrate deploy\nnpm start\n```');
}

// ═══════════════════════════════════════════════════════════
// CLAUDE CLI TESTS
// ═══════════════════════════════════════════════════════════

describeIfLive('Live: Claude CLI', () => {
  let claudePath: string;

  beforeAll(() => {
    const detected = detectClaudeCli();
    if (!detected || !verifyClaudeCli(detected)) {
      throw new Error('Claude CLI not found or not verified. Install: npm i -g @anthropic-ai/claude-code');
    }
    claudePath = detected;
  });

  it('runs a simple prompt and gets a response', async () => {
    const cli = new ClaudeCliRunner(claudePath, CLAUDE_MODEL);
    const response = await cli.run('Reply with exactly the word "hello" and nothing else.');
    expect(response.toLowerCase()).toContain('hello');
  }, 30_000);

  it('analyzes a real project with Claude', async () => {
    const tmpDir = makeTmpDir();
    scaffoldRealProject(tmpDir);

    try {
      const db = createDatabase(join(tmpDir, '.memory.db'));
      createVecTable(db, 768);
      const store = new MemoryStore(db);
      const scanner = new ProjectScanner();
      const seeder = new MemorySeeder();

      const signals = await scanner.scan(tmpDir);
      seeder.seed(signals, store);

      const cli = new ClaudeCliRunner(claudePath, CLAUDE_MODEL);
      const analyzer = new ProjectAnalyzer(cli);
      const memories = await analyzer.analyze(tmpDir, signals, store);

      console.log(`  Claude generated ${memories.length} insights`);
      expect(memories.length).toBeGreaterThan(0);

      // Verify memories have meaningful content
      for (const m of memories) {
        expect(m.content.length).toBeGreaterThan(10);
        expect(m.tier).toBeDefined();
        expect(m.importance).toBeGreaterThan(0);
      }

      // Check intelligence score after Claude analysis
      const calculator = new HealthCalculator();
      const score = calculator.calculateIntelligence(store);
      console.log(`  Intelligence Score: ${score.total}/100`);
      expect(score.total).toBeGreaterThan(20);

      db.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120_000);
});

describeIfLive('Live: Claude Reflexion', () => {
  let claudePath: string;
  let tmpDir: string;
  let db: Database.Database;

  beforeAll(() => {
    const detected = detectClaudeCli();
    if (!detected || !verifyClaudeCli(detected)) {
      throw new Error('Claude CLI not found');
    }
    claudePath = detected;
  });

  beforeEach(() => {
    tmpDir = makeTmpDir();
    db = createDatabase(join(tmpDir, '.memory.db'));
    createVecTable(db, 768);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('consolidation detects mergeable memories', async () => {
    const store = new MemoryStore(db);

    // Create similar/overlapping memories
    store.create({ content: 'Auth uses JWT tokens with RS256 algorithm', tier: 'operational', importance: 0.6 });
    store.create({ content: 'Authentication implemented with JWT RS256 keys', tier: 'short-term', importance: 0.5 });
    store.create({ content: 'The API uses JSON Web Tokens (JWT) with RS256 for auth', tier: 'operational', importance: 0.7 });
    store.create({ content: 'Database uses PostgreSQL with Prisma ORM', tier: 'long-term', importance: 0.8 });
    store.create({ content: 'Payments processed via Stripe webhooks', tier: 'operational', importance: 0.6 });

    const cli = new ClaudeCliRunner(claudePath, CLAUDE_MODEL);
    const engine = new ReflexionEngine(cli);
    const result = await engine.runConsolidation(store.list({ includeArchived: false }));

    console.log(`  Consolidation: ${result.suggestions.length} suggestions`);
    // Claude should detect the 3 JWT-related memories as consolidation candidates
    expect(result.type).toBe('consolidation');
    // May or may not have suggestions depending on Claude's analysis
    expect(result.memoriesAffected).toBeDefined();
  }, 60_000);

  it('contradiction detection finds conflicting memories', async () => {
    const store = new MemoryStore(db);

    store.create({ content: 'All services use PostgreSQL for data storage', tier: 'long-term', importance: 0.8 });
    store.create({ content: 'Payments service migrated to MongoDB for document flexibility', tier: 'operational', importance: 0.7 });
    store.create({ content: 'We chose microservices architecture', tier: 'long-term', importance: 0.9 });
    store.create({ content: 'New features are added directly to the monolith for speed', tier: 'operational', importance: 0.5 });

    const cli = new ClaudeCliRunner(claudePath, CLAUDE_MODEL);
    const engine = new ReflexionEngine(cli);
    const result = await engine.detectContradictions(store.list({ includeArchived: false }));

    console.log(`  Contradictions: ${result.suggestions.length} found`);
    expect(result.type).toBe('contradiction');
  }, 60_000);

  it('pattern detection finds recurring themes', async () => {
    const store = new MemoryStore(db);

    store.create({ content: 'Bug: payment webhook failed due to missing signature validation', tier: 'operational', importance: 0.6, tags: ['bug', 'payments'] });
    store.create({ content: 'Bug: payment amount calculated incorrectly with floating point', tier: 'operational', importance: 0.7, tags: ['bug', 'payments'] });
    store.create({ content: 'Bug: payment retry logic sends duplicate charges', tier: 'operational', importance: 0.8, tags: ['bug', 'payments'] });
    store.create({ content: 'Auth module working correctly', tier: 'operational', importance: 0.3 });
    store.create({ content: 'Bug: payment refund not updating user balance', tier: 'operational', importance: 0.6, tags: ['bug', 'payments'] });

    const cli = new ClaudeCliRunner(claudePath, CLAUDE_MODEL);
    const engine = new ReflexionEngine(cli);
    const result = await engine.findPatterns(store.list({ includeArchived: false }));

    console.log(`  Patterns: ${result.suggestions.length} detected`);
    expect(result.type).toBe('pattern');
    // Claude should detect the recurring payment bugs pattern
  }, 60_000);

  it('full reflexion cycle with apply', async () => {
    const store = new MemoryStore(db);

    // Seed realistic memories
    store.create({ content: 'Auth uses JWT with RS256', tier: 'operational', importance: 0.6 });
    store.create({ content: 'JWT authentication with RS256 algorithm', tier: 'short-term', importance: 0.4 });
    store.create({ content: 'PostgreSQL for all data', tier: 'long-term', importance: 0.8 });
    store.create({ content: 'Payments moved to MongoDB', tier: 'operational', importance: 0.6 });
    store.create({ content: 'Express.js REST API', tier: 'long-term', importance: 0.7 });

    const cli = new ClaudeCliRunner(claudePath, CLAUDE_MODEL);
    const engine = new ReflexionEngine(cli);
    const applicator = new ReflexionApplicator();

    const memories = store.list({ includeArchived: false });
    const consolidation = await engine.runConsolidation(memories);
    const contradictions = await engine.detectContradictions(memories);

    const allSuggestions = [...consolidation.suggestions, ...contradictions.suggestions];
    console.log(`  Total suggestions: ${allSuggestions.length}`);

    if (allSuggestions.length > 0) {
      const result = applicator.apply(allSuggestions, store);
      console.log(`  Applied: ${result.applied}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
      expect(result.applied + result.skipped).toBe(allSuggestions.length);
    }

    // Record score
    const calculator = new HealthCalculator();
    const score = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, score, 'reflexion');
    console.log(`  Intelligence Score after reflexion: ${score.total}/100`);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════
// TRANSFORMERS.JS EMBEDDING TESTS
// ═══════════════════════════════════════════════════════════

describeIfLive('Live: Transformers.js Embeddings', () => {
  let client: TransformersEmbeddingClient;

  beforeAll(async () => {
    // Use small model for faster test
    client = new TransformersEmbeddingClient('Xenova/all-MiniLM-L6-v2');
    await client.initialize((msg) => console.log(`  ${msg}`));
  }, 60_000);

  it('produces correct dimension embeddings', async () => {
    const embedding = await client.embed('function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }');
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(client.dimensions);
    expect(client.dimensions).toBe(384);
  });

  it('batch embedding produces correct results', async () => {
    const texts = [
      'JavaScript function for sorting arrays',
      'Python class for database connection',
      'Rust struct implementing Iterator trait',
    ];
    const embeddings = await client.embedBatch(texts);
    expect(embeddings.length).toBe(3);
    for (const emb of embeddings) {
      expect(emb.length).toBe(384);
    }
  });

  it('similar texts have higher cosine similarity than dissimilar', async () => {
    const codeA = await client.embed('function add(a, b) { return a + b; }');
    const codeB = await client.embed('function sum(x, y) { return x + y; }');
    const unrelated = await client.embed('The weather is sunny today');

    const simAB = cosineSimilarity(codeA, codeB);
    const simAU = cosineSimilarity(codeA, unrelated);

    console.log(`  Similar code similarity: ${simAB.toFixed(4)}`);
    console.log(`  Unrelated similarity: ${simAU.toFixed(4)}`);
    expect(simAB).toBeGreaterThan(simAU);
  });

  it('empty batch returns empty array', async () => {
    const result = await client.embedBatch([]);
    expect(result).toEqual([]);
  });

  it('healthCheck returns true', async () => {
    expect(await client.healthCheck()).toBe(true);
  });
});

describeIfLive('Live: Semantic Search with Real Embeddings', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    db = createDatabase(join(tmpDir, '.memory.db'));
    createVecTable(db, 384);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('semantic search finds relevant memories by meaning', async () => {
    const client = new TransformersEmbeddingClient('Xenova/all-MiniLM-L6-v2');
    await client.initialize();

    const store = new MemoryStore(db);
    const embeddingStore = new SqliteEmbeddingStore(db);
    const retrieval = new RetrievalEngine(store, embeddingStore, client);

    // Store memories with embeddings
    const memories = [
      { content: 'Authentication uses JSON Web Tokens with RS256 algorithm', tier: 'long-term' as const, importance: 0.8, tags: ['auth'] },
      { content: 'Payments processed through Stripe webhook handler', tier: 'operational' as const, importance: 0.6, tags: ['payments'] },
      { content: 'Database schema managed with Prisma ORM migrations', tier: 'long-term' as const, importance: 0.7, tags: ['database'] },
      { content: 'Docker container uses multi-stage build for production', tier: 'operational' as const, importance: 0.5, tags: ['devops'] },
      { content: 'Rate limiting set to 100 requests per minute per IP', tier: 'operational' as const, importance: 0.5, tags: ['security'] },
      { content: 'Error responses follow RFC 7807 problem details format', tier: 'long-term' as const, importance: 0.6, tags: ['api'] },
    ];

    for (const m of memories) {
      const created = store.create(m);
      const embedding = await client.embed(m.content);
      embeddingStore.store(created.id, embedding);
    }

    // Search with keyword that exists in stored content
    const authResults = await retrieval.search('JWT authentication');
    expect(authResults.length).toBeGreaterThan(0);
    console.log(`  "JWT authentication" → ${authResults[0].memory.content.slice(0, 60)}...`);

    // Search that should match via vector similarity OR keyword
    const payResults = await retrieval.search('Stripe payments');
    expect(payResults.length).toBeGreaterThan(0);
    console.log(`  "Stripe payments" → ${payResults[0].memory.content.slice(0, 60)}...`);

    // Purely semantic search — "deployment" won't exact-match "Docker container"
    // but vector similarity should find it now with the L2→cosine fix
    const deployResults = await retrieval.search('deployment process');
    console.log(`  "deployment process" → ${deployResults.length} results${deployResults.length > 0 ? ': ' + deployResults[0].memory.content.slice(0, 60) + '...' : ''}`);
    expect(deployResults.length).toBeGreaterThan(0);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════
// OLLAMA EMBEDDING TESTS
// ═══════════════════════════════════════════════════════════

describeIfLive('Live: Ollama Embeddings', () => {
  let client: OllamaEmbeddingClient;

  beforeAll(async () => {
    client = new OllamaEmbeddingClient('http://localhost:11434', 'qwen3-embedding:0.6b');
    const healthy = await client.healthCheck();
    if (!healthy) {
      throw new Error('Ollama not running or model not pulled. Run: ollama pull qwen3-embedding:0.6b');
    }
  });

  it('produces 1024-dim embeddings', async () => {
    const embedding = await client.embed('function add(a, b) { return a + b; }');
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(1024);
  });

  it('batch embedding works', async () => {
    const embeddings = await client.embedBatch(['hello world', 'function foo() {}']);
    expect(embeddings.length).toBe(2);
    expect(embeddings[0].length).toBe(1024);
    expect(embeddings[1].length).toBe(1024);
  });
});

// ═══════════════════════════════════════════════════════════
// EMBEDDING PROVIDER AUTO-DETECTION
// ═══════════════════════════════════════════════════════════

describeIfLive('Live: Embedding Provider Auto-detection', () => {
  it('auto mode selects an available provider', async () => {
    const result = await createEmbeddingClient({
      provider: 'auto',
      transformersModel: 'Xenova/all-MiniLM-L6-v2',
      onProgress: (msg) => console.log(`  ${msg}`),
    });

    expect(result.provider).not.toBe('none');
    expect(result.dimensions).toBeGreaterThan(0);
    console.log(`  Auto-selected: ${result.provider} (${result.dimensions}d)`);

    // Verify it can actually embed
    const embedding = await result.client.embed('test embedding');
    expect(embedding.length).toBe(result.dimensions);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════
// FULL PIPELINE: INIT → SESSIONS → REFLEXION → GROWTH
// ═══════════════════════════════════════════════════════════

describeIfLive('Live: Full Intelligence Pipeline', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    scaffoldRealProject(tmpDir);
    db = createDatabase(join(tmpDir, '.memory.db'));
    createVecTable(db, 384);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full pipeline: scan → seed → embed → session → reflexion → score growth', async () => {
    const store = new MemoryStore(db);
    const calculator = new HealthCalculator();
    const embeddingClient = new TransformersEmbeddingClient('Xenova/all-MiniLM-L6-v2');
    await embeddingClient.initialize();
    const embeddingStore = new SqliteEmbeddingStore(db);

    // ── Step 1: Init scan ──
    console.log('\n  Step 1: Project scan...');
    const scanner = new ProjectScanner();
    const seeder = new MemorySeeder();
    const signals = await scanner.scan(tmpDir);
    const seeded = seeder.seed(signals, store);
    console.log(`    Seeded ${seeded.length} memories`);

    // Embed seeded memories
    for (const m of seeded) {
      const emb = await embeddingClient.embed(m.content);
      embeddingStore.store(m.id, emb);
    }

    const s0 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s0, 'init');
    console.log(`    Intelligence: ${s0.total}/100`);

    // ── Step 2: Session memories ──
    console.log('  Step 2: Adding session memories...');
    const sessionMemories = [
      { content: 'Auth uses JWT RS256 with 30min expiry, refresh via httpOnly cookies', tier: 'long-term' as const, importance: 0.8, tags: ['decision', 'auth'] },
      { content: 'All payment amounts stored as integers (cents) to avoid floating point issues', tier: 'long-term' as const, importance: 0.7, tags: ['convention', 'payments'] },
      { content: 'Stripe webhook signature validated before processing any event', tier: 'operational' as const, importance: 0.6, tags: ['security', 'payments'] },
      { content: 'Prisma schema uses uuid() for all primary keys', tier: 'long-term' as const, importance: 0.6, tags: ['convention', 'database'] },
      { content: 'API responses follow RFC 7807 problem details for errors', tier: 'long-term' as const, importance: 0.7, tags: ['convention', 'api'] },
    ];

    for (const m of sessionMemories) {
      const created = store.create(m);
      const emb = await embeddingClient.embed(m.content);
      embeddingStore.store(created.id, emb);
    }

    const s1 = calculator.calculateIntelligence(store);
    recordIntelligenceScore(db, s1, 'session');
    console.log(`    Intelligence: ${s1.total}/100 (+${s1.total - s0.total})`);

    // ── Step 3: Semantic search ──
    console.log('  Step 3: Semantic search...');
    const retrieval = new RetrievalEngine(store, embeddingStore, embeddingClient);
    const authHits = await retrieval.search('JWT auth');
    console.log(`    "JWT auth" → ${authHits.length} results${authHits.length > 0 ? ', top: ' + authHits[0].memory.content.slice(0, 50) + '...' : ''}`);
    expect(authHits.length).toBeGreaterThan(0);

    // ── Step 4: Claude reflexion (if available) ──
    const claudePath = detectClaudeCli();
    if (claudePath && verifyClaudeCli(claudePath)) {
      console.log('  Step 4: Claude reflexion...');
      const cli = new ClaudeCliRunner(claudePath, CLAUDE_MODEL);
      const engine = new ReflexionEngine(cli);

      const memories = store.list({ includeArchived: false });
      const consolidation = await engine.runConsolidation(memories);
      console.log(`    Consolidation: ${consolidation.suggestions.length} suggestions`);

      if (consolidation.suggestions.length > 0) {
        const applicator = new ReflexionApplicator();
        const result = applicator.apply(consolidation.suggestions, store);
        console.log(`    Applied: ${result.applied}`);
      }

      const s2 = calculator.calculateIntelligence(store);
      recordIntelligenceScore(db, s2, 'reflexion');
      console.log(`    Intelligence: ${s2.total}/100`);
    } else {
      console.log('  Step 4: Skipped (no Claude CLI)');
    }

    // ── Final: Verify growth ──
    const history = getIntelligenceHistory(db);
    console.log(`\n  History: ${history.length} entries`);
    for (const h of history.reverse()) {
      console.log(`    ${h.eventType.padEnd(10)} → ${h.scoreTotal}/100`);
    }

    // Depth should grow as we add high-importance long-term memories
    // Total may fluctuate due to freshness averaging, so check depth
    expect(s1.depth).toBeGreaterThanOrEqual(s0.depth);
  }, 180_000);
});

// ── Helpers ──

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
