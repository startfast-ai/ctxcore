// ── Domain Types ──

export type MemoryTier = 'short-term' | 'operational' | 'long-term';

export type ImportanceLevel = 'routine' | 'operational' | 'decision' | 'breakthrough';

export type ConnectionType = 'causal' | 'contradicts' | 'supports' | 'temporal' | 'similar';

export interface Memory {
  id: string;
  content: string;
  tier: MemoryTier;
  importance: number;
  actuality: number;
  embedding: Float32Array | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  archived: boolean;
}

export interface MemoryCreateInput {
  content: string;
  tier?: MemoryTier;
  importance?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryUpdateInput {
  content?: string;
  tier?: MemoryTier;
  importance?: number;
  actuality?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  type: ConnectionType;
  strength: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface ConnectionCreateInput {
  sourceId: string;
  targetId: string;
  type: ConnectionType;
  strength?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: 'vector' | 'keyword' | 'hybrid';
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  tier?: MemoryTier;
  includeArchived?: boolean;
  tags?: string[];
}

export interface VectorMatch {
  memoryId: string;
  distance: number;
}

export interface ReflexionEntry {
  id: string;
  type: 'consolidation' | 'contradiction' | 'pattern' | 'recalibration' | 'user-profile';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  memoriesAffected: string[];
  createdAt: Date;
}

export interface MemoryEvent {
  id: string;
  memoryId: string;
  eventType: 'created' | 'accessed' | 'updated' | 'promoted' | 'demoted' | 'archived' | 'decayed' | 'reinforced';
  data: Record<string, unknown>;
  createdAt: Date;
}

// ── Core Interfaces ──

export interface IMemoryStore {
  create(input: MemoryCreateInput): Memory;
  getById(id: string): Memory | null;
  update(id: string, input: MemoryUpdateInput): Memory | null;
  delete(id: string): boolean;
  archive(id: string): Memory | null;
  recordAccess(id: string): Memory | null;
  list(options?: {
    tier?: MemoryTier;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  }): Memory[];
  searchByKeyword(query: string, options?: { limit?: number; includeArchived?: boolean }): Memory[];
  createConnection(input: ConnectionCreateInput): Connection;
  getConnectionById(id: string): Connection | null;
  getConnectionsFor(memoryId: string): Connection[];
  deleteConnection(id: string): boolean;
  getEvents(memoryId: string): MemoryEvent[];
  stats(): { total: number; byTier: Record<string, number>; archived: number };
}

export interface IEmbeddingClient {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  healthCheck(): Promise<boolean>;
}

export interface IEmbeddingStore {
  store(memoryId: string, embedding: Float32Array): void;
  delete(memoryId: string): void;
  searchSimilar(queryEmbedding: Float32Array, limit?: number): VectorMatch[];
}

export interface IScoringStrategy {
  score(memory: Memory, similarity: number): number;
}

export interface IRetrievalEngine {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export interface IDecayEngine {
  applyDecay(memory: Memory): number;
  computeDecayRate(memory: Memory): number;
}

export interface IImportanceClassifier {
  classify(content: string): { level: ImportanceLevel; score: number };
}

export interface IPromotionEngine {
  evaluate(memory: Memory): MemoryTier | null;
}

export interface IContextBuilder {
  buildContext(options?: { maxTokens?: number; tier?: MemoryTier }): string;
}

export interface IClaudeMdManager {
  patch(projectRoot: string): void;
  rebuild(projectRoot: string): void;
  remove(projectRoot: string): void;
}

// ── Phase 4: Self-Reflexion Engine Types ──

export interface IClaudeCliRunner {
  run(prompt: string, options?: { timeout?: number }): Promise<string>;
}

export type ReflexionSuggestionAction =
  | 'merge'
  | 'archive'
  | 'promote'
  | 'update-importance'
  | 'create-connection';

export interface ReflexionSuggestion {
  action: ReflexionSuggestionAction;
  targetIds: string[];
  reason: string;
  data?: Record<string, unknown>;
}

export interface ReflexionResult {
  type: string;
  memoriesAffected: string[];
  suggestions: ReflexionSuggestion[];
  journal: ReflexionEntry;
}

export interface IReflexionEngine {
  runConsolidation(memories: Memory[]): Promise<ReflexionResult>;
  detectContradictions(memories: Memory[]): Promise<ReflexionResult>;
  findPatterns(memories: Memory[]): Promise<ReflexionResult>;
  recalibrateImportance(memories: Memory[]): Promise<ReflexionResult>;
  runFull(store: IMemoryStore): Promise<ReflexionResult[]>;
}

// ── Phase 5: User Profiling Types ──

export type PreferenceCategory = 'communication' | 'technical' | 'workflow' | 'tooling' | 'code-style';

export type PreferenceScope = 'global' | 'project';

export interface UserPreference {
  id: string;
  category: PreferenceCategory;
  content: string;
  confidence: number;
  observationCount: number;
  scope: PreferenceScope;
  projectRoot?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PreferenceSignal {
  content: string;
  confidence: number;
  category: string;
}

export interface PreferenceListOptions {
  category?: PreferenceCategory;
  scope?: PreferenceScope;
  projectRoot?: string;
  minConfidence?: number;
}

export interface IUserProfileManager {
  addPreference(pref: {
    category: PreferenceCategory;
    content: string;
    confidence?: number;
    scope?: PreferenceScope;
    projectRoot?: string;
  }): UserPreference;

  getPreferences(options?: PreferenceListOptions): UserPreference[];

  updateConfidence(id: string): UserPreference | null;

  forgetPreference(id: string): boolean;

  detectCorrections(text: string): PreferenceSignal[];
}

// ── Phase 6: Project Analysis Types ──

export interface ProjectSignals {
  language: LanguageSignal[];
  framework: FrameworkSignal[];
  structure: StructureSignal[];
  configFiles: ConfigFileSignal[];
  dependencies: DependencySignal[];
  scripts: ScriptSignal[];
  packageManager?: string;
}

export interface LanguageSignal {
  name: string;
  confidence: number;
  evidence: string; // e.g. "tsconfig.json found"
}

export interface FrameworkSignal {
  name: string;
  version?: string;
  confidence: number;
  evidence: string;
}

export interface StructureSignal {
  directory: string;
  purpose: string; // e.g. "source code", "tests", "configuration"
}

export interface ConfigFileSignal {
  path: string;
  category: 'ci' | 'docker' | 'env' | 'linter' | 'build' | 'other';
}

export interface DependencySignal {
  name: string;
  version?: string;
  source: string; // e.g. "package.json", "go.mod"
  dev: boolean;
}

export interface ScriptSignal {
  name: string;
  command: string;
  source: string; // e.g. "package.json scripts", "Makefile"
}

export interface IProjectScanner {
  scan(projectRoot: string): Promise<ProjectSignals>;
  scanIncremental(projectRoot: string, since: string): Promise<ProjectSignals>;
}

export interface IMemorySeeder {
  seed(signals: ProjectSignals, store: IMemoryStore): Memory[];
}

// ── Phase 7: Scheduling & Lock Types ──

export interface CronStatus {
  schedule: string;
  lastRun: Date | null;
  nextRun: Date | null;
  command: string;
}

export interface IScheduler {
  installCron(schedule: string, command: string): void;
  removeCron(): void;
  getCronStatus(): CronStatus | null;
  installGitHooks(projectRoot: string): void;
  removeGitHooks(projectRoot: string): void;
}

export interface ILockManager {
  acquire(name: string): boolean;
  release(name: string): void;
  isLocked(name: string): boolean;
  isStale(name: string, maxAgeMs?: number): boolean;
}

// ── Phase 8: Observability & Health Types ──

export interface HealthReport {
  score: number;
  coverage: number;
  freshness: number;
  depth: number;
  coherence: number;
  details: string[];
}

export interface IntelligenceScore {
  total: number;
  depth: number;
  freshness: number;
  coherence: number;
  coverage: number;
  trend: 'rising' | 'stable' | 'declining';
  lastReflexion: Date | null;
  memoryCounts: { shortTerm: number; operational: number; longTerm: number };
}

export interface IntelligenceHistoryEntry {
  id: number;
  scoreTotal: number;
  scoreDepth: number;
  scoreFreshness: number;
  scoreCoherence: number;
  scoreCoverage: number;
  eventType: 'init' | 'session' | 'reflexion' | 'manual';
  createdAt: Date;
}

export interface IHealthCalculator {
  calculate(store: IMemoryStore): HealthReport;
}

// ── Phase 9: Triggers & Branch-Aware Types ──

export type TriggerConditionType = 'stale-tier' | 'recurring-pattern' | 'low-coverage';

export interface TriggerCondition {
  type: TriggerConditionType;
  threshold: number;
  tier?: MemoryTier;
}

export interface TriggerRule {
  name: string;
  condition: TriggerCondition;
  action: string;
  message: string;
}

export interface TriggerAlert {
  rule: TriggerRule;
  triggered: boolean;
  message: string;
  memoryIds: string[];
}

export interface ITriggerEngine {
  evaluate(store: IMemoryStore): TriggerAlert[];
  loadRules(configPath: string): void;
}

export interface IBranchManager {
  getCurrentBranch(projectRoot: string): string | null;
  tagMemory(memoryId: string, branch: string, store: IMemoryStore): void;
  filterByBranch(memories: Memory[], branch: string): Memory[];
}

// ── Phase 2: Spec Data Model Types ──

export type SpecStatus = 'draft' | 'in-review' | 'approved' | 'in-progress' | 'completed' | 'archived';

export interface Spec {
  id: string;
  title: string;
  status: SpecStatus;
  content: string;
  filePath: string;
  tags: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpecCreateInput {
  title: string;
  content?: string;
  tags?: string[];
  status?: SpecStatus;
}

export interface SpecUpdateInput {
  content?: string;
  status?: SpecStatus;
  tags?: string[];
}

export interface SpecVersion {
  version: number;
  timestamp: Date;
  author: string;
  summary: string;
  gitCommit?: string;
}

export interface SpecComment {
  id: string;
  author: string;
  authorType: 'human' | 'ai';
  content: string;
  target?: string;
  createdAt: Date;
}

export interface SpecMetadata {
  id: string;
  title: string;
  status: SpecStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  linkedTasks: string[];
  linkedMemories: string[];
  comments: SpecComment[];
  versions: SpecVersion[];
}

export interface SpecListOptions {
  status?: SpecStatus;
  tags?: string[];
}

export interface ISpecStore {
  create(input: SpecCreateInput): Spec;
  getById(id: string): Spec | null;
  list(options?: SpecListOptions): Spec[];
  update(id: string, input: SpecUpdateInput, summary?: string): Spec | null;
  addComment(id: string, comment: Omit<SpecComment, 'id' | 'createdAt'>): SpecComment;
  getVersions(id: string): SpecVersion[];
  restore(id: string, version: number): Spec | null;
}

// ── Phase 1: Task & Kanban Types ──

export type TaskStatus = 'open' | 'in-progress' | 'done' | 'archived';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskCommentAuthorType = 'human' | 'ai';
export type TaskMemoryLinkType = 'related' | 'blocker' | 'decision' | 'spec' | 'caused_by';
export type TaskSpecLinkType = 'implements' | 'related' | 'blocked_by';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  columnId: string | null;
  columnOrder: number;
  priority: TaskPriority;
  assignee: string | null;
  createdBy: string | null;
  tags: string[];
  estimatedEffort: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface TaskCreateInput {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  columnId?: string;
  columnOrder?: number;
  priority?: TaskPriority;
  assignee?: string;
  createdBy?: string;
  tags?: string[];
  estimatedEffort?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  columnId?: string;
  columnOrder?: number;
  priority?: TaskPriority;
  assignee?: string | null;
  createdBy?: string;
  tags?: string[];
  estimatedEffort?: string | null;
  completedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface TaskComment {
  id: string;
  taskId: string;
  author: string;
  authorType: TaskCommentAuthorType;
  content: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface KanbanColumn {
  id: string;
  projectId: string;
  title: string;
  columnOrder: number;
  wipLimit: number | null;
  color: string | null;
}

export interface TaskMemoryLink {
  taskId: string;
  memoryId: string;
  linkType: TaskMemoryLinkType;
  createdAt: Date;
}

export interface TaskSpecLink {
  taskId: string;
  specId: string;
  linkType: TaskSpecLinkType;
  createdAt: Date;
}

export interface TaskListOptions {
  status?: TaskStatus;
  columnId?: string;
  assignee?: string;
  tag?: string;
  createdBy?: string;
  limit?: number;
  offset?: number;
}

export interface ITaskStore {
  create(input: TaskCreateInput): Task;
  getById(id: string): Task | null;
  update(id: string, input: TaskUpdateInput): Task | null;
  list(options?: TaskListOptions): Task[];
  move(id: string, columnId: string, order: number): Task | null;
  archive(id: string): Task | null;
  addComment(taskId: string, author: string, authorType: TaskCommentAuthorType, content: string): TaskComment;
  getComments(taskId: string): TaskComment[];
  linkMemory(taskId: string, memoryId: string, linkType: TaskMemoryLinkType): TaskMemoryLink;
  linkSpec(taskId: string, specId: string, linkType: TaskSpecLinkType): TaskSpecLink;
  getLinkedMemories(taskId: string): TaskMemoryLink[];
  getLinkedSpecs(taskId: string): TaskSpecLink[];
  unlinkMemory(taskId: string, memoryId: string): boolean;
  unlinkSpec(taskId: string, specId: string): boolean;
  seedDefaultColumns(projectId: string): KanbanColumn[];
  isColumnAtLimit(columnId: string): boolean;
}

// ── Embedding Model Registry ──

export type EmbeddingProviderType = 'auto' | 'transformers' | 'ollama' | 'none';

export type OllamaModelId = 'qwen3-embedding:0.6b' | 'embeddinggemma:300m' | 'qwen3-embedding:4b';

// Keep backward compat alias
export type EmbeddingModelId = OllamaModelId;

export interface EmbeddingModelInfo {
  id: string;
  name: string;
  dimensions: number;
  description: string;
  provider: EmbeddingProviderType;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelInfo> = {
  // Local (Transformers.js) — zero external dependencies
  'jina-code': {
    id: 'jinaai/jina-embeddings-v2-base-code',
    name: 'Jina Code v2',
    dimensions: 768,
    description: 'Code-optimized, 8K context, 15+ languages — best for codebases (default)',
    provider: 'transformers',
  },
  'all-MiniLM-L6-v2': {
    id: 'Xenova/all-MiniLM-L6-v2',
    name: 'MiniLM L6 v2',
    dimensions: 384,
    description: 'Fast, lightweight, smallest download (~96MB)',
    provider: 'transformers',
  },
  'jina-embeddings-v2-small-en': {
    id: 'Xenova/jina-embeddings-v2-small-en',
    name: 'Jina v2 Small',
    dimensions: 512,
    description: 'General-purpose local embeddings, 8K context window',
    provider: 'transformers',
  },
  // Ollama — requires Ollama running
  'qwen3-embedding:0.6b': {
    id: 'qwen3-embedding:0.6b',
    name: 'Qwen3 Embedding 0.6B',
    dimensions: 1024,
    description: 'Fast Ollama model — good balance of speed and quality',
    provider: 'ollama',
  },
  'embeddinggemma:300m': {
    id: 'embeddinggemma:300m',
    name: 'Embedding Gemma 300M',
    dimensions: 768,
    description: 'Smallest Ollama model — best for low-resource machines',
    provider: 'ollama',
  },
  'qwen3-embedding:4b': {
    id: 'qwen3-embedding:4b',
    name: 'Qwen3 Embedding 4B',
    dimensions: 2560,
    description: 'Highest quality Ollama model — needs more RAM',
    provider: 'ollama',
  },
};

export const DEFAULT_EMBEDDING_MODEL: string = 'jina-code';

export function getEmbeddingDimensions(model: string): number {
  const info = EMBEDDING_MODELS[model];
  return info?.dimensions ?? 384;
}

export function isValidEmbeddingModel(model: string): boolean {
  return model in EMBEDDING_MODELS;
}

export function getModelProvider(model: string): EmbeddingProviderType {
  return EMBEDDING_MODELS[model]?.provider ?? 'auto';
}

// ── Configuration ──

export interface CtxcoreConfig {
  projectRoot: string;
  dbPath: string;
  claudeCliPath?: string;
  ollamaUrl: string;
  ollamaModel: string;
  embeddingProvider: EmbeddingProviderType;
  decay: {
    shortTerm: number;
    operational: number;
    longTerm: number;
  };
  embedding: {
    dimensions: number;
    batchSize: number;
  };
}

export const DEFAULT_CONFIG: Omit<CtxcoreConfig, 'projectRoot' | 'dbPath'> = {
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: DEFAULT_EMBEDDING_MODEL,
  embeddingProvider: 'auto',
  decay: {
    shortTerm: 0.95,
    operational: 0.995,
    longTerm: 0.9995,
  },
  embedding: {
    dimensions: EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL].dimensions,
    batchSize: 32,
  },
};
