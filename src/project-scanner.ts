import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import type {
  IProjectScanner,
  ProjectSignals,
  LanguageSignal,
  FrameworkSignal,
  StructureSignal,
  ConfigFileSignal,
  DependencySignal,
  ScriptSignal,
} from './types.js';

/** Detectable language indicator files */
const LANGUAGE_INDICATORS: Array<{ file: string; language: string }> = [
  { file: 'tsconfig.json', language: 'TypeScript' },
  { file: 'jsconfig.json', language: 'JavaScript' },
  { file: 'package.json', language: 'JavaScript' },
  { file: 'go.mod', language: 'Go' },
  { file: 'Cargo.toml', language: 'Rust' },
  { file: 'requirements.txt', language: 'Python' },
  { file: 'pyproject.toml', language: 'Python' },
  { file: 'setup.py', language: 'Python' },
  { file: 'Pipfile', language: 'Python' },
  { file: 'Gemfile', language: 'Ruby' },
  { file: 'build.gradle', language: 'Java' },
  { file: 'build.gradle.kts', language: 'Kotlin' },
  { file: 'pom.xml', language: 'Java' },
  { file: 'mix.exs', language: 'Elixir' },
  { file: 'pubspec.yaml', language: 'Dart' },
  { file: 'composer.json', language: 'PHP' },
  { file: 'Package.swift', language: 'Swift' },
  { file: 'CMakeLists.txt', language: 'C/C++' },
  { file: 'Makefile', language: 'Make' },
];

/** Framework detection patterns in dependency keys */
const FRAMEWORK_PATTERNS: Array<{
  dependency: string;
  framework: string;
  source: 'npm' | 'any';
}> = [
  { dependency: 'react', framework: 'React', source: 'npm' },
  { dependency: 'next', framework: 'Next.js', source: 'npm' },
  { dependency: 'vue', framework: 'Vue', source: 'npm' },
  { dependency: 'nuxt', framework: 'Nuxt', source: 'npm' },
  { dependency: 'svelte', framework: 'Svelte', source: 'npm' },
  { dependency: '@sveltejs/kit', framework: 'SvelteKit', source: 'npm' },
  { dependency: 'express', framework: 'Express', source: 'npm' },
  { dependency: 'fastify', framework: 'Fastify', source: 'npm' },
  { dependency: 'hono', framework: 'Hono', source: 'npm' },
  { dependency: '@angular/core', framework: 'Angular', source: 'npm' },
  { dependency: 'astro', framework: 'Astro', source: 'npm' },
  { dependency: 'remix', framework: 'Remix', source: 'npm' },
  { dependency: '@remix-run/node', framework: 'Remix', source: 'npm' },
  { dependency: 'electron', framework: 'Electron', source: 'npm' },
  { dependency: 'vite', framework: 'Vite', source: 'npm' },
  { dependency: 'webpack', framework: 'Webpack', source: 'npm' },
  { dependency: 'tailwindcss', framework: 'Tailwind CSS', source: 'npm' },
];

/** Known structure directories and their purposes */
const STRUCTURE_DIRS: Array<{ dir: string; purpose: string }> = [
  { dir: 'src', purpose: 'source code' },
  { dir: 'lib', purpose: 'library code' },
  { dir: 'tests', purpose: 'tests' },
  { dir: 'test', purpose: 'tests' },
  { dir: '__tests__', purpose: 'tests' },
  { dir: 'spec', purpose: 'tests' },
  { dir: 'docs', purpose: 'documentation' },
  { dir: 'doc', purpose: 'documentation' },
  { dir: 'bin', purpose: 'executables' },
  { dir: 'scripts', purpose: 'build/utility scripts' },
  { dir: 'config', purpose: 'configuration' },
  { dir: 'public', purpose: 'static assets' },
  { dir: 'static', purpose: 'static assets' },
  { dir: 'assets', purpose: 'assets' },
  { dir: 'dist', purpose: 'build output' },
  { dir: 'build', purpose: 'build output' },
  { dir: 'out', purpose: 'build output' },
  { dir: '.github', purpose: 'GitHub configuration' },
  { dir: '.vscode', purpose: 'VS Code configuration' },
  { dir: 'migrations', purpose: 'database migrations' },
  { dir: 'prisma', purpose: 'database schema (Prisma)' },
  { dir: 'templates', purpose: 'templates' },
  { dir: 'fixtures', purpose: 'test fixtures' },
  { dir: 'e2e', purpose: 'end-to-end tests' },
  { dir: 'cypress', purpose: 'Cypress tests' },
  { dir: 'pages', purpose: 'page components' },
  { dir: 'app', purpose: 'application code' },
  { dir: 'components', purpose: 'UI components' },
  { dir: 'hooks', purpose: 'React hooks' },
  { dir: 'api', purpose: 'API routes' },
];

