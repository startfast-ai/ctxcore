import type {
  ReflexionSuggestion,
  IMemoryStore,
  MemoryTier,
  ConnectionType,
} from './types.js';

export interface ApplyResult {
  applied: number;
  skipped: number;
  errors: string[];
}

const TIER_PROMOTION: Record<MemoryTier, MemoryTier> = {
  'short-term': 'operational',
  'operational': 'long-term',
  'long-term': 'long-term',
};

export class ReflexionApplicator {
  apply(suggestions: ReflexionSuggestion[], store: IMemoryStore): ApplyResult {
    let applied = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const suggestion of suggestions) {
      try {
        const ok = this.applySingle(suggestion, store);
        if (ok) {
          applied++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors.push(
          `Failed to apply ${suggestion.action} on [${suggestion.targetIds.join(', ')}]: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { applied, skipped, errors };
  }

  private applySingle(suggestion: ReflexionSuggestion, store: IMemoryStore): boolean {
    switch (suggestion.action) {
      case 'merge':
        return this.applyMerge(suggestion, store);
      case 'archive':
        return this.applyArchive(suggestion, store);
      case 'promote':
        return this.applyPromote(suggestion, store);
      case 'update-importance':
        return this.applyUpdateImportance(suggestion, store);
      case 'create-connection':
        return this.applyCreateConnection(suggestion, store);
      default:
        return false;
    }
  }

  private applyMerge(suggestion: ReflexionSuggestion, store: IMemoryStore): boolean {
    const memories = suggestion.targetIds.map((id) => store.getById(id));

    // Skip if any target memory is missing
    if (memories.some((m) => m === null)) {
      return false;
    }

    const validMemories = memories.filter((m) => m !== null);

    // Determine merged content: prefer data.mergedContent if provided, else combine
    const mergedContent =
      typeof suggestion.data?.mergedContent === 'string'
        ? suggestion.data.mergedContent
        : validMemories.map((m) => m.content).join('\n\n');

    // Use highest tier and importance from the source memories
    const tierOrder: MemoryTier[] = ['short-term', 'operational', 'long-term'];
    const highestTier = validMemories.reduce<MemoryTier>((best, m) => {
      return tierOrder.indexOf(m.tier) > tierOrder.indexOf(best) ? m.tier : best;
    }, validMemories[0].tier);

    const highestImportance = Math.max(...validMemories.map((m) => m.importance));

    // Collect all tags
    const allTags = [...new Set(validMemories.flatMap((m) => m.tags))];

    // Create the merged memory
    const merged = store.create({
      content: mergedContent,
      tier: highestTier,
      importance: highestImportance,
      tags: allTags,
      metadata: { mergedFrom: suggestion.targetIds, reason: suggestion.reason },
    });

    // Archive originals
    for (const m of validMemories) {
      store.archive(m.id);
    }

    // Create connections from merged to each original
    for (const m of validMemories) {
      try {
        store.createConnection({
          sourceId: merged.id,
          targetId: m.id,
          type: 'causal',
          metadata: { reason: 'merged' },
        });
      } catch {
        // Connection already exists — skip
      }
    }

    return true;
  }

  private applyArchive(suggestion: ReflexionSuggestion, store: IMemoryStore): boolean {
    let anyApplied = false;

    for (const id of suggestion.targetIds) {
      const memory = store.getById(id);
      if (!memory) continue;
      store.archive(id);
      anyApplied = true;
    }

    return anyApplied;
  }

  private applyPromote(suggestion: ReflexionSuggestion, store: IMemoryStore): boolean {
    let anyApplied = false;

    for (const id of suggestion.targetIds) {
      const memory = store.getById(id);
      if (!memory) continue;

      const newTier = TIER_PROMOTION[memory.tier];
      if (newTier !== memory.tier) {
        store.update(id, { tier: newTier });
        anyApplied = true;
      }
    }

    return anyApplied;
  }

  private applyUpdateImportance(suggestion: ReflexionSuggestion, store: IMemoryStore): boolean {
    const newImportance =
      typeof suggestion.data?.importance === 'number'
        ? suggestion.data.importance
        : typeof suggestion.data?.newImportance === 'number'
          ? suggestion.data.newImportance
          : null;

    if (newImportance === null) {
      return false;
    }

    let anyApplied = false;

    for (const id of suggestion.targetIds) {
      const memory = store.getById(id);
      if (!memory) continue;
      store.update(id, { importance: newImportance });
      anyApplied = true;
    }

    return anyApplied;
  }

  private applyCreateConnection(suggestion: ReflexionSuggestion, store: IMemoryStore): boolean {
    if (suggestion.targetIds.length < 2) {
      return false;
    }

    const VALID_TYPES = new Set(['causal', 'contradicts', 'supports', 'temporal', 'similar']);
    const rawType = typeof suggestion.data?.connectionType === 'string'
      ? suggestion.data.connectionType
      : 'similar';
    const connectionType = (VALID_TYPES.has(rawType) ? rawType : 'similar') as ConnectionType;

    let anyCreated = false;

    // Connect all pairs: first → second, first → third, second → third, etc.
    for (let i = 0; i < suggestion.targetIds.length; i++) {
      for (let j = i + 1; j < suggestion.targetIds.length; j++) {
        const source = store.getById(suggestion.targetIds[i]);
        const target = store.getById(suggestion.targetIds[j]);
        if (!source || !target) continue;

        try {
          store.createConnection({
            sourceId: source.id,
            targetId: target.id,
            type: connectionType,
            metadata: { reason: suggestion.reason },
          });
          anyCreated = true;
        } catch {
          // Duplicate or constraint — skip
          anyCreated = true; // still counts as handled
        }
      }
    }

    return anyCreated;
  }
}
