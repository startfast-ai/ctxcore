import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Ctxcore } from '../ctxcore.js';
import { DeepResearcher } from '../deep-research.js';
import type { ResearchFinding, ResearchReport } from '../deep-research.js';
import { ProjectScanner } from '../project-scanner.js';
import { ClaudeCliRunner, detectClaudeCli, verifyClaudeCli } from '../claude-cli.js';
import { Progress } from '../utils/progress.js';

import {
  printHeader, printDivider, printKeyValue,
  severityBadge as sevBadge,
  DIM, BOLD, RESET, RED, GREEN, YELLOW, CYAN, MAGENTA,
  BG_RED, BG_GREEN,
} from '../utils/ui.js';

const SEVERITY_BADGE: Record<string, string> = {
  critical: sevBadge('critical'),
  high:     sevBadge('high'),
  medium:   sevBadge('medium'),
  low:      sevBadge('low'),
  info:     sevBadge('info'),
};

const CATEGORY_LABEL: Record<string, string> = {
  security:        `${RED}🔒 SECURITY${RESET}`,
  architecture:    `${MAGENTA}🏗  ARCHITECTURE${RESET}`,
  performance:     `${YELLOW}⚡ PERFORMANCE${RESET}`,
  reliability:     `${CYAN}🛡  RELIABILITY${RESET}`,
  maintainability: `${GREEN}🔧 MAINTAINABILITY${RESET}`,
  testing:         `${YELLOW}🧪 TESTING${RESET}`,
  dependency:      `${RED}📦 DEPENDENCIES${RESET}`,
  insight:         `${MAGENTA}💡 INSIGHTS${RESET}`,
};

const PASS_LABELS: Record<string, string> = {
  security:     `${RED}🔒 Security Audit${RESET}`,
  architecture: `${MAGENTA}🏗  Architecture Review${RESET}`,
  quality:      `${CYAN}🛡  Code Quality & Reliability${RESET}`,
  dependencies: `${YELLOW}📦 Supply Chain Audit${RESET}`,
  insights:     `${MAGENTA}💡 Deep Insight Extraction${RESET}`,
};

function severityColor(s: string): string {
  switch (s) {
    case 'critical': return RED;
    case 'high': return RED;
    case 'medium': return YELLOW;
    case 'low': return CYAN;
    default: return DIM;
  }
}

function truncate(s: string, max: number): string {
  const first = s.split('\n')[0];
  return first.length > max ? first.slice(0, max - 1) + '…' : first;
}

