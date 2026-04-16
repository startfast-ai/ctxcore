import type Database from 'better-sqlite3';
import type { IEmbeddingStore, VectorMatch } from '../types.js';

export class SqliteEmbeddingStore implements IEmbeddingStore {
  constructor(private db: Database.Database) {}

  store(memoryId: string, embedding: Float32Array): void {
    // sqlite-vec virtual tables don't support INSERT OR REPLACE — delete first
    this.db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(memoryId);
    this.db
      .prepare('INSERT INTO memory_embeddings (memory_id, embedding) VALUES (?, ?)')
      .run(memoryId, Buffer.from(embedding.buffer));
  }

  delete(memoryId: string): void {
    this.db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(memoryId);
  }

  searchSimilar(queryEmbedding: Float32Array, limit: number = 20): VectorMatch[] {
    const rows = this.db
      .prepare(
        `SELECT memory_id, distance
         FROM memory_embeddings
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(Buffer.from(queryEmbedding.buffer), limit) as { memory_id: string; distance: number }[];

    return rows.map((r) => ({
      memoryId: r.memory_id,
      distance: r.distance,
    }));
  }
}
