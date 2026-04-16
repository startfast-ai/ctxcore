import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  IUserProfileManager,
  UserPreference,
  PreferenceCategory,
  PreferenceScope,
  PreferenceSignal,
  PreferenceListOptions,
} from './types.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS preferences (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK(category IN ('communication', 'technical', 'workflow', 'tooling', 'code-style')),
    content TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.3,
    observation_count INTEGER NOT NULL DEFAULT 1,
    scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'project')),
    project_root TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_preferences_category ON preferences(category);
  CREATE INDEX IF NOT EXISTS idx_preferences_scope ON preferences(scope);
  CREATE INDEX IF NOT EXISTS idx_preferences_project ON preferences(project_root);
`;

/** Patterns that indicate a user correction or explicit preference. */
const CORRECTION_PATTERNS: { pattern: RegExp; confidenceOverride: number; extractGroup: number }[] = [
  { pattern: /\bno[,.]?\s+i\s+meant\s+(.+)/i, confidenceOverride: 0.85, extractGroup: 1 },
  { pattern: /\bdon['']?t\s+(?:ever\s+)?(?:do|use|add|include|put)\s+(.+)/i, confidenceOverride: 0.8, extractGroup: 1 },
  { pattern: /\bi\s+prefer\s+(.+)/i, confidenceOverride: 0.9, extractGroup: 1 },
  { pattern: /\balways\s+use\s+(.+)/i, confidenceOverride: 0.9, extractGroup: 1 },
  { pattern: /\bnever\s+use\s+(.+)/i, confidenceOverride: 0.9, extractGroup: 1 },
  { pattern: /\bplease\s+(?:always|never)\s+(.+)/i, confidenceOverride: 0.85, extractGroup: 1 },
  { pattern: /\bi\s+(?:always|never)\s+want\s+(.+)/i, confidenceOverride: 0.9, extractGroup: 1 },
  { pattern: /\bstop\s+(?:using|doing|adding)\s+(.+)/i, confidenceOverride: 0.8, extractGroup: 1 },
];

/** Simple keyword-based category classification. */
const CATEGORY_SIGNALS: { category: PreferenceCategory; keywords: RegExp }[] = [
  { category: 'code-style', keywords: /\b(?:indent|tabs?|spaces?|semicolons?|quotes?|naming|camelCase|snake_case|format|lint|prettier|eslint|style)\b/i },
  { category: 'tooling', keywords: /\b(?:vim|vscode|editor|ide|terminal|shell|zsh|bash|git|docker|npm|yarn|pnpm|brew|homebrew)\b/i },
  { category: 'technical', keywords: /\b(?:typescript|javascript|python|rust|sql|orm|database|api|framework|library|react|vue|angular|node)\b/i },
  { category: 'workflow', keywords: /\b(?:commit|branch|pr|review|test|deploy|ci|cd|pipeline|merge|rebase|workflow)\b/i },
  { category: 'communication', keywords: /\b(?:verbose|brief|concise|detailed|explain|comment|document|summary|tone|language)\b/i },
];

function classifyCategory(content: string): PreferenceCategory {
  for (const signal of CATEGORY_SIGNALS) {
    if (signal.keywords.test(content)) {
      return signal.category;
    }
  }
  return 'workflow'; // default fallback
}

function rowToPreference(row: Record<string, unknown>): UserPreference {
  return {
    id: row.id as string,
    category: row.category as PreferenceCategory,
    content: row.content as string,
    confidence: row.confidence as number,
    observationCount: row.observation_count as number,
    scope: row.scope as PreferenceScope,
    projectRoot: row.project_root as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Compute the confidence after N observations.
 * First observation = 0.3, each subsequent adds 0.15, cap at 0.95.
 */
export function computeConfidenceForObservations(count: number): number {
  if (count <= 0) return 0;
  const base = 0.3;
  const increment = 0.15;
  const raw = base + (count - 1) * increment;
  return Math.min(0.95, raw);
}

export function createProfileDatabase(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

export class UserProfileManager implements IUserProfileManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    // Ensure schema exists (idempotent)
    this.db.exec(SCHEMA);
  }

  addPreference(pref: {
    category: PreferenceCategory;
    content: string;
    confidence?: number;
    scope?: PreferenceScope;
    projectRoot?: string;
  }): UserPreference {
    const id = randomUUID();
    const confidence = pref.confidence ?? 0.3;
    const scope = pref.scope ?? 'global';
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO preferences (id, category, content, confidence, observation_count, scope, project_root, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(id, pref.category, pref.content, confidence, scope, pref.projectRoot ?? null, now, now);

    return {
      id,
      category: pref.category,
      content: pref.content,
      confidence,
      observationCount: 1,
      scope,
      projectRoot: pref.projectRoot,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  getPreferences(options?: PreferenceListOptions): UserPreference[] {
    let sql = 'SELECT * FROM preferences WHERE 1=1';
    const params: unknown[] = [];

    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }
    if (options?.scope) {
      sql += ' AND scope = ?';
      params.push(options.scope);
    }
    if (options?.projectRoot) {
      // Return global preferences and project-specific ones for this project
      sql += ' AND (scope = ? OR project_root = ?)';
      params.push('global', options.projectRoot);
    }
    if (options?.minConfidence !== undefined) {
      sql += ' AND confidence >= ?';
      params.push(options.minConfidence);
    }

    sql += ' ORDER BY confidence DESC, updated_at DESC';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToPreference);
  }

  /**
   * Returns preferences for a given projectRoot, resolving conflicts
   * so that project-scoped preferences override global ones with similar content.
   */
  getEffectivePreferences(projectRoot: string): UserPreference[] {
    const all = this.getPreferences({ projectRoot });

    // Separate by scope
    const projectPrefs = all.filter((p) => p.scope === 'project' && p.projectRoot === projectRoot);
    const globalPrefs = all.filter((p) => p.scope === 'global');

    // Project preferences win on same-category conflicts
    const projectCategories = new Set(projectPrefs.map((p) => `${p.category}:${p.content.toLowerCase().trim()}`));

    const effectiveGlobal = globalPrefs.filter((p) => {
      const key = `${p.category}:${p.content.toLowerCase().trim()}`;
      return !projectCategories.has(key);
    });

    return [...projectPrefs, ...effectiveGlobal];
  }

  updateConfidence(id: string): UserPreference | null {
    const existing = this.db.prepare('SELECT * FROM preferences WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return null;

    const newCount = (existing.observation_count as number) + 1;
    const newConfidence = computeConfidenceForObservations(newCount);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE preferences SET observation_count = ?, confidence = ?, updated_at = ? WHERE id = ?
    `).run(newCount, newConfidence, now, id);

    return {
      ...rowToPreference(existing),
      observationCount: newCount,
      confidence: newConfidence,
      updatedAt: new Date(now),
    };
  }

  forgetPreference(id: string): boolean {
    const result = this.db.prepare('DELETE FROM preferences WHERE id = ?').run(id);
    return result.changes > 0;
  }

  detectCorrections(text: string): PreferenceSignal[] {
    const signals: PreferenceSignal[] = [];

    for (const { pattern, confidenceOverride, extractGroup } of CORRECTION_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[extractGroup]) {
        const content = match[extractGroup].trim().replace(/[.!?]+$/, '');
        if (content.length > 0) {
          signals.push({
            content,
            confidence: confidenceOverride,
            category: classifyCategory(content),
          });
        }
      }
    }

    return signals;
  }

  close(): void {
    this.db.close();
  }
}
