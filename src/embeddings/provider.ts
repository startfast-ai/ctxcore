import type { IEmbeddingClient } from '../types.js';

export type EmbeddingProviderType = 'auto' | 'transformers' | 'ollama' | 'none';

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderType;
  ollamaUrl?: string;
  ollamaModel?: string;
  transformersModel?: string;
  cacheDir?: string;
  onProgress?: (message: string) => void;
}

/**
 * Creates the best available embedding client based on config.
 * "auto" tries: Transformers.js -> Ollama -> NullClient
 */
export async function createEmbeddingClient(config: EmbeddingProviderConfig): Promise<{
  client: IEmbeddingClient;
  provider: EmbeddingProviderType;
  dimensions: number;
}> {
  const { provider = 'auto' } = config;
  const log = config.onProgress ?? (() => {});

  if (provider === 'transformers' || provider === 'auto') {
    try {
      const { TransformersEmbeddingClient } = await import('./transformers.js');
      const client = new TransformersEmbeddingClient(config.transformersModel, config.cacheDir);
      log('Initializing local embedding model...');
      await client.initialize(config.onProgress);
      const dimensions = client.dimensions;
      return { client, provider: 'transformers', dimensions };
    } catch {
      if (provider === 'transformers') {
        throw new Error('Transformers.js embedding provider failed to initialize');
      }
      // auto: fall through to Ollama
    }
  }

  if (provider === 'ollama' || provider === 'auto') {
    const { OllamaEmbeddingClient } = await import('./ollama.js');
    const url = config.ollamaUrl ?? 'http://localhost:11434';
    const model = config.ollamaModel ?? 'qwen3-embedding:0.6b';
    const client = new OllamaEmbeddingClient(url, model);
    const healthy = await client.healthCheck();
    if (healthy) {
      const dimensions = client.dimensions;
      return { client, provider: 'ollama', dimensions };
    }
    if (provider === 'ollama') {
      throw new Error(`Ollama not available at ${url}`);
    }
    // auto: fall through to null
  }

  const { NullEmbeddingClient } = await import('./null.js');
  return { client: new NullEmbeddingClient(), provider: 'none', dimensions: 0 };
}
