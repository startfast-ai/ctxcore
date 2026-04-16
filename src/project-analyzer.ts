import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import type { IClaudeCliRunner, IMemoryStore, Memory, ProjectSignals } from './types.js';

// ── Tiered file definitions ──

interface FileSpec {
  path: string;
  type: string;
  maxSize: number;
  isDir?: boolean;
}

const TIER_1_FILES: FileSpec[] = [
  { path: 'README.md', type: 'project_description', maxSize: 5000 },
  { path: 'CLAUDE.md', type: 'existing_knowledge', maxSize: 10000 },
  { path: 'ARCHITECTURE.md', type: 'architecture', maxSize: 10000 },
  { path: '.env.example', type: 'config_shape', maxSize: 2000 },
];

const TIER_2_BY_LANGUAGE: Record<string, FileSpec[]> = {
  TypeScript: [
    { path: 'package.json', type: 'dependencies', maxSize: 5000 },
    { path: 'tsconfig.json', type: 'ts_config', maxSize: 2000 },
    { path: '.eslintrc.json', type: 'lint_config', maxSize: 2000 },
    { path: '.eslintrc.js', type: 'lint_config', maxSize: 2000 },
    { path: 'eslint.config.js', type: 'lint_config', maxSize: 2000 },
    { path: 'eslint.config.mjs', type: 'lint_config', maxSize: 2000 },
    { path: '.prettierrc', type: 'format_config', maxSize: 1000 },
    { path: '.prettierrc.json', type: 'format_config', maxSize: 1000 },
    { path: 'vitest.config.ts', type: 'test_config', maxSize: 2000 },
    { path: 'jest.config.ts', type: 'test_config', maxSize: 2000 },
    { path: 'jest.config.js', type: 'test_config', maxSize: 2000 },
  ],
  JavaScript: [
    { path: 'package.json', type: 'dependencies', maxSize: 5000 },
    { path: '.eslintrc.json', type: 'lint_config', maxSize: 2000 },
    { path: '.eslintrc.js', type: 'lint_config', maxSize: 2000 },
    { path: 'eslint.config.js', type: 'lint_config', maxSize: 2000 },
    { path: '.prettierrc', type: 'format_config', maxSize: 1000 },
    { path: 'vitest.config.ts', type: 'test_config', maxSize: 2000 },
    { path: 'jest.config.js', type: 'test_config', maxSize: 2000 },
  ],
  Python: [
    { path: 'pyproject.toml', type: 'dependencies', maxSize: 5000 },
    { path: 'setup.py', type: 'dependencies', maxSize: 3000 },
    { path: 'requirements.txt', type: 'dependencies', maxSize: 2000 },
    { path: 'mypy.ini', type: 'type_config', maxSize: 1000 },
    { path: '.flake8', type: 'lint_config', maxSize: 1000 },
    { path: 'pytest.ini', type: 'test_config', maxSize: 1000 },
  ],
  Rust: [
    { path: 'Cargo.toml', type: 'dependencies', maxSize: 5000 },
    { path: 'rustfmt.toml', type: 'format_config', maxSize: 1000 },
    { path: 'clippy.toml', type: 'lint_config', maxSize: 1000 },
  ],
  Go: [
    { path: 'go.mod', type: 'dependencies', maxSize: 3000 },
  ],
};

const TIER_3_FILES: FileSpec[] = [
  { path: 'Dockerfile', type: 'docker', maxSize: 3000 },
  { path: 'docker-compose.yml', type: 'docker_compose', maxSize: 5000 },
  { path: 'docker-compose.yaml', type: 'docker_compose', maxSize: 5000 },
  { path: '.github/workflows', type: 'ci', maxSize: 5000, isDir: true },
  { path: '.gitlab-ci.yml', type: 'ci', maxSize: 5000 },
  { path: 'Makefile', type: 'build_scripts', maxSize: 3000 },
];

const TIER_4_FILES: FileSpec[] = [
  { path: 'prisma/schema.prisma', type: 'data_model', maxSize: 10000 },
  { path: 'schema.graphql', type: 'api_schema', maxSize: 5000 },
  { path: 'openapi.yaml', type: 'api_schema', maxSize: 5000 },
  { path: 'openapi.json', type: 'api_schema', maxSize: 5000 },
];

const ADR_DIRS = ['docs/adr', 'docs/decisions', 'adr', 'decisions'];

const MAX_TOTAL_CHARS = 15000;

interface AnalyzedMemory {
  content: string;
  tier: 'long-term' | 'operational' | 'short-term';
  importance: number;
  category?: string;
  tags: string[];
  connections?: Array<{ target_index: number; type: string }>;
}

/**
 * Uses Claude CLI to deeply analyze a project and generate rich memories
 * that go beyond what static file scanning can produce.
 */
