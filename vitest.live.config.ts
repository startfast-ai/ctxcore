import { defineConfig } from 'vitest/config';

/**
 * Config for live AI tests that require real services.
 *
 * Run with:
 *   CTXCORE_LIVE_TESTS=1 npm run test:live
 *
 * Prerequisites:
 *   - Claude CLI installed and authenticated
 *   - Ollama running (optional, for Ollama-specific tests)
 *   - Internet access (for Transformers.js model download)
 */
export default defineConfig({
  test: {
    globals: true,
    testTimeout: 180_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,  // Sequential — avoid parallel AI calls
      },
    },
    include: ['tests/e2e-manual/**/*.test.ts'],
  },
});
