import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySeeder } from '../../src/seed-memories.js';
import { MemoryStore } from '../../src/memory-store.js';
import { createTestDb } from '../helpers/test-db.js';
import type { IMemoryStore, ProjectSignals } from '../../src/types.js';
import type Database from 'better-sqlite3';

function emptySignals(): ProjectSignals {
  return {
    language: [],
    framework: [],
    structure: [],
    configFiles: [],
    dependencies: [],
    scripts: [],
  };
}

describe('MemorySeeder', () => {
  let seeder: MemorySeeder;
  let store: IMemoryStore;
  let db: Database.Database;

  beforeEach(() => {
    seeder = new MemorySeeder();
    db = createTestDb();
    store = new MemoryStore(db);
  });

  describe('seed()', () => {
    it('should return empty array for empty signals', () => {
      const memories = seeder.seed(emptySignals(), store);
      expect(memories).toHaveLength(0);
    });

    it('should create language memories as long-term with importance 0.6', () => {
      const signals = emptySignals();
      signals.language = [{ name: 'TypeScript', confidence: 0.9, evidence: 'tsconfig.json found' }];

      const memories = seeder.seed(signals, store);
      expect(memories).toHaveLength(1);
      expect(memories[0].tier).toBe('long-term');
      expect(memories[0].importance).toBe(0.6);
      expect(memories[0].content).toContain('TypeScript');
      expect(memories[0].tags).toContain('language');
      expect(memories[0].tags).toContain('project-analysis');
    });

    it('should create framework memories as long-term with importance 0.6', () => {
      const signals = emptySignals();
      signals.framework = [
        { name: 'React', version: '^18.0.0', confidence: 0.9, evidence: 'react in package.json' },
      ];

      const memories = seeder.seed(signals, store);
      expect(memories).toHaveLength(1);
      expect(memories[0].tier).toBe('long-term');
      expect(memories[0].importance).toBe(0.6);
      expect(memories[0].content).toContain('React');
      expect(memories[0].content).toContain('^18.0.0');
    });

    it('should create structure memory as long-term with importance 0.5', () => {
      const signals = emptySignals();
      signals.structure = [
        { directory: 'src', purpose: 'source code' },
        { directory: 'tests', purpose: 'tests' },
      ];

      const memories = seeder.seed(signals, store);
      expect(memories).toHaveLength(1);
      expect(memories[0].tier).toBe('long-term');
      expect(memories[0].importance).toBe(0.5);
      expect(memories[0].content).toContain('src');
      expect(memories[0].content).toContain('tests');
      expect(memories[0].tags).toContain('structure');
    });

    it('should create config memories as operational with importance 0.3', () => {
      const signals = emptySignals();
      signals.configFiles = [
        { path: 'Dockerfile', category: 'docker' },
        { path: 'docker-compose.yml', category: 'docker' },
        { path: '.eslintrc.json', category: 'linter' },
      ];

      const memories = seeder.seed(signals, store);
      // Two memories: one for docker, one for linter
      expect(memories).toHaveLength(2);
      for (const mem of memories) {
        expect(mem.tier).toBe('operational');
        expect(mem.importance).toBe(0.3);
        expect(mem.tags).toContain('config');
      }
    });

    it('should create dependency memories as operational with importance 0.4', () => {
      const signals = emptySignals();
      signals.dependencies = [
        { name: 'express', version: '^4.18.0', source: 'package.json', dev: false },
        { name: 'lodash', version: '^4.17.0', source: 'package.json', dev: false },
      ];

      const memories = seeder.seed(signals, store);
      expect(memories).toHaveLength(1); // Grouped by source
      expect(memories[0].tier).toBe('operational');
      expect(memories[0].importance).toBe(0.4);
      expect(memories[0].content).toContain('express');
      expect(memories[0].content).toContain('lodash');
    });

    it('should skip dev dependencies in memory creation', () => {
      const signals = emptySignals();
      signals.dependencies = [
        { name: 'vitest', version: '^1.0.0', source: 'package.json', dev: true },
      ];

      const memories = seeder.seed(signals, store);
      // Dev-only dependencies should not create a memory
      expect(memories).toHaveLength(0);
    });

    it('should create script memories as operational with importance 0.3', () => {
      const signals = emptySignals();
      signals.scripts = [
        { name: 'build', command: 'tsc', source: 'package.json scripts' },
        { name: 'test', command: 'vitest run', source: 'package.json scripts' },
      ];

      const memories = seeder.seed(signals, store);
      expect(memories).toHaveLength(1); // Grouped by source
      expect(memories[0].tier).toBe('operational');
      expect(memories[0].importance).toBe(0.3);
      expect(memories[0].content).toContain('build');
      expect(memories[0].content).toContain('test');
    });

    it('should persist memories in the store', () => {
      const signals = emptySignals();
      signals.language = [{ name: 'Go', confidence: 0.8, evidence: 'go.mod found' }];

      const memories = seeder.seed(signals, store);
      const retrieved = store.getById(memories[0].id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toContain('Go');
    });

    it('should handle a full realistic project', () => {
      const signals: ProjectSignals = {
        language: [
          { name: 'TypeScript', confidence: 0.9, evidence: 'tsconfig.json found' },
        ],
        framework: [
          { name: 'Express', version: '^4.18.0', confidence: 0.9, evidence: 'express in package.json' },
        ],
        structure: [
          { directory: 'src', purpose: 'source code' },
          { directory: 'tests', purpose: 'tests' },
          { directory: 'dist', purpose: 'build output' },
        ],
        configFiles: [
          { path: 'Dockerfile', category: 'docker' },
          { path: 'tsconfig.json', category: 'build' },
          { path: '.github/workflows/ci.yml', category: 'ci' },
        ],
        dependencies: [
          { name: 'express', version: '^4.18.0', source: 'package.json', dev: false },
          { name: 'zod', version: '^3.0.0', source: 'package.json', dev: false },
          { name: 'vitest', version: '^1.0.0', source: 'package.json', dev: true },
        ],
        scripts: [
          { name: 'build', command: 'tsc', source: 'package.json scripts' },
          { name: 'test', command: 'vitest run', source: 'package.json scripts' },
        ],
      };

      const memories = seeder.seed(signals, store);
      // language(1) + framework(1) + structure(1) + config(3 categories) + deps(1 prod group) + scripts(1)
      expect(memories.length).toBeGreaterThanOrEqual(7);

      // Verify tiers
      const langMem = memories.find((m) => m.tags.includes('language'));
      expect(langMem?.tier).toBe('long-term');

      const fwMem = memories.find((m) => m.tags.includes('framework'));
      expect(fwMem?.tier).toBe('long-term');

      const structMem = memories.find((m) => m.tags.includes('structure'));
      expect(structMem?.tier).toBe('long-term');

      const configMems = memories.filter((m) => m.tags.includes('config'));
      for (const cm of configMems) {
        expect(cm.tier).toBe('operational');
      }
    });
  });

  describe('connections', () => {
    it('should create framework-to-language connections', () => {
      const signals = emptySignals();
      signals.language = [{ name: 'TypeScript', confidence: 0.9, evidence: 'tsconfig.json found' }];
      signals.framework = [
        { name: 'Express', version: '^4.18.0', confidence: 0.9, evidence: 'express in package.json' },
      ];

      const memories = seeder.seed(signals, store);
      const fwMem = memories.find((m) => m.tags.includes('framework'))!;
      const langMem = memories.find((m) => m.tags.includes('language'))!;

      const connections = store.getConnectionsFor(fwMem.id);
      expect(connections.length).toBeGreaterThanOrEqual(1);

      const fwToLang = connections.find(
        (c) => (c.sourceId === fwMem.id && c.targetId === langMem.id) ||
               (c.sourceId === langMem.id && c.targetId === fwMem.id),
      );
      expect(fwToLang).toBeDefined();
      expect(fwToLang!.type).toBe('supports');
    });

    it('should create deps-to-structure connections', () => {
      const signals = emptySignals();
      signals.structure = [{ directory: 'src', purpose: 'source code' }];
      signals.dependencies = [
        { name: 'express', version: '^4.18.0', source: 'package.json', dev: false },
      ];

      const memories = seeder.seed(signals, store);
      const structMem = memories.find((m) => m.tags.includes('structure'))!;
      const depsMem = memories.find((m) => m.tags.includes('dependencies'))!;

      const connections = store.getConnectionsFor(depsMem.id);
      const depToStruct = connections.find(
        (c) => c.targetId === structMem.id || c.sourceId === structMem.id,
      );
      expect(depToStruct).toBeDefined();
      expect(depToStruct!.type).toBe('supports');
    });

    it('should create CI-to-scripts connections', () => {
      const signals = emptySignals();
      signals.configFiles = [{ path: '.github/workflows/ci.yml', category: 'ci' }];
      signals.scripts = [
        { name: 'test', command: 'vitest run', source: 'package.json scripts' },
      ];

      const memories = seeder.seed(signals, store);
      const ciMem = memories.find((m) => m.tags.includes('ci'))!;
      const scriptsMem = memories.find((m) => m.tags.includes('scripts'))!;

      const connections = store.getConnectionsFor(ciMem.id);
      const ciToScripts = connections.find(
        (c) => c.targetId === scriptsMem.id || c.sourceId === scriptsMem.id,
      );
      expect(ciToScripts).toBeDefined();
    });

    it('should not create connections when related memories are missing', () => {
      const signals = emptySignals();
      signals.framework = [
        { name: 'Express', version: '^4.18.0', confidence: 0.9, evidence: 'express in package.json' },
      ];
      // No language signal — connection should not be created

      const memories = seeder.seed(signals, store);
      const fwMem = memories.find((m) => m.tags.includes('framework'))!;
      const connections = store.getConnectionsFor(fwMem.id);
      // No language memory exists, so no framework-to-language connection
      const langConnections = connections.filter((c) => {
        const otherId = c.sourceId === fwMem.id ? c.targetId : c.sourceId;
        const otherMem = store.getById(otherId);
        return otherMem?.tags.includes('language');
      });
      expect(langConnections).toHaveLength(0);
    });
  });

  describe('metadata', () => {
    it('should include source metadata on all seeded memories', () => {
      const signals = emptySignals();
      signals.language = [{ name: 'Python', confidence: 0.8, evidence: 'requirements.txt found' }];

      const memories = seeder.seed(signals, store);
      for (const mem of memories) {
        expect(mem.metadata).toHaveProperty('source', 'project-scanner');
        expect(mem.metadata).toHaveProperty('signal');
      }
    });
  });
});
