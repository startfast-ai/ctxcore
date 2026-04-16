import type { IEmbeddingClient } from '../types.js';

// Known Ollama embedding model dimensions
const OLLAMA_DIMENSIONS: Record<string, number> = {
  'qwen3-embedding:0.6b': 1024,
  'embeddinggemma:300m': 768,
  'qwen3-embedding:4b': 2560,
};

export class OllamaEmbeddingClient implements IEmbeddingClient {
  readonly dimensions: number;

  constructor(
    private baseUrl: string,
    private model: string,
  ) {
    this.dimensions = OLLAMA_DIMENSIONS[model] ?? 1024;
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embed failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return new Float32Array(data.embeddings[0]);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      throw new Error(`Ollama batch embed failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings.map((e) => new Float32Array(e));
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return false;

      const data = (await response.json()) as { models: { name: string }[] };
      return data.models.some((m) => m.name.startsWith(this.model));
    } catch {
      return false;
    }
  }
}
