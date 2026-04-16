import type { IEmbeddingClient } from '../types.js';

export class NullEmbeddingClient implements IEmbeddingClient {
  async embed(_text: string): Promise<Float32Array> {
    throw new Error('No embedding backend available');
  }

  async embedBatch(_texts: string[]): Promise<Float32Array[]> {
    throw new Error('No embedding backend available');
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }
}
