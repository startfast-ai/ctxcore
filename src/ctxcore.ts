import type Database from 'better-sqlite3';
import type {
  CtxcoreConfig,
  IMemoryStore,
  IEmbeddingClient,
  IEmbeddingStore,
  IRetrievalEngine,
  IScoringStrategy,
  IDecayEngine,
  IImportanceClassifier,
  IPromotionEngine,
  IContextBuilder,
  IClaudeMdManager,
  IClaudeCliRunner,
  IReflexionEngine,
  IProjectScanner,
  IMemorySeeder,
  IUserProfileManager,
  IScheduler,
  ILockManager,
  IHealthCalculator,
  ITriggerEngine,
  IBranchManager,
  ISpecStore,
  ITaskStore,
} from './types.js';
import { createDatabase, createVecTable } from './database.js';
import { MemoryStore } from './memory-store.js';
import { OllamaEmbeddingClient, SqliteEmbeddingStore, NullEmbeddingClient, createEmbeddingClient } from './embeddings/index.js';
import { RetrievalEngine, DefaultScoringStrategy } from './retrieval.js';
import { resolveConfig } from './config.js';
import { DecayEngine } from './decay.js';
import { ImportanceClassifier } from './importance.js';
import { PromotionEngine } from './promotion.js';
import { ContextBuilder } from './context-builder.js';
import { ClaudeMdManager } from './claudemd.js';
import { ClaudeCliRunner } from './claude-cli.js';
import { ReflexionEngine } from './reflexion.js';
import { ProjectScanner } from './project-scanner.js';
import { MemorySeeder } from './seed-memories.js';
import { UserProfileManager, createProfileDatabase } from './user-profile.js';
import { Scheduler } from './scheduler.js';
import { LockManager } from './lockfile.js';
import { HealthCalculator } from './health.js';
import { TriggerEngine } from './triggers.js';
import { BranchManager } from './branch-aware.js';
import { SpecStore } from './specs.js';
import { TaskStore } from './tasks.js';
import { CommentStore } from './task-comments.js';
import { TaskLinkStore } from './task-linking.js';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

export interface CtxcoreOptions {
  memoryStore?: IMemoryStore;
  embeddingClient?: IEmbeddingClient;
  embeddingStore?: IEmbeddingStore;
  retrievalEngine?: IRetrievalEngine;
  scoringStrategy?: IScoringStrategy;
  decayEngine?: IDecayEngine;
  importanceClassifier?: IImportanceClassifier;
  promotionEngine?: IPromotionEngine;
  contextBuilder?: IContextBuilder;
  claudeMdManager?: IClaudeMdManager;
  claudeCliRunner?: IClaudeCliRunner;
  reflexionEngine?: IReflexionEngine;
  projectScanner?: IProjectScanner;
  memorySeeder?: IMemorySeeder;
  userProfileManager?: IUserProfileManager;
  userProfileDbPath?: string;
  scheduler?: IScheduler;
  lockManager?: ILockManager;
  healthCalculator?: IHealthCalculator;
  triggerEngine?: ITriggerEngine;
  branchManager?: IBranchManager;
  specStore?: ISpecStore;
  taskStore?: ITaskStore;
  commentStore?: CommentStore;
  taskLinkStore?: TaskLinkStore;
  db?: Database.Database;
}

export class Ctxcore {
  readonly config: CtxcoreConfig;
  readonly db: Database.Database;
  readonly memoryStore: IMemoryStore;
  readonly embeddingClient: IEmbeddingClient;
  readonly embeddingStore: IEmbeddingStore;
  readonly retrievalEngine: IRetrievalEngine;
  readonly decayEngine: IDecayEngine;
  readonly importanceClassifier: IImportanceClassifier;
  readonly promotionEngine: IPromotionEngine;
  readonly contextBuilder: IContextBuilder;
  readonly claudeMdManager: IClaudeMdManager;
  readonly claudeCliRunner: IClaudeCliRunner | null;
  readonly reflexionEngine: IReflexionEngine | null;
  readonly projectScanner: IProjectScanner;
  readonly memorySeeder: IMemorySeeder;
  readonly userProfileManager: IUserProfileManager;
  readonly scheduler: IScheduler;
  readonly lockManager: ILockManager;
  readonly healthCalculator: IHealthCalculator;
  readonly triggerEngine: ITriggerEngine;
  readonly branchManager: IBranchManager;
  readonly specStore: ISpecStore;
  readonly taskStore: ITaskStore;
  readonly commentStore: CommentStore;
  readonly taskLinkStore: TaskLinkStore;