export class ProjectAnalyzer {
  constructor(private cliRunner: IClaudeCliRunner) {}

  async analyze(
    projectRoot: string,
    signals: ProjectSignals,
    store: IMemoryStore,
    onFileRead?: (file: string) => void,
  ): Promise<Memory[]> {
    const fileContents = this.gatherKeyFiles(projectRoot, signals, onFileRead);
    const gitInfo = this.gatherGitInfo(projectRoot);
    const directoryTree = this.generateDirectoryTree(projectRoot);
    const signalsSummary = this.formatSignals(signals);

    const prompt = this.buildPrompt(signals, signalsSummary, fileContents, gitInfo, directoryTree);

    let response: string;
    try {
      response = await this.cliRunner.run(prompt, { timeout: 120_000 });
    } catch (err) {
      log(`Claude CLI analysis failed: ${(err as Error).message}`);
      return [];
    }

    const analyzed = this.parseResponse(response);
    if (analyzed.length === 0) {
      log('Claude CLI returned no usable memories');
      return [];
    }

    const memories: Memory[] = [];
    const memoryIds: string[] = [];
    for (const item of analyzed) {
      const mem = store.create({
        content: item.content,
        tier: item.tier,
        importance: Math.max(0, Math.min(1, item.importance)),
        tags: [...item.tags, 'claude-analysis'],
        metadata: {
          source: 'project-analyzer',
          analyzedAt: new Date().toISOString(),
          ...(item.category ? { category: item.category } : {}),
        },
      });
      memories.push(mem);
      memoryIds.push(mem.id);
    }

    // Create connections from analysis
    for (let i = 0; i < analyzed.length; i++) {
      const item = analyzed[i];
      if (item.connections && Array.isArray(item.connections)) {
        for (const conn of item.connections) {
          if (
            typeof conn.target_index === 'number' &&
            conn.target_index >= 0 &&
            conn.target_index < memoryIds.length &&
            conn.target_index !== i
          ) {
            const connType = conn.type as 'causal' | 'contradicts' | 'supports' | 'temporal' | 'similar';
            if (['causal', 'contradicts', 'supports', 'temporal', 'similar'].includes(connType)) {
              try {
                store.createConnection({
                  sourceId: memoryIds[i],
                  targetId: memoryIds[conn.target_index],
                  type: connType,
                  strength: 0.7,
                });
              } catch {
                // Skip invalid connections
              }
            }
          }
        }
      }
    }

    return memories;
  }

  private buildPrompt(
    signals: ProjectSignals,
    signalsSummary: string,
    fileContents: string,
    gitInfo: { log: string | null; contributors: string | null },
    directoryTree: string,
  ): string {
    const projectName = this.detectProjectName(signals);
    const primaryLanguage = signals.language.length > 0 ? signals.language[0].name : 'unknown';
    const framework = signals.framework.length > 0 ? signals.framework[0].name : 'none detected';
    const packageManager = signals.packageManager ?? 'unknown';
    const hasDocker = signals.configFiles.some(c => c.category === 'docker');
    const hasCI = signals.configFiles.some(c => c.category === 'ci');
    const ciPlatform = signals.configFiles.find(c => c.category === 'ci')?.path.includes('github') ? 'GitHub Actions' :
      signals.configFiles.find(c => c.category === 'ci')?.path.includes('gitlab') ? 'GitLab CI' : 'unknown';

    return `You are analyzing a software project to create an initial knowledge base.

PROJECT OVERVIEW:
  Name: ${projectName}
  Language: ${primaryLanguage}
  Framework: ${framework}
  Package Manager: ${packageManager}
  Has Docker: ${hasDocker}
  Has CI: ${hasCI}${hasCI ? ` (${ciPlatform})` : ''}

PROJECT SIGNALS:
${signalsSummary}

DIRECTORY STRUCTURE:
${directoryTree}

${gitInfo.log ? `RECENT GIT HISTORY (last 30 commits):\n${gitInfo.log}\n` : ''}
${gitInfo.contributors ? `TOP CONTRIBUTORS:\n${gitInfo.contributors}\n` : ''}

PROJECT FILES:
${fileContents}

INSTRUCTIONS:
Analyze this project and extract structured knowledge. For each piece of knowledge, provide:

1. "content" - a clear, specific, actionable statement. Not vague. Not obvious.
   BAD: "This is a TypeScript project"
   GOOD: "TypeScript strict mode is enabled with noImplicitAny, strictNullChecks, and exactOptionalPropertyTypes"

2. "tier" - "long-term" for architecture/decisions/patterns that rarely change, "operational" for conventions and active knowledge, "short-term" for recent/temporary info

3. "importance" - 0.1 to 1.0:
   - 0.1-0.3: routine info (file locations, basic structure)
   - 0.3-0.6: conventions and patterns (naming, testing approach)
   - 0.6-0.8: key decisions with rationale
   - 0.8-1.0: critical architecture, security constraints, hard-won knowledge

4. "category" - one of: "architecture", "convention", "decision", "dependency", "workflow", "pattern", "domain", "infrastructure", "testing", "security"

5. "tags" - array of relevant tags (module names, technology names, concepts)

6. "connections" - array of objects with target_index (index of another memory in this array) and type ("causal", "supports", "contradicts", "similar", "temporal")

Focus on knowledge that would help an AI assistant work effectively on this project.
Skip anything that's obvious from the language/framework choice alone.
Prioritize decisions and their rationale over mere facts.
If CLAUDE.md exists, import its instructions as high-importance memories.
If ADRs exist, each one should become a high-importance decision memory.

Respond with ONLY a valid JSON array, no other text:
[
  {
    "content": "...",
    "tier": "long-term",
    "importance": 0.7,
    "category": "architecture",
    "tags": ["auth", "jwt"],
    "connections": [{ "target_index": 3, "type": "causal" }]
  }
]

Aim for 5-15 high-quality memories.`;
  }

