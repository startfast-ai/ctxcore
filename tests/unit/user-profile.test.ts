import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { UserProfileManager, computeConfidenceForObservations } from '../../src/user-profile.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('UserProfileManager', () => {
  let db: Database.Database;
  let manager: UserProfileManager;

  beforeEach(() => {
    db = createTestDb();
    manager = new UserProfileManager(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Confidence scoring math ──

  describe('confidence scoring', () => {
    it('first observation starts at 0.3', () => {
      expect(computeConfidenceForObservations(1)).toBeCloseTo(0.3, 5);
    });

    it('grows by 0.15 per additional observation', () => {
      expect(computeConfidenceForObservations(2)).toBeCloseTo(0.45, 5);
      expect(computeConfidenceForObservations(3)).toBeCloseTo(0.60, 5);
      expect(computeConfidenceForObservations(4)).toBeCloseTo(0.75, 5);
    });

    it('caps at 0.95', () => {
      expect(computeConfidenceForObservations(10)).toBe(0.95);
      expect(computeConfidenceForObservations(100)).toBe(0.95);
    });

    it('returns 0 for zero or negative count', () => {
      expect(computeConfidenceForObservations(0)).toBe(0);
      expect(computeConfidenceForObservations(-1)).toBe(0);
    });

    it('updateConfidence increases observation count and confidence', () => {
      const pref = manager.addPreference({
        category: 'technical',
        content: 'Prefer TypeScript',
      });

      expect(pref.confidence).toBeCloseTo(0.3, 5);
      expect(pref.observationCount).toBe(1);

      const updated = manager.updateConfidence(pref.id);
      expect(updated).not.toBeNull();
      expect(updated!.observationCount).toBe(2);
      expect(updated!.confidence).toBeCloseTo(0.45, 5);

      const updated2 = manager.updateConfidence(pref.id);
      expect(updated2!.observationCount).toBe(3);
      expect(updated2!.confidence).toBeCloseTo(0.60, 5);
    });

    it('updateConfidence returns null for nonexistent id', () => {
      expect(manager.updateConfidence('nonexistent')).toBeNull();
    });

    it('explicit preference gets confidence 0.9', () => {
      const pref = manager.addPreference({
        category: 'code-style',
        content: 'Use tabs not spaces',
        confidence: 0.9,
      });
      expect(pref.confidence).toBeCloseTo(0.9, 5);
    });
  });

  // ── Correction detection ──

  describe('correction detection', () => {
    it('detects "I prefer X" pattern', () => {
      const signals = manager.detectCorrections('I prefer using raw SQL over ORMs');
      expect(signals.length).toBe(1);
      expect(signals[0].content).toBe('using raw SQL over ORMs');
      expect(signals[0].confidence).toBe(0.9);
    });

    it('detects "No, I meant X" pattern', () => {
      const signals = manager.detectCorrections('No, I meant the other approach');
      expect(signals.length).toBe(1);
      expect(signals[0].content).toBe('the other approach');
      expect(signals[0].confidence).toBe(0.85);
    });

    it('detects "Always use X" pattern', () => {
      const signals = manager.detectCorrections('Always use TypeScript for new projects');
      expect(signals.length).toBe(1);
      expect(signals[0].content).toBe('TypeScript for new projects');
      expect(signals[0].confidence).toBe(0.9);
    });

    it('detects "Never use X" pattern', () => {
      const signals = manager.detectCorrections('Never use var in JavaScript');
      expect(signals.length).toBe(1);
      expect(signals[0].content).toBe('var in JavaScript');
      expect(signals[0].confidence).toBe(0.9);
    });

    it('detects "Don\'t do X" pattern', () => {
      const signals = manager.detectCorrections("Don't use semicolons in TypeScript");
      expect(signals.length).toBe(1);
      expect(signals[0].content).toBe('semicolons in TypeScript');
      expect(signals[0].confidence).toBe(0.8);
    });

    it('detects "Stop using X" pattern', () => {
      const signals = manager.detectCorrections('Stop using console.log for debugging');
      expect(signals.length).toBe(1);
      expect(signals[0].content).toBe('console.log for debugging');
      expect(signals[0].confidence).toBe(0.8);
    });

    it('returns empty array when no corrections detected', () => {
      const signals = manager.detectCorrections('This is a normal sentence with no preferences.');
      expect(signals).toEqual([]);
    });

    it('strips trailing punctuation from extracted content', () => {
      const signals = manager.detectCorrections('I prefer tabs!');
      expect(signals.length).toBe(1);
      expect(signals[0].content).toBe('tabs');
    });
  });

  // ── Category classification ──

  describe('category classification', () => {
    it('classifies code-style signals', () => {
      const signals = manager.detectCorrections('I prefer tabs over spaces');
      expect(signals[0].category).toBe('code-style');
    });

    it('classifies tooling signals', () => {
      const signals = manager.detectCorrections('Always use vim for editing');
      expect(signals[0].category).toBe('tooling');
    });

    it('classifies technical signals', () => {
      const signals = manager.detectCorrections('I prefer TypeScript over JavaScript');
      expect(signals[0].category).toBe('technical');
    });

    it('classifies workflow signals', () => {
      const signals = manager.detectCorrections('Always use rebase instead of merge');
      expect(signals[0].category).toBe('workflow');
    });

    it('classifies communication signals', () => {
      const signals = manager.detectCorrections('I prefer concise explanations');
      expect(signals[0].category).toBe('communication');
    });

    it('defaults to workflow for unrecognized content', () => {
      const signals = manager.detectCorrections('I prefer bananas');
      expect(signals[0].category).toBe('workflow');
    });
  });

  // ── Add and forget preferences ──

  describe('add and forget preferences', () => {
    it('adds a preference with default scope global', () => {
      const pref = manager.addPreference({
        category: 'technical',
        content: 'Use PostgreSQL',
      });

      expect(pref.id).toBeTruthy();
      expect(pref.category).toBe('technical');
      expect(pref.content).toBe('Use PostgreSQL');
      expect(pref.scope).toBe('global');
      expect(pref.observationCount).toBe(1);
      expect(pref.createdAt).toBeInstanceOf(Date);
      expect(pref.updatedAt).toBeInstanceOf(Date);
    });

    it('adds a project-scoped preference', () => {
      const pref = manager.addPreference({
        category: 'code-style',
        content: 'Use 4-space indentation',
        scope: 'project',
        projectRoot: '/my/project',
      });

      expect(pref.scope).toBe('project');
      expect(pref.projectRoot).toBe('/my/project');
    });

    it('lists all preferences', () => {
      manager.addPreference({ category: 'technical', content: 'A' });
      manager.addPreference({ category: 'workflow', content: 'B' });

      const all = manager.getPreferences();
      expect(all.length).toBe(2);
    });

    it('filters by category', () => {
      manager.addPreference({ category: 'technical', content: 'A' });
      manager.addPreference({ category: 'workflow', content: 'B' });

      const techOnly = manager.getPreferences({ category: 'technical' });
      expect(techOnly.length).toBe(1);
      expect(techOnly[0].content).toBe('A');
    });

    it('filters by minimum confidence', () => {
      manager.addPreference({ category: 'technical', content: 'Low', confidence: 0.2 });
      manager.addPreference({ category: 'technical', content: 'High', confidence: 0.9 });

      const highOnly = manager.getPreferences({ minConfidence: 0.5 });
      expect(highOnly.length).toBe(1);
      expect(highOnly[0].content).toBe('High');
    });

    it('forgets a preference', () => {
      const pref = manager.addPreference({ category: 'technical', content: 'A' });
      expect(manager.forgetPreference(pref.id)).toBe(true);

      const all = manager.getPreferences();
      expect(all.length).toBe(0);
    });

    it('returns false when forgetting nonexistent id', () => {
      expect(manager.forgetPreference('nonexistent')).toBe(false);
    });
  });

  // ── Project-scoped override beats global ──

  describe('project-scoped override', () => {
    it('getEffectivePreferences returns project preference over matching global', () => {
      manager.addPreference({
        category: 'code-style',
        content: '2-space indentation',
        scope: 'global',
      });

      manager.addPreference({
        category: 'code-style',
        content: '4-space indentation',
        scope: 'project',
        projectRoot: '/my/project',
      });

      const effective = manager.getEffectivePreferences('/my/project');

      // Both should appear since they have different content
      const contents = effective.map((p) => p.content);
      expect(contents).toContain('4-space indentation');
      expect(contents).toContain('2-space indentation');
    });

    it('project preference with same content shadows global', () => {
      manager.addPreference({
        category: 'code-style',
        content: 'use tabs',
        scope: 'global',
      });

      manager.addPreference({
        category: 'code-style',
        content: 'use tabs',
        scope: 'project',
        projectRoot: '/my/project',
      });

      const effective = manager.getEffectivePreferences('/my/project');

      // Only the project-scoped one should appear (global is shadowed)
      const tabPrefs = effective.filter((p) => p.content === 'use tabs');
      expect(tabPrefs.length).toBe(1);
      expect(tabPrefs[0].scope).toBe('project');
    });

    it('global preferences appear when no project override exists', () => {
      manager.addPreference({
        category: 'technical',
        content: 'Use TypeScript',
        scope: 'global',
      });

      const effective = manager.getEffectivePreferences('/other/project');
      expect(effective.length).toBe(1);
      expect(effective[0].content).toBe('Use TypeScript');
      expect(effective[0].scope).toBe('global');
    });

    it('project preferences from other projects do not appear', () => {
      manager.addPreference({
        category: 'code-style',
        content: 'use tabs',
        scope: 'project',
        projectRoot: '/other/project',
      });

      const effective = manager.getEffectivePreferences('/my/project');
      expect(effective.length).toBe(0);
    });
  });
});
