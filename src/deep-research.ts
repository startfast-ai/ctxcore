import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { IClaudeCliRunner, IMemoryStore, Memory, ProjectSignals } from './types.js';
import { ProjectAnalyzer } from './project-analyzer.js';

export interface ResearchFinding {
  content: string;
  category: 'security' | 'architecture' | 'performance' | 'reliability' | 'maintainability' | 'testing' | 'dependency' | 'insight';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  tier: 'long-term' | 'operational' | 'short-term';
  importance: number;
  tags: string[];
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface ResearchReport {
  findings: ResearchFinding[];
  memories: Memory[];
  summary: {
    total: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
    topIssues: string[];
  };
  duration: number;
}

interface SourceFile {
  path: string;
  content: string;
  language: string;
}

const SOURCE_EXTENSIONS: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby',
  '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.c': 'C',
  '.cpp': 'C++', '.h': 'C', '.hpp': 'C++', '.cs': 'C#',
  '.php': 'PHP', '.ex': 'Elixir', '.exs': 'Elixir', '.dart': 'Dart',
  '.vue': 'Vue', '.svelte': 'Svelte',
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  'target', 'vendor', '.venv', 'venv', '.idea', '.vscode',
  'coverage', '.nyc_output', '.ctxcore', '.memory.db',
]);

const MAX_FILE_SIZE = 8000;
const MAX_TOTAL_SOURCE = 40000;

/**
 * Deep research engine — runs multi-pass Claude CLI analysis
 * to find weaknesses, security problems, and deep insights.
 */
export class DeepResearcher {
  private analyzer: ProjectAnalyzer;

  constructor(private cliRunner: IClaudeCliRunner) {
    this.analyzer = new ProjectAnalyzer(cliRunner);
  }

  async research(
    projectRoot: string,
    signals: ProjectSignals,
    store: IMemoryStore,
    options?: {
      focus?: string[];
      maxPasses?: number;
      onProgress?: (phase: string, detail?: string | null, findings?: ResearchFinding[]) => void;
    },
  ): Promise<ResearchReport> {
    const startTime = Date.now();
    const onProgress = options?.onProgress ?? (() => {});
    const allFindings: ResearchFinding[] = [];
    const allMemories: Memory[] = [];

    // Gather source files
    onProgress('gathering', 'Collecting source files...');
    const sourceFiles = this.gatherSourceFiles(projectRoot);
    const gitInfo = this.gatherGitInfo(projectRoot);
    const dirTree = this.analyzer.generateDirectoryTree(projectRoot);
    onProgress('gathered', `Found ${sourceFiles.length} source files to analyze`);

    // Pass 1: Security audit
    onProgress('security', 'Pass 1/5 — Security audit: scanning for vulnerabilities...');
    const securityFindings = await this.runPass(
      sourceFiles, signals, dirTree, gitInfo,
      this.buildSecurityPrompt(sourceFiles, signals, dirTree),
    );
    allFindings.push(...securityFindings);
    onProgress('security-done', null, securityFindings);

    // Pass 2: Architecture weaknesses
    onProgress('architecture', 'Pass 2/5 — Architecture review: checking structural integrity...');
    const archFindings = await this.runPass(
      sourceFiles, signals, dirTree, gitInfo,
      this.buildArchitecturePrompt(sourceFiles, signals, dirTree, gitInfo),
    );
    allFindings.push(...archFindings);
    onProgress('architecture-done', null, archFindings);

    // Pass 3: Code quality + reliability
    onProgress('quality', 'Pass 3/5 — Code quality: analyzing error handling & reliability...');
    const qualityFindings = await this.runPass(
      sourceFiles, signals, dirTree, gitInfo,
      this.buildQualityPrompt(sourceFiles, signals, dirTree),
    );
    allFindings.push(...qualityFindings);
    onProgress('quality-done', null, qualityFindings);

    // Pass 4: Dependencies + supply chain
    onProgress('dependencies', 'Pass 4/5 — Supply chain: auditing dependencies...');
    const depFindings = await this.runPass(
      sourceFiles, signals, dirTree, gitInfo,
      this.buildDependencyPrompt(signals),
    );
    allFindings.push(...depFindings);
    onProgress('dependencies-done', null, depFindings);

    // Pass 5: Deep insights (patterns, hidden assumptions, technical debt)
    onProgress('insights', 'Pass 5/5 — Deep insights: extracting hidden patterns...');
    const insightFindings = await this.runPass(
      sourceFiles, signals, dirTree, gitInfo,
      this.buildInsightPrompt(sourceFiles, signals, dirTree, gitInfo),
    );
    allFindings.push(...insightFindings);
    onProgress('insights-done', null, insightFindings);

    // Store findings as memories
    onProgress('storing', `Saving ${allFindings.length} findings as memories...`);
    for (const finding of allFindings) {
      const tags = [
        'deep-research',
        finding.category,
        `severity:${finding.severity}`,
        ...finding.tags,
      ];

      const content = this.formatFindingContent(finding);

      const mem = store.create({
        content,
        tier: finding.tier,
        importance: finding.importance,
        tags,
        metadata: {
          source: 'deep-research',
          category: finding.category,
          severity: finding.severity,
          file: finding.file,
          line: finding.line,
          analyzedAt: new Date().toISOString(),
        },
      });
      allMemories.push(mem);
    }

    // Create connections between related findings
    this.createFindingConnections(allFindings, allMemories, store);

    const duration = Date.now() - startTime;

    return {
      findings: allFindings,
      memories: allMemories,
      summary: this.buildSummary(allFindings),
      duration,
    };
  }

