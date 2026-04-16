import type { IEmbeddingClient } from '../types.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Lazy-loaded to avoid import cost when not used
let pipelineInstance: any = null;

const DEFAULT_MODEL = 'jinaai/jina-embeddings-v2-base-code';
const DEFAULT_CACHE_DIR = join(homedir(), '.ctxcore', 'models');

export class TransformersEmbeddingClient implements IEmbeddingClient {
  private extractor: any = null;
  private _dimensions: number = 384;
  readonly modelId: string;
  readonly cacheDir: string;

  constructor(modelId?: string, cacheDir?: string) {
    this.modelId = modelId ?? DEFAULT_MODEL;
    this.cacheDir = cacheDir ?? DEFAULT_CACHE_DIR;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async initialize(onProgress?: (message: string) => void): Promise<void> {
    if (this.extractor) return;

    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = this.cacheDir;

    // Use quantized (q8) for large models, fp32 for small ones
    const isLargeModel = this.modelId.includes('jina') || this.modelId.includes('base');
    const dtype = isLargeModel ? 'q8' : 'fp32';

    this.extractor = await pipeline('feature-extraction', this.modelId, {
      dtype: dtype as any,
      progress_callback: (event: any) => {
        if (event.status === 'progress' && onProgress) {
          const pct = (event.progress || 0).toFixed(0);
          onProgress(`Downloading model: ${pct}%`);
        }
      },
    });

    // Determine actual dimensions from a test embedding
    const test = await this.extractor('test', { pooling: 'mean', normalize: true });
    this._dimensions = test.dims[1];
  }

  private async ensureReady(): Promise<void> {
    if (!this.extractor) {
      await this.initialize();
    }
  }

  async embed(text: string): Promise<Float32Array> {
    await this.ensureReady();
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.ensureReady();
    if (texts.length === 0) return [];

    const output = await this.extractor(texts, { pooling: 'mean', normalize: true });
    const dim = output.dims[1];
    const data = output.data as Float32Array;
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(new Float32Array(data.slice(i * dim, (i + 1) * dim)));
    }
    return results;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureReady();
      return true;
    } catch {
      return false;
    }
  }
}
