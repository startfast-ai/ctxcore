import type {
  IMemoryStore,
  IEmbeddingClient,
  IEmbeddingStore,
  IRetrievalEngine,
  IScoringStrategy,
  Memory,
  SearchOptions,
  SearchResult,
} from './types.js';

/**
 * Default scoring: relevance x actuality x (1 + importance)
 * Pluggable — swap in a custom strategy to change ranking behavior.
 */
export class DefaultScoringStrategy implements IScoringStrategy {
  score(memory: Memory, similarity: number): number {
    return similarity * memory.actuality * (1 + memory.importance);
  }
}

export class RetrievalEngine implements IRetrievalEngine {
  private scoringStrategy: IScoringStrategy;

  constructor(
    private memoryStore: IMemoryStore,
    private embeddingStore: IEmbeddingStore,
    private embeddingClient: IEmbeddingClient | null,
    scoringStrategy?: IScoringStrategy,
  ) {
    this.scoringStrategy = scoringStrategy ?? new DefaultScoringStrategy();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? 20;
    const minScore = options.minScore ?? 0.0;

    const results: Map<string, SearchResult> = new Map();

    // Vector search if embeddings are available
    if (this.embeddingClient) {
      try {
        const queryEmbedding = await this.embeddingClient.embed(query);
        const vectorResults = this.embeddingStore.searchSimilar(queryEmbedding, limit * 2);

        for (const vr of vectorResults) {
          const memory = this.memoryStore.getById(vr.memoryId);
          if (!memory || (memory.archived && !options.includeArchived)) continue;
          if (options.tier && memory.tier !== options.tier) continue;
          if (options.tags?.length && !options.tags.some((t) => memory.tags.includes(t))) continue;

          // sqlite-vec uses L2 (Euclidean) distance.
          // For normalized vectors: cosine_similarity = 1 - (L2² / 2)
          // This maps L2=0 → sim=1.0, L2=√2 → sim=0.0, L2=2 → sim=-1.0
          const similarity = 1 - (vr.distance * vr.distance) / 2;
          const score = this.scoringStrategy.score(memory, Math.max(0, similarity));

          if (score >= minScore) {
            results.set(memory.id, { memory, score, matchType: 'vector' });
          }
        }
      } catch {
        // Fall through to keyword search
      }
    }

    // Keyword fallback / supplement
    const keywordResults = this.memoryStore.searchByKeyword(query, {
      limit: limit * 2,
      includeArchived: options.includeArchived,
    });

    for (const memory of keywordResults) {
      if (options.tier && memory.tier !== options.tier) continue;
      if (options.tags?.length && !options.tags.some((t) => memory.tags.includes(t))) continue;

      const existing = results.get(memory.id);
      if (existing) {
        existing.score *= 1.2;
        existing.matchType = 'hybrid';
      } else {
        const score = this.scoringStrategy.score(memory, 0.5);
        if (score >= minScore) {
          results.set(memory.id, { memory, score, matchType: 'keyword' });
        }
      }
    }

    const sorted = Array.from(results.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const result of sorted) {
      this.memoryStore.recordAccess(result.memory.id);
    }

    return sorted;
  }
}
