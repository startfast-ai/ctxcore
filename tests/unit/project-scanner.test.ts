import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectScanner } from '../../src/project-scanner.js';

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), 'ctxcore-test-'));
}

describe('ProjectScanner', () => {
  let scanner: ProjectScanner;
  let projectDir: string;

  beforeEach(() => {
    scanner = new ProjectScanner();
    projectDir = createTempProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('scan()', () => {
    it('should return empty signals for an empty directory', async () => {
      const signals = await scanner.scan(projectDir);
      expect(signals.language).toEqual([]);
      expect(signals.framework).toEqual([]);
      expect(signals.structure).toEqual([]);
      expect(signals.configFiles).toEqual([]);
      expect(signals.dependencies).toEqual([]);
      expect(signals.scripts).toEqual([]);
    });

    it('should return all signal categories', async () => {
      const signals = await scanner.scan(projectDir);
      expect(signals).toHaveProperty('language');
      expect(signals).toHaveProperty('framework');
      expect(signals).toHaveProperty('structure');
      expect(signals).toHaveProperty('configFiles');
      expect(signals).toHaveProperty('dependencies');
      expect(signals).toHaveProperty('scripts');
    });
  });

  describe('detectLanguages()', () => {
    it('should detect TypeScript from tsconfig.json', async () => {
      writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
      const signals = await scanner.scan(projectDir);
      expect(signals.language).toContainEqual(
        expect.objectContaining({ name: 'TypeScript', evidence: expect.stringContaining('tsconfig.json') }),
      );
    });

    it('should detect JavaScript from package.json', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{"name":"test"}');
      const signals = await scanner.scan(projectDir);
      expect(signals.language).toContainEqual(
        expect.objectContaining({ name: 'JavaScript' }),
      );
    });

    it('should prefer TypeScript over JavaScript when both are present', async () => {
      writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
      writeFileSync(join(projectDir, 'package.json'), '{"name":"test"}');
      const signals = await scanner.scan(projectDir);
      const names = signals.language.map((l) => l.name);
      expect(names).toContain('TypeScript');
      expect(names).not.toContain('JavaScript');
    });

    it('should detect Go from go.mod', async () => {
      writeFileSync(join(projectDir, 'go.mod'), 'module example.com/test\n\ngo 1.21\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.language).toContainEqual(
        expect.objectContaining({ name: 'Go' }),
      );
    });

    it('should detect Rust from Cargo.toml', async () => {
      writeFileSync(join(projectDir, 'Cargo.toml'), '[package]\nname = "test"\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.language).toContainEqual(
        expect.objectContaining({ name: 'Rust' }),
      );
    });

    it('should detect Python from requirements.txt', async () => {
      writeFileSync(join(projectDir, 'requirements.txt'), 'flask==2.0\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.language).toContainEqual(
        expect.objectContaining({ name: 'Python' }),
      );
    });

    it('should detect Python from pyproject.toml', async () => {
      writeFileSync(join(projectDir, 'pyproject.toml'), '[project]\nname = "test"\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.language).toContainEqual(
        expect.objectContaining({ name: 'Python' }),
      );
    });

    it('should detect Ruby from Gemfile', async () => {
      writeFileSync(join(projectDir, 'Gemfile'), 'source "https://rubygems.org"\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.language).toContainEqual(
        expect.objectContaining({ name: 'Ruby' }),
      );
    });

    it('should detect multiple languages', async () => {
      writeFileSync(join(projectDir, 'go.mod'), 'module test\n');
      writeFileSync(join(projectDir, 'requirements.txt'), 'django\n');
      const signals = await scanner.scan(projectDir);
      const names = signals.language.map((l) => l.name);
      expect(names).toContain('Go');
      expect(names).toContain('Python');
    });
  });

  describe('detectFrameworks()', () => {
    it('should detect React from package.json dependencies', async () => {
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        }),
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.framework).toContainEqual(
        expect.objectContaining({ name: 'React', version: '^18.0.0' }),
      );
    });

    it('should detect Next.js from package.json', async () => {
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          dependencies: { next: '14.0.0', react: '^18.0.0' },
        }),
      );
      const signals = await scanner.scan(projectDir);
      const names = signals.framework.map((f) => f.name);
      expect(names).toContain('Next.js');
    });

    it('should detect Express from package.json', async () => {
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          dependencies: { express: '^4.18.0' },
        }),
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.framework).toContainEqual(
        expect.objectContaining({ name: 'Express' }),
      );
    });

    it('should detect Django from requirements.txt', async () => {
      writeFileSync(join(projectDir, 'requirements.txt'), 'Django==4.2\ndjango-rest-framework\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.framework).toContainEqual(
        expect.objectContaining({ name: 'Django' }),
      );
    });

    it('should detect multiple frameworks', async () => {
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          dependencies: { react: '^18.0.0', vite: '^5.0.0', tailwindcss: '^3.0.0' },
        }),
      );
      const signals = await scanner.scan(projectDir);
      const names = signals.framework.map((f) => f.name);
      expect(names).toContain('React');
      expect(names).toContain('Vite');
      expect(names).toContain('Tailwind CSS');
    });

    it('should have high confidence for detected frameworks', async () => {
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({ name: 'test', dependencies: { express: '^4.0.0' } }),
      );
      const signals = await scanner.scan(projectDir);
      for (const fw of signals.framework) {
        expect(fw.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });
  });

  describe('detectStructure()', () => {
    it('should detect src directory', async () => {
      mkdirSync(join(projectDir, 'src'));
      const signals = await scanner.scan(projectDir);
      expect(signals.structure).toContainEqual(
        expect.objectContaining({ directory: 'src', purpose: 'source code' }),
      );
    });

    it('should detect tests directory', async () => {
      mkdirSync(join(projectDir, 'tests'));
      const signals = await scanner.scan(projectDir);
      expect(signals.structure).toContainEqual(
        expect.objectContaining({ directory: 'tests', purpose: 'tests' }),
      );
    });

    it('should detect multiple structure directories', async () => {
      mkdirSync(join(projectDir, 'src'));
      mkdirSync(join(projectDir, 'tests'));
      mkdirSync(join(projectDir, 'docs'));
      mkdirSync(join(projectDir, 'bin'));
      const signals = await scanner.scan(projectDir);
      const dirs = signals.structure.map((s) => s.directory);
      expect(dirs).toContain('src');
      expect(dirs).toContain('tests');
      expect(dirs).toContain('docs');
      expect(dirs).toContain('bin');
    });

    it('should detect .github/workflows directory', async () => {
      mkdirSync(join(projectDir, '.github', 'workflows'), { recursive: true });
      const signals = await scanner.scan(projectDir);
      expect(signals.structure).toContainEqual(
        expect.objectContaining({ directory: '.github/workflows', purpose: 'CI/CD workflows' }),
      );
    });

    it('should not detect files as directories', async () => {
      writeFileSync(join(projectDir, 'src'), 'not a directory');
      const signals = await scanner.scan(projectDir);
      const dirs = signals.structure.map((s) => s.directory);
      expect(dirs).not.toContain('src');
    });
  });

  describe('detectConfigFiles()', () => {
    it('should detect Dockerfile', async () => {
      writeFileSync(join(projectDir, 'Dockerfile'), 'FROM node:20\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.configFiles).toContainEqual(
        expect.objectContaining({ path: 'Dockerfile', category: 'docker' }),
      );
    });

    it('should detect docker-compose.yml', async () => {
      writeFileSync(join(projectDir, 'docker-compose.yml'), 'version: "3"\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.configFiles).toContainEqual(
        expect.objectContaining({ path: 'docker-compose.yml', category: 'docker' }),
      );
    });

    it('should detect .env.example', async () => {
      writeFileSync(join(projectDir, '.env.example'), 'DB_HOST=localhost\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.configFiles).toContainEqual(
        expect.objectContaining({ path: '.env.example', category: 'env' }),
      );
    });

    it('should detect CI workflow files', async () => {
      mkdirSync(join(projectDir, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(projectDir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.configFiles).toContainEqual(
        expect.objectContaining({ path: '.github/workflows/ci.yml', category: 'ci' }),
      );
    });

    it('should detect linter configs', async () => {
      writeFileSync(join(projectDir, '.eslintrc.json'), '{}');
      const signals = await scanner.scan(projectDir);
      expect(signals.configFiles).toContainEqual(
        expect.objectContaining({ path: '.eslintrc.json', category: 'linter' }),
      );
    });

    it('should detect build configs', async () => {
      writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
      const signals = await scanner.scan(projectDir);
      expect(signals.configFiles).toContainEqual(
        expect.objectContaining({ path: 'tsconfig.json', category: 'build' }),
      );
    });
  });

  describe('extractDependencies()', () => {
    it('should extract npm production dependencies', async () => {
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          dependencies: { express: '^4.18.0', lodash: '^4.17.0' },
        }),
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'express', version: '^4.18.0', dev: false }),
      );
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'lodash', version: '^4.17.0', dev: false }),
      );
    });

    it('should extract npm dev dependencies', async () => {
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          devDependencies: { vitest: '^1.0.0' },
        }),
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'vitest', dev: true, source: 'package.json' }),
      );
    });

    it('should extract Go module dependencies', async () => {
      writeFileSync(
        join(projectDir, 'go.mod'),
        `module example.com/test

go 1.21

require (
\tgithub.com/gin-gonic/gin v1.9.0
\tgithub.com/lib/pq v1.10.0
)
`,
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'github.com/gin-gonic/gin', version: 'v1.9.0', source: 'go.mod' }),
      );
    });

    it('should extract Python dependencies from requirements.txt', async () => {
      writeFileSync(
        join(projectDir, 'requirements.txt'),
        'flask==2.0.0\nrequests>=2.28\nblack\n# comment\n',
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'flask', source: 'requirements.txt' }),
      );
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'requests', source: 'requirements.txt' }),
      );
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'black', source: 'requirements.txt' }),
      );
    });

    it('should skip comments in requirements.txt', async () => {
      writeFileSync(join(projectDir, 'requirements.txt'), '# this is a comment\nflask\n');
      const signals = await scanner.scan(projectDir);
      expect(signals.dependencies).toHaveLength(1);
      expect(signals.dependencies[0].name).toBe('flask');
    });

    it('should extract Rust dependencies from Cargo.toml', async () => {
      writeFileSync(
        join(projectDir, 'Cargo.toml'),
        `[package]
name = "test"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = "1.0"

[dev-dependencies]
criterion = "0.5"
`,
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'serde', version: '1.0', dev: false }),
      );
      expect(signals.dependencies).toContainEqual(
        expect.objectContaining({ name: 'criterion', version: '0.5', dev: true }),
      );
    });
  });

  describe('extractScripts()', () => {
    it('should extract npm scripts from package.json', async () => {
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          scripts: {
            build: 'tsc',
            test: 'vitest run',
            dev: 'tsc --watch',
          },
        }),
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.scripts).toContainEqual(
        expect.objectContaining({ name: 'build', command: 'tsc', source: 'package.json scripts' }),
      );
      expect(signals.scripts).toContainEqual(
        expect.objectContaining({ name: 'test', command: 'vitest run' }),
      );
    });

    it('should extract Makefile targets', async () => {
      writeFileSync(
        join(projectDir, 'Makefile'),
        `build:
\tgo build ./...

test:
\tgo test ./...

lint:
\tgolangci-lint run
`,
      );
      const signals = await scanner.scan(projectDir);
      expect(signals.scripts).toContainEqual(
        expect.objectContaining({ name: 'build', command: 'make build', source: 'Makefile' }),
      );
      expect(signals.scripts).toContainEqual(
        expect.objectContaining({ name: 'test', command: 'make test', source: 'Makefile' }),
      );
    });

    it('should handle package.json without scripts', async () => {
      writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test' }));
      const signals = await scanner.scan(projectDir);
      // Should not crash, scripts from package.json should be empty
      const pkgScripts = signals.scripts.filter((s) => s.source === 'package.json scripts');
      expect(pkgScripts).toHaveLength(0);
    });
  });

  describe('full project scan', () => {
    it('should scan a realistic TypeScript project', async () => {
      // Set up a realistic project structure
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'my-app',
          scripts: { build: 'tsc', test: 'vitest run' },
          dependencies: { express: '^4.18.0', zod: '^3.0.0' },
          devDependencies: { typescript: '^5.0.0', vitest: '^1.0.0' },
        }),
      );
      writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
      mkdirSync(join(projectDir, 'src'));
      mkdirSync(join(projectDir, 'tests'));
      writeFileSync(join(projectDir, 'Dockerfile'), 'FROM node:20\n');

      const signals = await scanner.scan(projectDir);

      // Language
      expect(signals.language.map((l) => l.name)).toContain('TypeScript');

      // Framework
      expect(signals.framework.map((f) => f.name)).toContain('Express');

      // Structure
      expect(signals.structure.map((s) => s.directory)).toContain('src');
      expect(signals.structure.map((s) => s.directory)).toContain('tests');

      // Config
      expect(signals.configFiles.map((c) => c.path)).toContain('Dockerfile');
      expect(signals.configFiles.map((c) => c.path)).toContain('tsconfig.json');

      // Dependencies
      expect(signals.dependencies.some((d) => d.name === 'express')).toBe(true);

      // Scripts
      expect(signals.scripts.some((s) => s.name === 'build')).toBe(true);
    });
  });

  describe('scanIncremental()', () => {
    it('should fall back to full scan when git is not available', async () => {
      // Temp dir is not a git repo, so git diff will fail
      writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test' }));
      const signals = await scanner.scanIncremental(projectDir, '2024-01-01');
      // Should return full scan results (fallback)
      expect(signals.language).toBeDefined();
    });
  });
});