  private async runPass(
    sourceFiles: SourceFile[],
    signals: ProjectSignals,
    dirTree: string,
    gitInfo: { log: string | null; hotspots: string | null },
    prompt: string,
  ): Promise<ResearchFinding[]> {
    let response: string;
    try {
      response = await this.cliRunner.run(prompt, { timeout: 180_000 });
    } catch {
      return [];
    }

    return this.parseFindings(response);
  }

  // ── Prompt builders ──

  private buildSecurityPrompt(files: SourceFile[], signals: ProjectSignals, dirTree: string): string {
    const sourceContext = this.formatSourceContext(files);
    const deps = signals.dependencies.filter(d => !d.dev).map(d => d.name).join(', ');

    return `You are a senior security researcher performing a deep security audit of a software project.

DIRECTORY STRUCTURE:
${dirTree}

DEPENDENCIES: ${deps || 'none detected'}

SOURCE CODE:
${sourceContext}

Analyze for ALL of these security concerns:

1. **Injection vulnerabilities**: SQL injection, command injection, XSS, template injection, LDAP injection, path traversal
2. **Authentication/Authorization**: hardcoded credentials, weak auth, missing auth checks, privilege escalation, insecure session management
3. **Data exposure**: secrets in code, PII leaks, overly verbose errors, sensitive data in logs, unencrypted storage
4. **Input validation**: missing validation, type coercion issues, buffer overflows, integer overflows
5. **Dependency risks**: known vulnerable patterns, unsafe deserialization, prototype pollution
6. **Cryptographic issues**: weak algorithms, hardcoded keys, improper random generation
7. **Race conditions**: TOCTOU, unprotected shared state, deadlocks
8. **Configuration**: debug mode in production, overly permissive CORS, insecure defaults

For each finding, assess real exploitability — not just theoretical risk.

Respond with ONLY a valid JSON array:
[
  {
    "content": "Specific description of the security issue",
    "category": "security",
    "severity": "critical|high|medium|low|info",
    "tier": "long-term",
    "importance": 0.9,
    "tags": ["relevant", "tags"],
    "file": "path/to/file.ts",
    "line": 42,
    "suggestion": "How to fix this"
  }
]

Be specific. Include file paths and line numbers when possible. Do not report theoretical issues that cannot happen in this codebase.`;
  }

  private buildArchitecturePrompt(files: SourceFile[], signals: ProjectSignals, dirTree: string, gitInfo: { log: string | null; hotspots: string | null }): string {
    const sourceContext = this.formatSourceContext(files);

    return `You are a principal architect reviewing a codebase for structural weaknesses and design problems.

DIRECTORY STRUCTURE:
${dirTree}

${gitInfo.hotspots ? `GIT CHANGE HOTSPOTS (most frequently changed files):\n${gitInfo.hotspots}\n` : ''}
${gitInfo.log ? `RECENT COMMITS:\n${gitInfo.log}\n` : ''}

SOURCE CODE:
${sourceContext}

Analyze for:

1. **Coupling**: tight coupling between modules, circular dependencies, god objects/classes
2. **Abstraction leaks**: implementation details exposed across boundaries, wrong layer doing wrong work
3. **Missing boundaries**: no clear separation between domain/infrastructure/presentation
4. **Scalability bottlenecks**: single points of failure, non-horizontal patterns, unbounded operations
5. **Error handling gaps**: swallowed errors, inconsistent error strategies, missing fallbacks
6. **State management**: global mutable state, implicit dependencies, unclear ownership
7. **Technical debt**: TODO/FIXME/HACK comments, dead code, duplicated logic, outdated patterns
8. **Missing patterns**: no retry logic where needed, no circuit breakers, no graceful degradation

Respond with ONLY a valid JSON array:
[
  {
    "content": "Specific architectural weakness description",
    "category": "architecture",
    "severity": "critical|high|medium|low|info",
    "tier": "long-term",
    "importance": 0.7,
    "tags": ["relevant", "tags"],
    "file": "path/to/file.ts",
    "suggestion": "Recommended approach"
  }
]

Focus on real, actionable issues. Not style preferences.`;
  }

