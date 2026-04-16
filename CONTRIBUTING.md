# Contributing to ctxcore

Thanks for your interest in ctxcore. This guide gets you up and running locally.

## Quick setup

```bash
git clone https://github.com/startfast-ai/ctxcore.git
cd ctxcore
npm install
npm run build
npm test
```

You should see **511 tests passing** across 34 test files in about a second.

## Running against a test project

```bash
# Build first
npm run build

# Link the binary globally so you can invoke it as `ctxcore`
npm link

# In another project
cd ~/some-project
ctxcore init
```

## Test suites

| Command | What it runs | Requires |
|---|---|---|
| `npm test` | All unit + fast e2e tests | Nothing |
| `npm run test:unit` | Unit tests only | Nothing |
| `npm run test:e2e` | Fast e2e (mock embeddings) | Nothing |
| `npm run test:live` | Live AI tests hitting real Claude CLI, Transformers.js, Ollama | Claude CLI + internet |
| `npm run test:watch` | Watch mode | Nothing |

Live tests are excluded from the default `npm test` run. Enable them with `CTXCORE_LIVE_TESTS=1` (the `test:live` script does this for you).

## Code style

- TypeScript strict mode, ESM only
- No emojis in code or output unless explicitly requested
- Prefer editing existing files over creating new ones
- Add only what's asked — no speculative abstractions
- Validate only at system boundaries

Run `npm run lint` and `npm run typecheck` before opening a PR.

## Architecture

Read [docs/architecture.md](docs/architecture.md) first. Key modules:

- `src/memory-store.ts` — memory CRUD, events, connections
- `src/embeddings/` — pluggable provider (Transformers.js / Ollama / Null)
- `src/retrieval.ts` — hybrid semantic + keyword search with scoring
- `src/reflexion.ts` — consolidation, contradictions, patterns, recalibration
- `src/health.ts` — intelligence score calculation
- `src/scheduler.ts` — launchd/cron + background staleness guard
- `bin/ctxcore.ts` — CLI entry point (commander)

## Pull requests

1. Fork and create a feature branch
2. Write tests first when possible
3. Run `npm test` — all 511 tests must pass
4. Use descriptive commit messages (see [recent commits](https://github.com/startfast-ai/ctxcore/commits/main) for style)
5. Open the PR with a clear description of *why* the change is needed

## Reporting bugs

Open an issue with:

- `ctxcore --version`
- Output of `ctxcore doctor`
- Minimal reproduction steps
- Expected vs. actual behavior

## Ideas and discussion

For larger design discussions, open an issue tagged `discussion` before writing code. Ctxcore tries to stay minimal and opinionated — let's agree on the "why" before the "how".