/** Config files to detect */
const CONFIG_FILE_PATTERNS: Array<{ file: string; category: ConfigFileSignal['category'] }> = [
  { file: '.env.example', category: 'env' },
  { file: '.env.sample', category: 'env' },
  { file: '.env.template', category: 'env' },
  { file: 'Dockerfile', category: 'docker' },
  { file: 'docker-compose.yml', category: 'docker' },
  { file: 'docker-compose.yaml', category: 'docker' },
  { file: '.dockerignore', category: 'docker' },
  { file: '.eslintrc.json', category: 'linter' },
  { file: '.eslintrc.js', category: 'linter' },
  { file: '.eslintrc.cjs', category: 'linter' },
  { file: 'eslint.config.js', category: 'linter' },
  { file: 'eslint.config.mjs', category: 'linter' },
  { file: '.prettierrc', category: 'linter' },
  { file: '.prettierrc.json', category: 'linter' },
  { file: 'prettier.config.js', category: 'linter' },
  { file: 'biome.json', category: 'linter' },
  { file: '.gitlab-ci.yml', category: 'ci' },
  { file: 'Jenkinsfile', category: 'ci' },
  { file: '.travis.yml', category: 'ci' },
  { file: 'vitest.config.ts', category: 'build' },
  { file: 'vitest.config.js', category: 'build' },
  { file: 'jest.config.js', category: 'build' },
  { file: 'jest.config.ts', category: 'build' },
  { file: 'webpack.config.js', category: 'build' },
  { file: 'vite.config.ts', category: 'build' },
  { file: 'vite.config.js', category: 'build' },
  { file: 'rollup.config.js', category: 'build' },
  { file: 'tsconfig.json', category: 'build' },
  { file: 'babel.config.js', category: 'build' },
  { file: '.babelrc', category: 'build' },
];

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function topLevelEntries(projectRoot: string): string[] {
  try {
    return readdirSync(projectRoot);
  } catch {
    return [];
  }
}

