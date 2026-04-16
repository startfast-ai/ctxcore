import { describe, it, expect } from 'vitest';
import {
  buildConsolidationPrompt,
  buildContradictionPrompt,
  buildPatternPrompt,
  buildRecalibrationPrompt,
} from '../../src/reflexion-prompts.js';
import type { Memory } from '../../src/types.js';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    content: 'Chose PostgreSQL over MongoDB for ACID compliance',
    tier: 'operational',
    importance: 0.7,
    actuality: 0.9,
    embedding: null,
    tags: ['database'],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date(),
    accessCount: 1,
    archived: false,
    ...overrides,
  };
}

describe('Reflexion Prompts', () => {
  const memories: Memory[] = [
    makeMemory({ id: 'mem-1', content: 'Chose PostgreSQL over MongoDB for ACID compliance' }),
    makeMemory({
      id: 'mem-2',
      content: 'Fixed authentication timeout by adding retry logic',
      importance: 0.5,
    }),
  ];

  describe('buildConsolidationPrompt', () => {
    it('includes memory content in the prompt', () => {
      const prompt = buildConsolidationPrompt(memories);
      expect(prompt).toContain('PostgreSQL');
      expect(prompt).toContain('authentication timeout');
    });

    it('includes memory IDs', () => {
      const prompt = buildConsolidationPrompt(memories);
      expect(prompt).toContain('mem-1');
      expect(prompt).toContain('mem-2');
    });

    it('requests JSON output format', () => {
      const prompt = buildConsolidationPrompt(memories);
      expect(prompt).toContain('JSON');
    });

    it('mentions merge action', () => {
      const prompt = buildConsolidationPrompt(memories);
      expect(prompt).toContain('merge');
    });
  });

  describe('buildContradictionPrompt', () => {
    it('includes memory content in the prompt', () => {
      const prompt = buildContradictionPrompt(memories);
      expect(prompt).toContain('PostgreSQL');
      expect(prompt).toContain('authentication timeout');
    });

    it('requests JSON output format', () => {
      const prompt = buildContradictionPrompt(memories);
      expect(prompt).toContain('JSON');
    });

    it('mentions contradiction detection', () => {
      const prompt = buildContradictionPrompt(memories);
      expect(prompt).toContain('contradict');
    });
  });

  describe('buildPatternPrompt', () => {
    it('includes memory content in the prompt', () => {
      const prompt = buildPatternPrompt(memories);
      expect(prompt).toContain('PostgreSQL');
      expect(prompt).toContain('authentication timeout');
    });

    it('requests JSON output format', () => {
      const prompt = buildPatternPrompt(memories);
      expect(prompt).toContain('JSON');
    });

    it('mentions pattern recognition', () => {
      const prompt = buildPatternPrompt(memories);
      expect(prompt).toContain('pattern');
    });
  });

  describe('buildRecalibrationPrompt', () => {
    it('includes memory content and importance scores', () => {
      const prompt = buildRecalibrationPrompt(memories);
      expect(prompt).toContain('PostgreSQL');
      expect(prompt).toContain('0.70');
      expect(prompt).toContain('0.50');
    });

    it('requests JSON output format', () => {
      const prompt = buildRecalibrationPrompt(memories);
      expect(prompt).toContain('JSON');
    });

    it('mentions importance recalibration', () => {
      const prompt = buildRecalibrationPrompt(memories);
      expect(prompt).toContain('importance');
    });
  });

  describe('memory serialization', () => {
    it('includes tier information', () => {
      const prompt = buildConsolidationPrompt(memories);
      expect(prompt).toContain('tier: operational');
    });

    it('includes actuality information', () => {
      const prompt = buildConsolidationPrompt(memories);
      expect(prompt).toContain('actuality: 0.90');
    });
  });
});
