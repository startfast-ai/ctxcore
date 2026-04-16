import { describe, it, expect } from 'vitest';
import { ImportanceClassifier } from '../../src/importance.js';

describe('ImportanceClassifier', () => {
  const classifier = new ImportanceClassifier();

  describe('routine classification', () => {
    it('classifies formatting changes as routine', () => {
      const result = classifier.classify('Renamed variable foo to bar');
      expect(result.level).toBe('routine');
      expect(result.score).toBeGreaterThanOrEqual(0.1);
      expect(result.score).toBeLessThanOrEqual(0.3);
    });

    it('classifies minor edits as routine', () => {
      const result = classifier.classify('Minor cleanup of whitespace and formatting');
      expect(result.level).toBe('routine');
    });

    it('classifies lint fixes as routine', () => {
      const result = classifier.classify('Trivial lint cleanup, reformatted whitespace');
      expect(result.level).toBe('routine');
    });
  });

  describe('operational classification', () => {
    it('classifies bug fixes as operational', () => {
      const result = classifier.classify('Fixed timeout bug by adding retry logic');
      expect(result.level).toBe('operational');
      expect(result.score).toBeGreaterThanOrEqual(0.3);
      expect(result.score).toBeLessThanOrEqual(0.6);
    });

    it('classifies feature implementations as operational', () => {
      const result = classifier.classify('Implemented user authentication with JWT tokens');
      expect(result.level).toBe('operational');
    });

    it('classifies configuration changes as operational', () => {
      const result = classifier.classify('Configured retry fallback for the API timeout handler');
      expect(result.level).toBe('operational');
    });
  });

  describe('decision classification', () => {
    it('classifies architecture decisions', () => {
      const result = classifier.classify(
        'Chose PostgreSQL over MongoDB because we need ACID transactions for the payment system',
      );
      expect(result.level).toBe('decision');
      expect(result.score).toBeGreaterThanOrEqual(0.6);
      expect(result.score).toBeLessThanOrEqual(0.8);
    });

    it('classifies library selections', () => {
      const result = classifier.classify(
        'Decided to use Vitest instead of Jest for the migration to ESM',
      );
      expect(result.level).toBe('decision');
    });

    it('classifies strategic choices', () => {
      const result = classifier.classify(
        'Selected event sourcing architecture for the audit trail strategy',
      );
      expect(result.level).toBe('decision');
    });
  });

  describe('breakthrough classification', () => {
    it('classifies root cause discoveries', () => {
      const result = classifier.classify(
        'Discovered the root cause of the memory leak: unclosed database connection pool on SIGTERM',
      );
      expect(result.level).toBe('breakthrough');
      expect(result.score).toBeGreaterThanOrEqual(0.8);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('classifies key insights', () => {
      const result = classifier.classify(
        'Key insight: the actual reason for slow queries was the missing index on created_at',
      );
      expect(result.level).toBe('breakthrough');
    });

    it('classifies eureka moments', () => {
      const result = classifier.classify(
        'Finally found the underlying problem — turns out the connection was being shared across threads',
      );
      expect(result.level).toBe('breakthrough');
    });
  });

  describe('edge cases', () => {
    it('returns routine with base score for empty content', () => {
      const result = classifier.classify('');
      expect(result.level).toBe('routine');
      expect(result.score).toBeGreaterThanOrEqual(0.1);
      expect(result.score).toBeLessThanOrEqual(0.3);
    });

    it('returns routine with base score for generic content', () => {
      const result = classifier.classify('Hello world');
      expect(result.level).toBe('routine');
    });

    it('score is always between 0 and 1', () => {
      const samples = [
        'simple note',
        'Fixed a bug in the auth module',
        'Chose React over Vue for the frontend architecture migration strategy',
        'Discovered the root cause breakthrough: realized the fundamental underlying problem',
      ];

      for (const sample of samples) {
        const result = classifier.classify(sample);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });
  });
});