function isDirectory(fullPath: string): boolean {
  try {
    return statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

export class ProjectScanner implements IProjectScanner {
  async scan(projectRoot: string): Promise<ProjectSignals> {
    const entries = topLevelEntries(projectRoot);

    const language = this.detectLanguages(projectRoot, entries);
    const dependencies = this.extractDependencies(projectRoot, entries);
    const framework = this.detectFrameworks(projectRoot, dependencies);
    const structure = this.detectStructure(projectRoot, entries);
    const configFiles = this.detectConfigFiles(projectRoot, entries);
    const scripts = this.extractScripts(projectRoot, entries);
    const packageManager = this.detectPackageManager(projectRoot, entries);

    return { language, framework, structure, configFiles, dependencies, scripts, packageManager };
  }

  async scanIncremental(projectRoot: string, since: string): Promise<ProjectSignals> {
    let changedFiles: string[];
    try {
      const output = execSync(`git diff --name-only --diff-filter=ACMR "${since}"`, {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 10_000,
      });
      changedFiles = output.trim().split('\n').filter(Boolean);
    } catch {
      // If git fails, fall back to full scan
      return this.scan(projectRoot);
    }

    if (changedFiles.length === 0) {
      return emptySignals();
    }

    // Check if any root-level config files changed — if so, do relevant sub-scans
    const rootChanged = new Set(changedFiles.map((f) => f.split('/')[0]));
    const entries = topLevelEntries(projectRoot);

    const language = rootChanged.has('tsconfig.json') ||
      rootChanged.has('package.json') ||
      rootChanged.has('go.mod') ||
      rootChanged.has('Cargo.toml') ||
      rootChanged.has('requirements.txt') ||
      rootChanged.has('pyproject.toml')
      ? this.detectLanguages(projectRoot, entries)
      : [];

    const dependencies = rootChanged.has('package.json') ||
      rootChanged.has('go.mod') ||
      rootChanged.has('Cargo.toml') ||
      rootChanged.has('requirements.txt')
      ? this.extractDependencies(projectRoot, entries)
      : [];

    const framework = dependencies.length > 0
      ? this.detectFrameworks(projectRoot, dependencies)
      : [];

    // Structure detection only if new directories appeared
    const hasNewDirs = changedFiles.some((f) => f.includes('/'));
    const structure = hasNewDirs ? this.detectStructure(projectRoot, entries) : [];

    const configFiles = this.detectConfigFiles(projectRoot, entries);
    const scripts = rootChanged.has('package.json') || rootChanged.has('Makefile')
      ? this.extractScripts(projectRoot, entries)
      : [];

    const packageManager = this.detectPackageManager(projectRoot, entries);

    return { language, framework, structure, configFiles, dependencies, scripts, packageManager };
  }

  detectPackageManager(projectRoot: string, entries: string[]): string | undefined {
    const entrySet = new Set(entries);
    if (entrySet.has('pnpm-lock.yaml')) return 'pnpm';
    if (entrySet.has('yarn.lock')) return 'yarn';
    if (entrySet.has('bun.lockb')) return 'bun';
    if (entrySet.has('package-lock.json')) return 'npm';
    // If package.json exists but no lock file, default to npm
    if (entrySet.has('package.json')) return 'npm';
    // For non-JS projects
    if (entrySet.has('Cargo.toml')) return 'cargo';
    if (entrySet.has('go.mod')) return 'go';
    if (entrySet.has('pyproject.toml') || entrySet.has('requirements.txt') || entrySet.has('Pipfile')) return 'pip';
    if (entrySet.has('Gemfile')) return 'bundler';
    return undefined;
  }

  detectLanguages(projectRoot: string, entries: string[]): LanguageSignal[] {
    const entrySet = new Set(entries);
    const seen = new Map<string, LanguageSignal>();

    for (const indicator of LANGUAGE_INDICATORS) {
      if (entrySet.has(indicator.file)) {
        const existing = seen.get(indicator.language);
        if (existing) {
          // Increase confidence with more evidence
          existing.confidence = Math.min(1.0, existing.confidence + 0.2);
          existing.evidence += `, ${indicator.file}`;
        } else {
          // tsconfig upgrades JavaScript to TypeScript if package.json was already seen
          const confidence = indicator.file === 'package.json' ? 0.6 : 0.8;
          seen.set(indicator.language, {
            name: indicator.language,
            confidence,
            evidence: `${indicator.file} found`,
          });
        }
      }
    }

    // If both TypeScript and JavaScript detected, TypeScript takes precedence
    if (seen.has('TypeScript') && seen.has('JavaScript')) {
      const ts = seen.get('TypeScript')!;
      ts.confidence = Math.min(1.0, ts.confidence + 0.1);
      seen.delete('JavaScript');
    }

    return Array.from(seen.values());
  }

  detectFrameworks(projectRoot: string, dependencies: DependencySignal[]): FrameworkSignal[] {
    const seen = new Map<string, FrameworkSignal>();
    const depMap = new Map(dependencies.map((d) => [d.name, d]));

    for (const pattern of FRAMEWORK_PATTERNS) {
      const dep = depMap.get(pattern.dependency);
      if (dep) {
        if (!seen.has(pattern.framework)) {
          seen.set(pattern.framework, {
            name: pattern.framework,
            version: dep.version,
            confidence: 0.9,
            evidence: `${pattern.dependency} in ${dep.source}`,
          });
        }
      }
    }

    // Detect Django/Flask from requirements.txt or pyproject.toml
    for (const dep of dependencies) {
      if (dep.source !== 'package.json') {
        if (dep.name === 'django' || dep.name === 'Django') {
          seen.set('Django', { name: 'Django', version: dep.version, confidence: 0.9, evidence: `django in ${dep.source}` });
        } else if (dep.name === 'flask' || dep.name === 'Flask') {
          seen.set('Flask', { name: 'Flask', version: dep.version, confidence: 0.9, evidence: `flask in ${dep.source}` });
        } else if (dep.name === 'rails' || dep.name === 'rails') {
          seen.set('Rails', { name: 'Rails', version: dep.version, confidence: 0.9, evidence: `rails in ${dep.source}` });
        }
      }
    }

    return Array.from(seen.values());
  }

  detectStructure(projectRoot: string, entries: string[]): StructureSignal[] {
    const signals: StructureSignal[] = [];
    const entrySet = new Set(entries);

    for (const sd of STRUCTURE_DIRS) {
      if (entrySet.has(sd.dir) && isDirectory(join(projectRoot, sd.dir))) {
        signals.push({ directory: sd.dir, purpose: sd.purpose });
      }
    }

    // Detect GitHub Actions workflows
    const workflowsDir = join(projectRoot, '.github', 'workflows');
    if (existsSync(workflowsDir) && isDirectory(workflowsDir)) {
      signals.push({ directory: '.github/workflows', purpose: 'CI/CD workflows' });
    }

    return signals;
  }

  detectConfigFiles(projectRoot: string, entries: string[]): ConfigFileSignal[] {
    const signals: ConfigFileSignal[] = [];
    const entrySet = new Set(entries);

    for (const cf of CONFIG_FILE_PATTERNS) {
      if (entrySet.has(cf.file)) {
        signals.push({ path: cf.file, category: cf.category });
      }
    }

    // Detect GitHub Actions workflow files
    const workflowsDir = join(projectRoot, '.github', 'workflows');
    if (existsSync(workflowsDir) && isDirectory(workflowsDir)) {
      try {
        const wfEntries = readdirSync(workflowsDir);
        for (const wf of wfEntries) {
          if (wf.endsWith('.yml') || wf.endsWith('.yaml')) {
            signals.push({ path: `.github/workflows/${wf}`, category: 'ci' });
          }
        }
      } catch {
        // ignore
      }
    }

    return signals;
  }

  extractDependencies(projectRoot: string, entries: string[]): DependencySignal[] {
    const deps: DependencySignal[] = [];
    const entrySet = new Set(entries);

    // package.json
    if (entrySet.has('package.json')) {
      const pkg = readJsonSafe(join(projectRoot, 'package.json'));
      if (pkg) {
        const prodDeps = (pkg.dependencies ?? {}) as Record<string, string>;
        const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
        for (const [name, version] of Object.entries(prodDeps)) {
          deps.push({ name, version, source: 'package.json', dev: false });
        }
        for (const [name, version] of Object.entries(devDeps)) {
          deps.push({ name, version, source: 'package.json', dev: true });
        }
      }
    }

    // go.mod
    if (entrySet.has('go.mod')) {
      try {
        const raw = readFileSync(join(projectRoot, 'go.mod'), 'utf-8');
        const requireBlock = raw.match(/require\s*\(([\s\S]*?)\)/);
        if (requireBlock) {
          const lines = requireBlock[1].split('\n');
          for (const line of lines) {
            const match = line.trim().match(/^(\S+)\s+(\S+)/);
            if (match) {
              deps.push({ name: match[1], version: match[2], source: 'go.mod', dev: false });
            }
          }
        }
        // Also single-line require statements
        const singleRequires = raw.matchAll(/^require\s+(\S+)\s+(\S+)/gm);
        for (const m of singleRequires) {
          deps.push({ name: m[1], version: m[2], source: 'go.mod', dev: false });
        }
      } catch {
        // ignore
      }
    }

    // requirements.txt
    if (entrySet.has('requirements.txt')) {
      try {
        const raw = readFileSync(join(projectRoot, 'requirements.txt'), 'utf-8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
            const match = trimmed.match(/^([a-zA-Z0-9_-]+)(?:[=<>!~]+(.+))?/);
            if (match) {
              deps.push({ name: match[1], version: match[2] ?? undefined, source: 'requirements.txt', dev: false });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Cargo.toml
    if (entrySet.has('Cargo.toml')) {
      try {
        const raw = readFileSync(join(projectRoot, 'Cargo.toml'), 'utf-8');
        // Simple TOML parse for [dependencies] section
        const depSection = raw.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
        if (depSection) {
          for (const line of depSection[1].split('\n')) {
            const match = line.trim().match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
            if (match) {
              deps.push({ name: match[1], version: match[2], source: 'Cargo.toml', dev: false });
            }
          }
        }
        const devDepSection = raw.match(/\[dev-dependencies\]([\s\S]*?)(?:\[|$)/);
        if (devDepSection) {
          for (const line of devDepSection[1].split('\n')) {
            const match = line.trim().match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
            if (match) {
              deps.push({ name: match[1], version: match[2], source: 'Cargo.toml', dev: true });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    return deps;
  }

  extractScripts(projectRoot: string, entries: string[]): ScriptSignal[] {
    const scripts: ScriptSignal[] = [];
    const entrySet = new Set(entries);

    // package.json scripts
    if (entrySet.has('package.json')) {
      const pkg = readJsonSafe(join(projectRoot, 'package.json'));
      if (pkg && pkg.scripts && typeof pkg.scripts === 'object') {
        for (const [name, command] of Object.entries(pkg.scripts as Record<string, string>)) {
          scripts.push({ name, command, source: 'package.json scripts' });
        }
      }
    }

    // Makefile targets
    if (entrySet.has('Makefile')) {
      try {
        const raw = readFileSync(join(projectRoot, 'Makefile'), 'utf-8');
        const targetRegex = /^([a-zA-Z0-9_-]+)\s*:/gm;
        let match: RegExpExecArray | null;
        while ((match = targetRegex.exec(raw)) !== null) {
          // Skip internal targets starting with .
          if (!match[1].startsWith('.')) {
            scripts.push({ name: match[1], command: `make ${match[1]}`, source: 'Makefile' });
          }
        }
      } catch {
        // ignore
      }
    }

    return scripts;
  }
}

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
