import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { CtxcoreConfig } from './types.js';
import { DEFAULT_CONFIG, getEmbeddingDimensions, isValidEmbeddingModel } from './types.js';

const GLOBAL_DIR = join(homedir(), '.ctxcore');
const GLOBAL_CONFIG_FILE = join(GLOBAL_DIR, 'config.json');
const PROJECT_CONFIG_FILE = '.ctxcore.json';

export function getGlobalDir(): string {
  return GLOBAL_DIR;
}

export function ensureGlobalDir(): void {
  if (!existsSync(GLOBAL_DIR)) {
    mkdirSync(GLOBAL_DIR, { recursive: true });
  }
}

export function loadGlobalConfig(): Partial<CtxcoreConfig> {
  if (!existsSync(GLOBAL_CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveGlobalConfig(config: Partial<CtxcoreConfig>): void {
  ensureGlobalDir();
  writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function loadProjectConfig(projectRoot: string): Partial<CtxcoreConfig> {
  const configPath = join(projectRoot, PROJECT_CONFIG_FILE);
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveProjectConfig(projectRoot: string, config: Partial<CtxcoreConfig>): void {
  const configPath = join(projectRoot, PROJECT_CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Re-export for backward compatibility
export { isValidEmbeddingModel };

export function resolveConfig(projectRoot: string): CtxcoreConfig {
  const global = loadGlobalConfig();
  const project = loadProjectConfig(projectRoot);
  const absRoot = resolve(projectRoot);

  const merged = {
    ...DEFAULT_CONFIG,
    ...global,
    ...project,
    projectRoot: absRoot,
    dbPath: project.dbPath ?? join(absRoot, '.memory.db'),
  } as CtxcoreConfig;

  // Auto-resolve embedding dimensions from the selected model
  if (merged.ollamaModel && isValidEmbeddingModel(merged.ollamaModel)) {
    merged.embedding = {
      ...merged.embedding,
      dimensions: getEmbeddingDimensions(merged.ollamaModel),
    };
  }

  return merged;
}