export function registerResearchCommand(program: Command): void {
  program
    .command('research')
    .description('Deep research — analyze project for weaknesses, security issues, and insights using Claude')
    .option('--focus <areas...>', 'Focus on specific areas (security, architecture, quality, dependencies, insights)')
    .option('--model <model>', 'Claude model to use (haiku, sonnet, opus)', 'sonnet')
    .option('--json', 'Output raw JSON instead of formatted report')
    .option('--no-tasks', 'Skip creating tasks from findings')
    .option('--no-spec', 'Skip saving spec document')
    .action(async (opts: { focus?: string[]; model: string; json?: boolean; tasks?: boolean; spec?: boolean }) => {
      const projectRoot = process.cwd();
      const projectName = basename(projectRoot);

      // Check for Claude CLI
      const claudePath = detectClaudeCli();
      if (!claudePath || !verifyClaudeCli(claudePath)) {
        console.error(`${RED}Deep research requires Claude CLI.${RESET}`);
        console.error(`Install: https://docs.anthropic.com/en/docs/claude-cli`);
        process.exit(1);
      }

      const cliRunner = new ClaudeCliRunner(claudePath, opts.model);

      let ctx: Ctxcore | null = null;
      const progress = new Progress();
      let passNumber = 0;

      try {
        ctx = await Ctxcore.create(projectRoot);
        const scanner = new ProjectScanner();
        const researcher = new DeepResearcher(cliRunner);

        if (!opts.json) {
          printHeader('Deep Research');
          printKeyValue('Project', projectName);
          printKeyValue('Model', opts.model);
          printKeyValue('Passes', '5 (security, architecture, quality, deps, insights)');
          console.log();
        }

        // Scan project
        progress.start('Scanning project structure...');
        const signals = await scanner.scan(projectRoot);
        progress.succeed('Project scanned');

        if (!opts.json) {
          const langs = signals.language.map(l => l.name).join(', ') || 'unknown';
          const frameworks = signals.framework.map(f => f.name).join(', ') || 'none';
          const depCount = signals.dependencies.filter(d => !d.dev).length;
          const devCount = signals.dependencies.filter(d => d.dev).length;
          console.log();
          console.log(`  ${DIM}Languages${RESET}     ${langs}`);
          console.log(`  ${DIM}Frameworks${RESET}    ${frameworks}`);
          console.log(`  ${DIM}Dependencies${RESET}  ${depCount} prod + ${devCount} dev`);
          console.log();
          console.log(`  ${DIM}${'─'.repeat(50)}${RESET}`);
          console.log();
        }

        // Run deep research with live output
        const report = await researcher.research(projectRoot, signals, ctx.memoryStore, {
          focus: opts.focus,
          onProgress: (phase, detail, findings) => {
            if (opts.json) return;

            // Phase starting — show spinner
            if (!phase.endsWith('-done') && phase !== 'gathered') {
              const label = PASS_LABELS[phase];
              if (label) {
                passNumber++;
                progress.succeed(detail ?? phase);
                console.log();
                console.log(`  ${label}`);
                progress.start(`  Analyzing...`);
              } else if (phase === 'storing') {
                progress.succeed('All passes complete');
                console.log();
                console.log(`  ${DIM}${'─'.repeat(50)}${RESET}`);
                console.log();
                progress.start(detail ?? 'Saving...');
              } else {
                progress.start(detail ?? phase);
              }
              return;
            }

            // Phase done — show findings preview
            if (phase === 'gathered') {
              progress.succeed(detail ?? 'Files collected');
              return;
            }

            if (findings && findings.length > 0) {
              progress.succeed(`Found ${findings.length} issue${findings.length === 1 ? '' : 's'}`);
              console.log();

              // Show up to 3 most severe findings as preview
              const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
              const sorted = [...findings].sort((a, b) =>
                severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
              );
              const preview = sorted.slice(0, 3);

              for (const f of preview) {
                const badge = SEVERITY_BADGE[f.severity] ?? f.severity;
                const text = truncate(f.content, 70);
                console.log(`    ${badge} ${text}`);
                if (f.file) {
                  console.log(`    ${DIM}       ${f.file}${f.line ? ':' + f.line : ''}${RESET}`);
                }
              }

              if (findings.length > 3) {
                console.log(`    ${DIM}       ... and ${findings.length - 3} more${RESET}`);
              }
              console.log();
            } else {
              progress.succeed('Clean — no issues found');
              console.log();
            }
          },
        });

        progress.succeed(`${report.findings.length} findings saved to memory`);

        // Embed findings
        if (!opts.json) {
          console.log();
          progress.start('Generating embeddings...');
          let embedded = 0;
          for (const mem of report.memories) {
            try {
              const emb = await ctx.embeddingClient.embed(mem.content);
              ctx.embeddingStore.store(mem.id, emb);
              embedded++;
            } catch { break; }
          }
          if (embedded > 0) {
            progress.succeed(`Embedded ${embedded}/${report.memories.length} findings for semantic search`);
          } else {
            progress.succeed('Skipped embeddings (Ollama unavailable)');
          }
        }

        // Create tasks
        let tasksCreated = 0;
        if (opts.tasks !== false && report.findings.length > 0) {
          console.log();
          progress.start('Creating tasks from actionable findings...');

          ctx.taskStore.seedDefaultColumns(projectRoot);
          const backlogCol = ctx.db
            .prepare("SELECT id FROM kanban_columns WHERE project_id = ? AND title = 'Backlog' LIMIT 1")
            .get(projectRoot) as { id: string } | undefined;

          const actionable = report.findings.filter(f =>
            ['critical', 'high', 'medium'].includes(f.severity)
          );

          for (const finding of actionable) {
            const priority = finding.severity === 'critical' ? 'critical' as const
              : finding.severity === 'high' ? 'high' as const
              : 'medium' as const;

            const title = `[${finding.category}] ${truncate(finding.content, 100)}`;
            const description = [
              `**Severity:** ${finding.severity}`,
              `**Category:** ${finding.category}`,
              finding.file ? `**File:** ${finding.file}${finding.line ? ':' + finding.line : ''}` : '',
              '',
              finding.content,
              finding.suggestion ? `\n**Suggested fix:** ${finding.suggestion}` : '',
            ].filter(Boolean).join('\n');

            ctx.taskStore.create({
              projectId: projectRoot,
              title,
              description,
              priority,
              createdBy: 'ctxcore-research',
              tags: ['deep-research', finding.category, `severity:${finding.severity}`],
              columnId: backlogCol?.id,
            });
            tasksCreated++;
          }

          progress.succeed(`Created ${tasksCreated} tasks in Backlog`);
        }

        // Save spec document
        let specPath: string | null = null;
        if (opts.spec !== false && report.findings.length > 0) {
          console.log();
          progress.start('Writing research report...');

          const timestamp = new Date().toISOString().slice(0, 10);
          const specContent = buildSpecDocument(report, projectRoot, timestamp);

          const docsDir = join(projectRoot, 'docs', 'specifications');
          mkdirSync(docsDir, { recursive: true });
          specPath = join(docsDir, `research-${timestamp}.md`);
          writeFileSync(specPath, specContent);

          try {
            ctx.specStore.create({
              title: `Deep Research Report — ${timestamp}`,
              content: specContent,
              tags: ['deep-research', 'audit', timestamp],
              status: 'approved',
            });
          } catch { /* spec store may not be available */ }

          progress.succeed(`Report saved to docs/specifications/research-${timestamp}.md`);
        }

        // Final output
        if (opts.json) {
          console.log(JSON.stringify({ ...report, tasksCreated, specPath }, null, 2));
        } else {
          printReport(report, tasksCreated, specPath);
        }
      } catch (err) {
        progress.fail(`Research failed: ${(err as Error).message}`);
        process.exit(1);
      } finally {
        ctx?.close();
      }
    });
}

