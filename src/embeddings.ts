// Backward compatibility — re-exports from new modular structure
export { OllamaEmbeddingClient } from './embeddings/ollama.js';
export { SqliteEmbeddingStore } from './embeddings/store.js';
export { NullEmbeddingClient } from './embeddings/null.js';
export { TransformersEmbeddingClient } from './embeddings/transformers.js';
export { createEmbeddingClient } from './embeddings/provider.js';
