import type { IContextBuilder, IMemoryStore, Memory, MemoryTier } from './types.js';

const DEFAULT_MAX_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;

/** Tier priority: long-term > operational > short-term */
const TIER_PRIORITY: Record<MemoryTier, number> = {
  'long-term': 3,
  'operational': 2,
  'short-term': 1,
};

/**
 * Budget-aware memory selection for CLAUDE.md injection.
 * Selects top memories by score (actuality * importance), respects a token budget,
 * and formats output as structured markdown sections.
 */
export class ContextBuilder implements IContextBuilder {
  constructor(private memoryStore: IMemoryStore) {}

  buildContext(options?: { maxTokens?: number; tier?: MemoryTier }): string {
    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    // Fetch all non-archived memories (optionally filtered by tier)
    const memories = this.memoryStore.list({
      tier: options?.tier,
      includeArchived: false,
      limit: 500,
    });

    if (memories.length === 0) {
      return '> No memories stored yet. Use memory tools to start building project context.\n';
    }

    // Sort by tier priority (desc), then by score (actuality * importance) (desc)
    const scored = memories
      .map((m) => ({
        memory: m,
        score: m.actuality * m.importance,
        tierPriority: TIER_PRIORITY[m.tier],
      }))
      .sort((a, b) => {
        if (a.tierPriority !== b.tierPriority) return b.tierPriority - a.tierPriority;
        return b.score - a.score;
      });

    // Select memories within budget
    const selected: Memory[] = [];
    let usedChars = 0;

    for (const entry of scored) {
      const entryChars = this.estimateChars(entry.memory);
      if (usedChars + entryChars > maxChars) break;
      selected.push(entry.memory);
      usedChars += entryChars;
    }

    // Group by category for display
    return this.formatSections(selected);
  }

  private estimateChars(memory: Memory): number {
    // Memory line: "- content (tags)\n" + some overhead per entry
    return memory.content.length + 20;
  }

  private formatSections(memories: Memory[]): string {
    const decisions: Memory[] = [];
    const activeContext: Memory[] = [];
    const recentFindings: Memory[] = [];

    for (const m of memories) {
      if (m.tier === 'long-term' || m.tags.includes('decision')) {
        decisions.push(m);
      } else if (m.tier === 'operational') {
        activeContext.push(m);
      } else {
        recentFindings.push(m);
      }
    }

    const sections: string[] = [];

    if (decisions.length > 0) {
      sections.push(this.renderSection('Key Decisions', decisions));
    }
    if (activeContext.length > 0) {
      sections.push(this.renderSection('Active Context', activeContext));
    }
    if (recentFindings.length > 0) {
      sections.push(this.renderSection('Recent Findings', recentFindings));
    }

    return sections.join('\n');
  }

  private renderSection(title: string, memories: Memory[]): string {
    const lines = [`### ${title}\n`];
    for (const m of memories) {
      const tagStr = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
      lines.push(`- ${m.content}${tagStr}`);
    }
    lines.push('');
    return lines.join('\n');
  }
}