// ── Report Printing ──

function printReport(report: ResearchReport, tasksCreated: number, specPath: string | null): void {
  const { findings, summary, duration } = report;

  printHeader('Results');

  if (findings.length === 0) {
    console.log(`  ${BG_GREEN} ALL CLEAR ${RESET}  No issues found.`);
    console.log();
    return;
  }

  // Severity bar chart
  const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
  const barColors: Record<string, string> = {
    critical: BG_RED, high: RED, medium: YELLOW, low: CYAN, info: DIM,
  };

  const maxCount = Math.max(...Object.values(summary.bySeverity));

  for (const sev of severityOrder) {
    const count = summary.bySeverity[sev] ?? 0;
    if (count === 0) continue;
    const barLen = Math.max(1, Math.round((count / maxCount) * 20));
    const color = barColors[sev] ?? DIM;
    const bar = color + '█'.repeat(barLen) + RESET;
    console.log(`  ${sev.padEnd(9)} ${bar} ${count}`);
  }
  console.log();

  // Category breakdown with icons
  const grouped = new Map<string, ResearchFinding[]>();
  for (const f of findings) {
    const group = grouped.get(f.category) ?? [];
    group.push(f);
    grouped.set(f.category, group);
  }

  for (const [category, items] of grouped) {
    const label = CATEGORY_LABEL[category] ?? `${BOLD}${category.toUpperCase()}${RESET}`;
    const crits = items.filter(i => i.severity === 'critical').length;
    const highs = items.filter(i => i.severity === 'high').length;

    let countLabel = `${items.length} finding${items.length === 1 ? '' : 's'}`;
    if (crits > 0) countLabel += ` ${RED}(${crits} critical!)${RESET}`;
    else if (highs > 0) countLabel += ` ${YELLOW}(${highs} high)${RESET}`;

    console.log(`  ${label}  —  ${countLabel}`);
    console.log();

    const sorted = [...items].sort((a, b) =>
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
    );

    for (const item of sorted) {
      const badge = SEVERITY_BADGE[item.severity] ?? item.severity;
      const text = truncate(item.content, 72);
      console.log(`    ${badge} ${text}`);

      if (item.file) {
        console.log(`           ${DIM}${item.file}${item.line ? ':' + item.line : ''}${RESET}`);
      }
      if (item.suggestion) {
        console.log(`           ${GREEN}→ ${item.suggestion}${RESET}`);
      }
      console.log();
    }
  }

  printDivider();
  console.log(`  ${BOLD}Total${RESET}       ${findings.length} findings across ${grouped.size} categories`);
  console.log(`  ${BOLD}Memories${RESET}    ${report.memories.length} stored for future recall`);
  if (tasksCreated > 0) {
    console.log(`  ${BOLD}Tasks${RESET}       ${tasksCreated} created → ${CYAN}ctxcore task list${RESET}`);
  }
  if (specPath) {
    console.log(`  ${BOLD}Report${RESET}      ${specPath}`);
  }
  console.log(`  ${BOLD}Duration${RESET}    ${(duration / 1000).toFixed(1)}s`);
  console.log();
  console.log(`  ${DIM}Query findings anytime: ${CYAN}ctxcore search "security"${RESET}`);
  console.log();
}

