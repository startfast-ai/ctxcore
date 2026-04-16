import { describe, it, expect } from 'vitest';
import { detectClaudeCli } from '../../src/claude-cli.js';

describe('Claude CLI Detection', () => {
  it('returns a string or null', () => {
    const result = detectClaudeCli();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
