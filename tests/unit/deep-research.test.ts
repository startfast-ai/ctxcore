import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { DeepResearcher } from '../../src/deep-research.js';
import { MemoryStore } from '../../src/memory-store.js';
import { createTestDb } from '../helpers/test-db.js';
import type { IClaudeCliRunner, ProjectSignals } from '../../src/types.js';

function makeSignals(overrides?: Partial<ProjectSignals>): ProjectSignals {
  return {
    language: [{ name: 'TypeScript', confidence: 1, evidence: 'tsconfig.json' }],
    framework: [{ name: 'Express', confidence: 0.9, evidence: 'package.json' }],
    structure: [{ directory: 'src', purpose: 'source' }],
    configFiles: [],
    dependencies: [
      { name: 'express', version: '4.21.0', source: 'package.json', dev: false },
      { name: 'jsonwebtoken', version: '9.0.0', source: 'package.json', dev: false },
    ],
    scripts: [{ name: 'build', command: 'tsc', source: 'package.json' }],
  };
}

function makeMockCli(response: string): IClaudeCliRunner {
  return {
    run: async () => response,
  };
}

const MOCK_SECURITY_RESPONSE = JSON.stringify([
  {
    content: 'SQL injection in user search endpoint — query built via string concatenation',
    category: 'security',
    severity: 'critical',
    tier: 'long-term',
    importance: 0.95,
    tags: ['sql-injection', 'auth'],
    file: 'src/routes/users.ts',
    line: 42,
    suggestion: 'Use parameterized queries instead of string concatenation',
  },
  {
    content: 'JWT secret hardcoded in source file',
    category: 'security',
    severity: 'high',
    tier: 'long-term',
    importance: 0.85,
    tags: ['jwt', 'secrets'],
    file: 'src/auth.ts',
    line: 10,
    suggestion: 'Move to environment variable',
  },
]);

const MOCK_ARCH_RESPONSE = JSON.stringify([
  {
    content: 'God class in UserService — handles auth, billing, notifications, and profile',
    category: 'architecture',
    severity: 'high',
    tier: 'long-term',
    importance: 0.7,
    tags: ['coupling', 'srp'],
    file: 'src/services/user.ts',
    suggestion: 'Split into separate services per domain',
  },
]);

describe('DeepResearcher', () => {
  let db: Database.Database;
  let store: MemoryStore;

  beforeEach(() => {
    db = createTestDb();
    store = new MemoryStore(db);
  });

  it('parses security findings from Claude response', async () => {
    const cli = makeMockCli(MOCK_SECURITY_RESPONSE);
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    // Should have findings from all 5 passes (same mock response each time)
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.memories.length).toBe(report.findings.length);

    // Check findings have correct structure
    const first = report.findings[0];
    expect(first.content).toContain('SQL injection');
    expect(first.category).toBe('security');
    expect(first.severity).toBe('critical');
    expect(first.importance).toBe(0.95);
  });

  it('stores findings as memories with correct tags', async () => {
    const cli = makeMockCli(MOCK_SECURITY_RESPONSE);
    const researcher = new DeepResearcher(cli);

    await researcher.research('/tmp/test', makeSignals(), store);

    const memories = store.list({ limit: 100 });
    expect(memories.length).toBeGreaterThan(0);

    const securityMemory = memories.find(m => m.content.includes('SQL injection'));
    expect(securityMemory).toBeDefined();
    expect(securityMemory!.tags).toContain('deep-research');
    expect(securityMemory!.tags).toContain('security');
    expect(securityMemory!.tags).toContain('severity:critical');
  });

  it('creates connections between related findings', async () => {
    // Both findings have the same file
    const sameFileResponse = JSON.stringify([
      { content: 'Issue A in auth', category: 'security', severity: 'high', importance: 0.8, tags: ['auth'], file: 'src/auth.ts', tier: 'long-term' },
      { content: 'Issue B in auth', category: 'security', severity: 'high', importance: 0.7, tags: ['auth'], file: 'src/auth.ts', tier: 'long-term' },
    ]);

    const cli = makeMockCli(sameFileResponse);
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    // Should have connections between same-file findings
    if (report.memories.length >= 2) {
      const conns = store.getConnectionsFor(report.memories[0].id);
      expect(conns.length).toBeGreaterThan(0);
    }
  });

  it('builds summary with severity and category counts', async () => {
    const cli = makeMockCli(MOCK_SECURITY_RESPONSE);
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.bySeverity).toBeDefined();
    expect(report.summary.byCategory).toBeDefined();
  });

  it('handles empty Claude response gracefully', async () => {
    const cli = makeMockCli('I could not analyze this project.');
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    expect(report.findings).toEqual([]);
    expect(report.memories).toEqual([]);
    expect(report.summary.total).toBe(0);
  });

  it('handles CLI failure gracefully', async () => {
    const cli: IClaudeCliRunner = {
      run: async () => { throw new Error('CLI crashed'); },
    };
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    expect(report.findings).toEqual([]);
    expect(report.memories).toEqual([]);
  });

  it('handles markdown-wrapped JSON response', async () => {
    const cli = makeMockCli('Here are the findings:\n```json\n' + MOCK_ARCH_RESPONSE + '\n```\nDone.');
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.some(f => f.content.includes('God class'))).toBe(true);
  });

  it('clamps importance to 0-1 range', async () => {
    const response = JSON.stringify([
      { content: 'Over-important', category: 'security', severity: 'high', importance: 5.0, tags: [], tier: 'long-term' },
      { content: 'Under-important', category: 'security', severity: 'low', importance: -1.0, tags: [], tier: 'short-term' },
    ]);

    const cli = makeMockCli(response);
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    for (const f of report.findings) {
      expect(f.importance).toBeGreaterThanOrEqual(0);
      expect(f.importance).toBeLessThanOrEqual(1);
    }
  });

  it('includes file and suggestion in memory content', async () => {
    const cli = makeMockCli(MOCK_SECURITY_RESPONSE);
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    const sqlMemory = report.memories.find(m => m.content.includes('SQL injection'));
    expect(sqlMemory).toBeDefined();
    expect(sqlMemory!.content).toContain('src/routes/users.ts');
    expect(sqlMemory!.content).toContain('parameterized queries');
  });

  it('tracks duration', async () => {
    const cli = makeMockCli(MOCK_SECURITY_RESPONSE);
    const researcher = new DeepResearcher(cli);

    const report = await researcher.research('/tmp/test', makeSignals(), store);

    expect(report.duration).toBeGreaterThan(0);
  });

  it('calls onProgress callback', async () => {
    const cli = makeMockCli(MOCK_SECURITY_RESPONSE);
    const researcher = new DeepResearcher(cli);

    const phases: string[] = [];
    await researcher.research('/tmp/test', makeSignals(), store, {
      onProgress: (phase) => phases.push(phase),
    });

    expect(phases).toContain('gathering');
    expect(phases).toContain('security');
    expect(phases).toContain('architecture');
    expect(phases).toContain('quality');
    expect(phases).toContain('dependencies');
    expect(phases).toContain('insights');
    expect(phases).toContain('storing');
  });
});