  private buildQualityPrompt(files: SourceFile[], signals: ProjectSignals, dirTree: string): string {
    const sourceContext = this.formatSourceContext(files);

    return `You are a staff engineer performing a deep code quality and reliability review.

DIRECTORY STRUCTURE:
${dirTree}

SOURCE CODE:
${sourceContext}

Analyze for:

1. **Error handling**: unhandled promise rejections, empty catch blocks, errors losing context, missing error boundaries
2. **Resource management**: unclosed connections/handles/streams, memory leaks, missing cleanup
3. **Concurrency bugs**: race conditions, unprotected shared state, deadlock potential
4. **Edge cases**: off-by-one errors, null/undefined handling, empty collection handling, boundary conditions
5. **Type safety**: any casts, unsafe type assertions, missing null checks, implicit type coercion
6. **Testing gaps**: untested critical paths, missing edge case tests, brittle test patterns
7. **Performance**: N+1 queries, unbounded loops, unnecessary allocations, blocking operations in async paths
8. **Reliability**: missing timeouts, no retry logic, no circuit breakers, cascading failure potential

Respond with ONLY a valid JSON array:
[
  {
    "content": "Specific quality/reliability issue",
    "category": "reliability|performance|testing|maintainability",
    "severity": "critical|high|medium|low|info",
    "tier": "operational",
    "importance": 0.6,
    "tags": ["relevant", "tags"],
    "file": "path/to/file.ts",
    "line": 42,
    "suggestion": "How to fix"
  }
]

Only report real issues. No nitpicks.`;
  }

  private buildDependencyPrompt(signals: ProjectSignals): string {
    const deps = signals.dependencies.map(d =>
      `${d.name}${d.version ? '@' + d.version : ''} (${d.dev ? 'dev' : 'prod'}) [${d.source}]`
    ).join('\n  ');

    return `You are a supply chain security specialist reviewing project dependencies.

DEPENDENCIES:
  ${deps || '(none detected)'}

Analyze for:

1. **Known risky packages**: packages with history of supply chain attacks, typosquatting candidates, unmaintained packages
2. **Unnecessary dependencies**: packages that could be replaced with built-in functionality, packages that add huge transitive trees
3. **Version pinning**: unpinned versions, overly broad ranges, missing lock file implications
4. **Outdated patterns**: deprecated packages with better modern alternatives
5. **License risks**: copyleft in proprietary projects, incompatible licenses
6. **Transitive risks**: known issues in common transitive dependencies

Respond with ONLY a valid JSON array:
[
  {
    "content": "Specific dependency concern",
    "category": "dependency",
    "severity": "critical|high|medium|low|info",
    "tier": "operational",
    "importance": 0.5,
    "tags": ["dep-name", "supply-chain"],
    "suggestion": "Recommended action"
  }
]

Only flag real risks, not theoretical concerns.`;
  }

  private buildInsightPrompt(files: SourceFile[], signals: ProjectSignals, dirTree: string, gitInfo: { log: string | null; hotspots: string | null }): string {
    const sourceContext = this.formatSourceContext(files);

    return `You are an expert consultant extracting deep, non-obvious insights from a codebase.

DIRECTORY STRUCTURE:
${dirTree}

${gitInfo.hotspots ? `GIT CHANGE HOTSPOTS:\n${gitInfo.hotspots}\n` : ''}
${gitInfo.log ? `RECENT COMMITS:\n${gitInfo.log}\n` : ''}

SOURCE CODE:
${sourceContext}

Extract deep insights that would take a human weeks to discover:

1. **Hidden assumptions**: implicit contracts between modules, undocumented invariants, assumed ordering
2. **Evolution patterns**: where is the code heading? what areas are being actively reworked? what was abandoned?
3. **Domain knowledge**: business rules embedded in code, domain-specific patterns, non-obvious constraints
4. **Recurring patterns**: repeated solutions to the same problem (indicating a missing abstraction), copy-paste patterns
5. **Knowledge risks**: areas only one person understands (bus factor), undocumented critical paths
6. **Technical moats**: clever solutions worth preserving, non-obvious optimizations, hard-won patterns
7. **Strategic observations**: what would break if requirements changed, where is flexibility vs rigidity

Respond with ONLY a valid JSON array:
[
  {
    "content": "Deep insight or observation",
    "category": "insight",
    "severity": "info|low|medium|high",
    "tier": "long-term",
    "importance": 0.7,
    "tags": ["relevant", "tags"],
    "file": "path/to/file.ts",
    "suggestion": "Implication or recommendation"
  }
]

Be specific and actionable. Every insight should teach something that is not obvious from reading the code casually.`;
  }

