import type { Command } from 'commander';
import { execSync } from 'node:child_process';
import { Ctxcore } from '../ctxcore.js';

function isClaudeCliAvailable(): boolean {
  try {
    execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function callClaude(prompt: string): string {
  const result = execSync(`claude -p "${prompt.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return result.trim();
}

export function registerAskCommand(program: Command): void {
  program
    .command('ask')
    .description('Ask a natural language question over your project knowledge base')
    .argument('<question>', 'The question to ask')
    .option('-n, --limit <n>', 'Max memories to include as context', parseInt, 5)
    .action(async (question: string, opts: { limit: number }) => {
      let ctx: Ctxcore | null = null;
      try {
        ctx = await Ctxcore.create(process.cwd());

        // Search for relevant memories
        const results = await ctx.retrievalEngine.search(question, {
          limit: opts.limit,
        });

        if (results.length === 0) {
          console.log('No relevant memories found for your question.');
          console.log('Try storing some memories first with `ctxcore store`.');
          ctx.close();
          return;
        }

        // Format memories as context
        const contextLines: string[] = ['Relevant project memories:\n'];
        for (const r of results) {
          const tierBadge = `[${r.memory.tier}]`;
          const scoreBadge = `(relevance: ${r.score.toFixed(2)})`;
          contextLines.push(`${tierBadge} ${scoreBadge} ${r.memory.content}`);
          if (r.memory.tags.length > 0) {
            contextLines.push(`  tags: ${r.memory.tags.join(', ')}`);
          }
        }

        const context = contextLines.join('\n');

        // Check if Claude CLI is available
        if (!isClaudeCliAvailable()) {
          console.log('Claude CLI not available. Showing relevant memories instead:\n');
          console.log(context);
          console.log('\nInstall Claude CLI to get AI-powered answers: https://docs.anthropic.com/en/docs/claude-cli');
          ctx.close();
          return;
        }

        // Build prompt with context
        const fullPrompt = [
          'You are answering a question about a software project. Use the following project memories as context.',
          '',
          context,
          '',
          `Question: ${question}`,
          '',
          'Answer concisely based on the project memories above. If the memories do not contain enough information, say so.',
        ].join('\n');

        try {
          const answer = callClaude(fullPrompt);
          console.log(answer);
        } catch (err) {
          console.error(`Claude CLI call failed: ${(err as Error).message}`);
          console.log('\nFalling back to showing relevant memories:\n');
          console.log(context);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      } finally {
        ctx?.close();
      }
    });
}