// ── Spec Document Builder ──

function buildSpecDocument(report: ResearchReport, projectRoot: string, date: string): string {
  const lines: string[] = [];

  lines.push(`# Deep Research Report`);
  lines.push('');
  lines.push(`**Project:** ${basename(projectRoot)}`);
  lines.push(`**Date:** ${date}`);
  lines.push(`**Total Findings:** ${report.summary.total}`);
  lines.push('');

  // Severity overview
  lines.push('## Severity Overview');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|----------|-------|');
  for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
    const count = report.summary.bySeverity[sev];
    if (count) lines.push(`| ${sev} | ${count} |`);
  }
  lines.push('');

  // Category overview
  lines.push('## Category Overview');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|----------|-------|');
  for (const [category, count] of Object.entries(report.summary.byCategory)) {
    lines.push(`| ${category} | ${count} |`);
  }
  lines.push('');

  // Top issues
  if (report.summary.topIssues.length > 0) {
    lines.push('## Top Issues');
    lines.push('');
    for (const issue of report.summary.topIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  // Group findings by category
  const grouped = new Map<string, ResearchFinding[]>();
  for (const f of report.findings) {
    const group = grouped.get(f.category) ?? [];
    group.push(f);
    grouped.set(f.category, group);
  }

  for (const [category, items] of grouped) {
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    lines.push('');

    const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
    items.sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));

    for (const item of items) {
      const badge = `**[${item.severity.toUpperCase()}]**`;
      lines.push(`### ${badge} ${item.content.split('\n')[0]}`);
      lines.push('');

      if (item.file) {
        lines.push(`**File:** \`${item.file}${item.line ? ':' + item.line : ''}\``);
      }

      const contentLines = item.content.split('\n');
      if (contentLines.length > 1) {
        lines.push('');
        lines.push(contentLines.slice(1).join('\n').trim());
      }

      if (item.suggestion) {
        lines.push('');
        lines.push(`> **Fix:** ${item.suggestion}`);
      }

      if (item.tags.length > 0) {
        lines.push('');
        lines.push(`*Tags: ${item.tags.join(', ')}*`);
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  lines.push(`*Generated by ctxcore research on ${new Date().toISOString()}*`);
  lines.push('');

  return lines.join('\n');
}
