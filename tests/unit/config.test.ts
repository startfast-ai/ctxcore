import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, EMBEDDING_MODELS, DEFAULT_EMBEDDING_MODEL, getEmbeddingDimensions } from '../../src/types.js';

describe('Config', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_CONFIG.ollamaUrl).toBe('http://localhost:11434');
    expect(DEFAULT_CONFIG.ollamaModel).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(DEFAULT_CONFIG.embeddingProvider).toBe('auto');
    expect(DEFAULT_CONFIG.decay.shortTerm).toBeLessThan(DEFAULT_CONFIG.decay.operational);
    expect(DEFAULT_CONFIG.decay.operational).toBeLessThan(DEFAULT_CONFIG.decay.longTerm);
  });

  it('default dimensions match default model', () => {
    const expected = EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL].dimensions;
    expect(DEFAULT_CONFIG.embedding.dimensions).toBe(expected);
  });
});

describe('Embedding Models', () => {
  it('has local and ollama models registered', () => {
    expect(Object.keys(EMBEDDING_MODELS).length).toBeGreaterThanOrEqual(6);
  });

  it('each model has required fields', () => {
    for (const model of Object.values(EMBEDDING_MODELS)) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.dimensions).toBeGreaterThan(0);
      expect(model.description).toBeTruthy();
      expect(model.provider).toBeTruthy();
    }
  });

  it('getEmbeddingDimensions returns correct values', () => {
    expect(getEmbeddingDimensions('jina-code')).toBe(768);
    expect(getEmbeddingDimensions('all-MiniLM-L6-v2')).toBe(384);
    expect(getEmbeddingDimensions('qwen3-embedding:0.6b')).toBe(1024);
    expect(getEmbeddingDimensions('embeddinggemma:300m')).toBe(768);
    expect(getEmbeddingDimensions('qwen3-embedding:4b')).toBe(2560);
  });

  it('default model is jina-code (local transformers)', () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe('jina-code');
    expect(EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL].provider).toBe('transformers');
    expect(EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL].dimensions).toBe(768);
  });

  it('has both transformers and ollama providers', () => {
    const providers = new Set(Object.values(EMBEDDING_MODELS).map(m => m.provider));
    expect(providers.has('transformers')).toBe(true);
    expect(providers.has('ollama')).toBe(true);
  });
});