  constructor(projectRoot: string, options: CtxcoreOptions = {}) {
    this.config = resolveConfig(projectRoot);

    const specsDir = join(this.config.projectRoot, '.ctxcore', 'specs');
    const metaDir = join(specsDir, '.meta');
    if (!existsSync(metaDir)) {
      mkdirSync(metaDir, { recursive: true });
    }

    this.db = options.db ?? createDatabase(this.config.dbPath);
    createVecTable(this.db, this.config.embedding.dimensions);

    this.memoryStore = options.memoryStore ?? new MemoryStore(this.db);

    this.embeddingClient =
      options.embeddingClient ??
      new OllamaEmbeddingClient(this.config.ollamaUrl, this.config.ollamaModel);

    this.embeddingStore = options.embeddingStore ?? new SqliteEmbeddingStore(this.db);

    const scoring = options.scoringStrategy ?? new DefaultScoringStrategy();

    this.retrievalEngine =
      options.retrievalEngine ??
      new RetrievalEngine(this.memoryStore, this.embeddingStore, this.embeddingClient, scoring);

    this.decayEngine = options.decayEngine ?? new DecayEngine(this.config);
    this.importanceClassifier = options.importanceClassifier ?? new ImportanceClassifier();
    this.promotionEngine = options.promotionEngine ?? new PromotionEngine();
    this.contextBuilder = options.contextBuilder ?? new ContextBuilder(this.memoryStore);
    this.claudeMdManager = options.claudeMdManager ?? new ClaudeMdManager(this.contextBuilder);

    if (options.claudeCliRunner) {
      this.claudeCliRunner = options.claudeCliRunner;
    } else if (this.config.claudeCliPath) {
      this.claudeCliRunner = new ClaudeCliRunner(this.config.claudeCliPath);
    } else {
      this.claudeCliRunner = null;
    }

    if (options.reflexionEngine) {
      this.reflexionEngine = options.reflexionEngine;
    } else if (this.claudeCliRunner) {
      this.reflexionEngine = new ReflexionEngine(this.claudeCliRunner);
    } else {
      this.reflexionEngine = null;
    }

    this.projectScanner = options.projectScanner ?? new ProjectScanner();
    this.memorySeeder = options.memorySeeder ?? new MemorySeeder();

    if (options.userProfileManager) {
      this.userProfileManager = options.userProfileManager;
    } else {
      const profileDbPath = options.userProfileDbPath ?? join(homedir(), '.ctxcore', 'user_profile.db');
      const profileDb = createProfileDatabase(profileDbPath);
      this.userProfileManager = new UserProfileManager(profileDb);
    }

    this.scheduler = options.scheduler ?? new Scheduler();
    this.lockManager = options.lockManager ?? new LockManager();
    this.healthCalculator = options.healthCalculator ?? new HealthCalculator();
    this.triggerEngine = options.triggerEngine ?? new TriggerEngine();
    this.branchManager = options.branchManager ?? new BranchManager();
    this.specStore = options.specStore ?? new SpecStore(this.config.projectRoot);
    this.taskStore = options.taskStore ?? new TaskStore(this.db);
    this.commentStore = options.commentStore ?? new CommentStore(this.db);
    this.taskLinkStore = options.taskLinkStore ?? new TaskLinkStore(this.db);
  }

  /**
   * Create an instance with graceful degradation.
   * Tries: Transformers.js -> Ollama -> NullClient (keyword-only).
   */
  static async create(projectRoot: string, options: CtxcoreOptions = {}): Promise<Ctxcore> {
    if (options.embeddingClient) {
      return new Ctxcore(projectRoot, options);
    }

    const config = resolveConfig(projectRoot);
    const { client, dimensions } = await createEmbeddingClient({
      provider: config.embeddingProvider ?? 'auto',
      ollamaUrl: config.ollamaUrl,
      ollamaModel: config.ollamaModel,
    });

    return new Ctxcore(projectRoot, { ...options, embeddingClient: client });
  }

  close(): void {
    this.db.close();
  }
}