  private detectProjectName(signals: ProjectSignals): string {
    // Try to extract from package.json dependency signals
    // Fallback to directory-based detection
    return 'project';
  }

  private gatherKeyFiles(
    projectRoot: string,
    signals: ProjectSignals,
    onFileRead?: (file: string) => void,
  ): string {
    const parts: string[] = [];
    let totalChars = 0;
    const seenPaths = new Set<string>();

    // Determine primary language for tier 2
    const primaryLanguage = signals.language.length > 0 ? signals.language[0].name : null;

    // Build the file list from tiers
    const allSpecs: FileSpec[] = [
      ...TIER_1_FILES,
      ...(primaryLanguage && TIER_2_BY_LANGUAGE[primaryLanguage] ? TIER_2_BY_LANGUAGE[primaryLanguage] : []),
      ...TIER_3_FILES,
      ...TIER_4_FILES,
    ];

    for (const spec of allSpecs) {
      if (totalChars >= MAX_TOTAL_CHARS) break;
      if (seenPaths.has(spec.path)) continue;
      seenPaths.add(spec.path);

      const fullPath = join(projectRoot, spec.path);

      if (spec.isDir) {
        // Read all files in directory, concatenated
        const dirContent = this.readDirectoryFiles(fullPath, spec.maxSize);
        if (dirContent) {
          onFileRead?.(spec.path);
          const entry = `--- ${spec.path} (${spec.type}) ---\n${dirContent}`;
          parts.push(entry);
          totalChars += entry.length;
        }
        continue;
      }

      if (!existsSync(fullPath)) continue;

      onFileRead?.(spec.path);

      try {
        let content = readFileSync(fullPath, 'utf-8');
        if (content.length > spec.maxSize) {
          content = content.slice(0, spec.maxSize) + '\n... (truncated)';
        }
        const entry = `--- ${spec.path} (${spec.type}) ---\n${content}`;
        parts.push(entry);
        totalChars += entry.length;
      } catch {
        // Skip unreadable files
      }
    }

    // Tier 5: ADRs
    for (const adrDir of ADR_DIRS) {
      if (totalChars >= MAX_TOTAL_CHARS) break;
      const adrPath = join(projectRoot, adrDir);
      if (!existsSync(adrPath) || !isDirectory(adrPath)) continue;

      try {
        const files = readdirSync(adrPath).filter(f => f.endsWith('.md'));
        for (const file of files) {
          if (totalChars >= MAX_TOTAL_CHARS) break;
          const filePath = join(adrPath, file);
          try {
            let content = readFileSync(filePath, 'utf-8');
            if (content.length > 3000) {
              content = content.slice(0, 3000) + '\n... (truncated)';
            }
            onFileRead?.(`${adrDir}/${file}`);
            const entry = `--- ${adrDir}/${file} (adr) ---\n${content}`;
            parts.push(entry);
            totalChars += entry.length;
          } catch {
            // Skip
          }
        }
      } catch {
        // Skip
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : '(no key files found)';
  }

  private readDirectoryFiles(dirPath: string, maxSize: number): string | null {
    if (!existsSync(dirPath) || !isDirectory(dirPath)) return null;

    try {
      const files = readdirSync(dirPath);
      const parts: string[] = [];
      let total = 0;

      for (const file of files) {
        if (total >= maxSize) break;
        const fullPath = join(dirPath, file);
        if (!isFile(fullPath)) continue;

        try {
          let content = readFileSync(fullPath, 'utf-8');
          const remaining = maxSize - total;
          if (content.length > remaining) {
            content = content.slice(0, remaining) + '\n... (truncated)';
          }
          parts.push(`## ${file}\n${content}`);
          total += content.length;
        } catch {
          // Skip
        }
      }

      return parts.length > 0 ? parts.join('\n\n') : null;
    } catch {
      return null;
    }
  }

  private gatherGitInfo(projectRoot: string): { log: string | null; contributors: string | null } {
    let gitLog: string | null = null;
    let gitContributors: string | null = null;

    if (!existsSync(join(projectRoot, '.git'))) {
      return { log: null, contributors: null };
    }

    try {
      gitLog = execSync('git log --oneline --no-decorate -30 2>/dev/null', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 10_000,
        shell: '/bin/sh',
      }).trim();
    } catch {
      // No commits yet or not a git repo
    }

    try {
      gitContributors = execSync('git shortlog -sn --no-merges 2>/dev/null | head -10', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 10_000,
        shell: '/bin/sh',
      }).trim();
    } catch {
      // No commits yet or not a git repo
    }

    return { log: gitLog || null, contributors: gitContributors || null };
  }