  // ── Source file handling ──

  private gatherSourceFiles(projectRoot: string): SourceFile[] {
    const files: SourceFile[] = [];
    let totalSize = 0;

    const walk = (dir: string): void => {
      if (totalSize >= MAX_TOTAL_SOURCE) return;

      let entries: string[];
      try {
        entries = readdirSync(dir).sort();
      } catch { return; }

      for (const entry of entries) {
        if (totalSize >= MAX_TOTAL_SOURCE) break;
        if (entry.startsWith('.')) continue;
        if (IGNORE_DIRS.has(entry)) continue;

        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);

          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (stat.isFile()) {
            const ext = extname(entry);
            const language = SOURCE_EXTENSIONS[ext];
            if (!language) continue;
            if (stat.size > MAX_FILE_SIZE * 2) continue;

            let content = readFileSync(fullPath, 'utf-8');
            if (content.length > MAX_FILE_SIZE) {
              content = content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)';
            }

            files.push({
              path: relative(projectRoot, fullPath),
              content,
              language,
            });
            totalSize += content.length;
          }
        } catch { continue; }
      }
    };

    walk(projectRoot);
    return files;
  }

  private formatSourceContext(files: SourceFile[]): string {
    if (files.length === 0) return '(no source files found)';

    return files.map(f =>
      `--- ${f.path} (${f.language}) ---\n${f.content}`
    ).join('\n\n');
  }

  private gatherGitInfo(projectRoot: string): { log: string | null; hotspots: string | null } {
    if (!existsSync(join(projectRoot, '.git'))) {
      return { log: null, hotspots: null };
    }

    let log: string | null = null;
    let hotspots: string | null = null;

    try {
      log = execSync('git log --oneline --no-decorate -20 2>/dev/null', {
        cwd: projectRoot, encoding: 'utf-8', timeout: 10_000, shell: '/bin/sh',
      }).trim() || null;
    } catch { /* no commits yet or not a git repo */ }

    try {
      hotspots = execSync(
        "git log --pretty=format: --name-only -100 2>/dev/null | sort | uniq -c | sort -rn | head -20",
        { cwd: projectRoot, encoding: 'utf-8', timeout: 10_000, shell: '/bin/sh' },
      ).trim() || null;
    } catch { /* no commits yet or not a git repo */ }

    return { log, hotspots };
  }

  // ── Response parsing ──

  private parseFindings(response: string): ResearchFinding[] {
    let jsonStr = response;

    const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1];

    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) jsonStr = arrayMatch[0];

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter((item: unknown): item is ResearchFinding => {
        if (typeof item !== 'object' || item === null) return false;
        const f = item as Record<string, unknown>;
        return (
          typeof f.content === 'string' &&
          typeof f.category === 'string' &&
          typeof f.severity === 'string' &&
          typeof f.importance === 'number'
        );
      }).map(f => ({
        ...f,
        tier: f.tier ?? 'operational',
        tags: Array.isArray(f.tags) ? f.tags : [],
        importance: Math.max(0, Math.min(1, f.importance)),
      }));
    } catch {
      return [];
    }
  }

  private formatFindingContent(finding: ResearchFinding): string {
    const parts = [finding.content];
    if (finding.file) {
      parts.push(`File: ${finding.file}${finding.line ? ':' + finding.line : ''}`);
    }
    if (finding.suggestion) {
      parts.push(`Fix: ${finding.suggestion}`);
    }
    return parts.join('\n');
  }

  private createFindingConnections(findings: ResearchFinding[], memories: Memory[], store: IMemoryStore): void {
    // Connect findings in the same file
    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        if (findings[i].file && findings[i].file === findings[j].file) {
          try {
            store.createConnection({
              sourceId: memories[i].id,
              targetId: memories[j].id,
              type: 'similar',
              strength: 0.6,
            });
          } catch { /* skip duplicates */ }
        }
      }
    }

    // Connect findings in the same category with high severity
    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        if (
          findings[i].category === findings[j].category &&
          ['critical', 'high'].includes(findings[i].severity) &&
          ['critical', 'high'].includes(findings[j].severity)
        ) {
          try {
            store.createConnection({
              sourceId: memories[i].id,
              targetId: memories[j].id,
              type: 'supports',
              strength: 0.5,
            });
          } catch { /* skip duplicates */ }
        }
      }
    }
  }

  private buildSummary(findings: ResearchFinding[]): ResearchReport['summary'] {
    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    }

    const topIssues = findings
      .filter(f => ['critical', 'high'].includes(f.severity))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5)
      .map(f => `[${f.severity.toUpperCase()}] ${f.content.split('\n')[0]}`);

    return { total: findings.length, bySeverity, byCategory, topIssues };
  }
}
