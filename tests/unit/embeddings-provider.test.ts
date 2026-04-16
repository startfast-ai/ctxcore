import { describe, it, expect } from 'vitest';
import { OllamaEmbeddingClient } from '../../src/embeddings/ollama.js';
import { NullEmbeddingClient } from '../../src/embeddings/null.js';
import { SqliteEmbeddingStore } from '../../src/embeddings/store.js';
import { createTestDb } from '../helpers/test-db.js';

describe('NullEmbeddingClient', () => {
  const client = new NullEmbeddingClient();

  it('throws on embed', async () => {
    await expect(client.embed('test')).rejects.toThrow('No embedding backend');
  });

  it('throws on embedBatch', async () => {
    await expect(client.embedBatch(['a', 'b'])).rejects.toThrow('No embedding backend');
  });

  it('healthCheck returns false', async () => {
    expect(await client.healthCheck()).toBe(false);
  });
});

describe('OllamaEmbeddingClient', () => {
  it('has correct dimensions for known models', () => {
    const qwen = new OllamaEmbeddingClient('http://localhost:11434', 'qwen3-embedding:0.6b');
    expect(qwen.dimensions).toBe(1024);

    const gemma = new OllamaEmbeddingClient('http://localhost:11434', 'embeddinggemma:300m');
    expect(gemma.dimensions).toBe(768);

    const qwen4b = new OllamaEmbeddingClient('http://localhost:11434', 'qwen3-embedding:4b');
    expect(qwen4b.dimensions).toBe(2560);
  });

  it('defaults to 1024 for unknown models', () => {
    const unknown = new OllamaEmbeddingClient('http://localhost:11434', 'unknown-model');
    expect(unknown.dimensions).toBe(1024);
  });

  it('healthCheck returns false when Ollama is not running', async () => {
    const client = new OllamaEmbeddingClient('http://localhost:99999', 'test');
    expect(await client.healthCheck()).toBe(false);
  });
});

describe('SqliteEmbeddingStore', () => {
  it('stores and retrieves embeddings', () => {
    const db = createTestDb(384);
    const store = new SqliteEmbeddingStore(db);

    const embedding = new Float32Array(384).fill(0.5);
    store.store('mem-1', embedding);

    const results = store.searchSimilar(embedding, 5);
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('mem-1');
    expect(results[0].distance).toBeCloseTo(0, 1);

    db.close();
  });

  it('replaces existing embedding on store', () => {
    const db = createTestDb(384);
    const store = new SqliteEmbeddingStore(db);

    const emb1 = new Float32Array(384).fill(0.1);
    const emb2 = new Float32Array(384).fill(0.9);
    store.store('mem-1', emb1);
    store.store('mem-1', emb2);

    const results = store.searchSimilar(emb2, 5);
    expect(results.length).toBe(1);
    expect(results[0].distance).toBeCloseTo(0, 1);

    db.close();
  });

  it('deletes embeddings', () => {
    const db = createTestDb(384);
    const store = new SqliteEmbeddingStore(db);

    const embedding = new Float32Array(384).fill(0.5);
    store.store('mem-1', embedding);
    store.delete('mem-1');

    const results = store.searchSimilar(embedding, 5);
    expect(results.length).toBe(0);

    db.close();
  });

  it('returns multiple results ordered by distance', () => {
    const db = createTestDb(4);
    const store = new SqliteEmbeddingStore(db);

    store.store('close', new Float32Array([1, 0, 0, 0]));
    store.store('far', new Float32Array([0, 0, 0, 1]));
    store.store('medium', new Float32Array([0.7, 0.3, 0, 0]));

    const query = new Float32Array([1, 0, 0, 0]);
    const results = store.searchSimilar(query, 10);
    expect(results.length).toBe(3);
    expect(results[0].memoryId).toBe('close');
    expect(results[0].distance).toBeLessThan(results[1].distance);

    db.close();
  });

  it('respects limit parameter', () => {
    const db = createTestDb(4);
    const store = new SqliteEmbeddingStore(db);

    for (let i = 0; i < 10; i++) {
      store.store(`mem-${i}`, new Float32Array([Math.random(), Math.random(), Math.random(), Math.random()]));
    }

    const results = store.searchSimilar(new Float32Array([0.5, 0.5, 0.5, 0.5]), 3);
    expect(results.length).toBe(3);

    db.close();
  });
});