  generateDirectoryTree(projectRoot: string, maxDepth: number = 3): string {
    const IGNORE = new Set([
      'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
      'target', 'vendor', '.venv', 'venv', '.idea', '.vscode',
      'coverage', '.nyc_output', '.pytest_cache', '.mypy_cache',
      '.turbo', '.cache', '.parcel-cache',
    ]);

    const lines: string[] = [];
    let entryCount = 0;
    const MAX_ENTRIES = 200;

    function walk(dir: string, prefix: string, depth: number): void {
      if (depth > maxDepth || entryCount >= MAX_ENTRIES) return;

      let entries: string[];
      try {
        entries = readdirSync(dir).sort();
      } catch {
        return;
      }

      // Filter out ignored directories
      entries = entries.filter(e => !IGNORE.has(e));

      for (let i = 0; i < entries.length; i++) {
        if (entryCount >= MAX_ENTRIES) break;
        const entry = entries[i];
        const fullPath = join(dir, entry);
        const isLast = i === entries.length - 1;
        const connector = isLast ? '\\-- ' : '|-- ';
        const childPrefix = isLast ? '    ' : '|   ';

        lines.push(`${prefix}${connector}${entry}`);
        entryCount++;

        try {
          if (statSync(fullPath).isDirectory()) {
            walk(fullPath, prefix + childPrefix, depth + 1);
          }
        } catch {
          // Skip
        }
      }
    }

    lines.push('.');
    walk(projectRoot, '', 1);
    return lines.join('\n');
  }

  private formatSignals(signals: ProjectSignals): string {
    const lines: string[] = [];

    if (signals.language.length > 0) {
      lines.push(`Languages: ${signals.language.map((l) => l.name).join(', ')}`);
    }
    if (signals.framework.length > 0) {
      lines.push(`Frameworks: ${signals.framework.map((f) => `${f.name}${f.version ? ' ' + f.version : ''}`).join(', ')}`);
    }
    if (signals.packageManager) {
      lines.push(`Package Manager: ${signals.packageManager}`);
    }
    if (signals.structure.length > 0) {
      lines.push(`Directories: ${signals.structure.map((s) => s.directory).join(', ')}`);
    }
    if (signals.dependencies.length > 0) {
      const prod = signals.dependencies.filter((d) => !d.dev);
      lines.push(`Key deps: ${prod.slice(0, 15).map((d) => d.name).join(', ')}`);
    }
    if (signals.configFiles.length > 0) {
      lines.push(`Config: ${signals.configFiles.map((c) => c.path).join(', ')}`);
    }
    if (signals.scripts.length > 0) {
      lines.push(`Scripts: ${signals.scripts.map((s) => s.name).join(', ')}`);
    }

    return lines.join('\n');
  }

  parseResponse(response: string): AnalyzedMemory[] {
    // Try to extract JSON from the response (Claude may wrap it in markdown)
    let jsonStr = response;

    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1];
    }

    // Try to find array brackets
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (item: unknown): item is AnalyzedMemory =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as AnalyzedMemory).content === 'string' &&
          typeof (item as AnalyzedMemory).tier === 'string' &&
          ['long-term', 'operational', 'short-term'].includes((item as AnalyzedMemory).tier) &&
          typeof (item as AnalyzedMemory).importance === 'number' &&
          Array.isArray((item as AnalyzedMemory).tags),
      );
    } catch {
      return [];
    }
  }
}

function isDirectory(fullPath: string): boolean {
  try {
    return statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(fullPath: string): boolean {
  try {
    return statSync(fullPath).isFile();
  } catch {
    return false;
  }
}

function log(msg: string): void {
  if (process.env.CTXCORE_DEBUG) {
    process.stderr.write(`[ctxcore] ${msg}\n`);
  }
}
