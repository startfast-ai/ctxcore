# Architecture

## What ctxcore is

ctxcore is a **persistent memory system** for Claude Code. It runs as an MCP server next to your editor, keeps a single-file SQLite database per project, and uses a local embedding model so Claude gets project-grounded answers without re-explaining context every session.

## System overview

```
┌─────────────────────────────────────────────────────┐
│ Claude Code                                         │
│                                                     │
│   CLAUDE.md (static)        MCP tools (dynamic)     │
│   ┌──────────────────┐      ┌────────────────────┐  │
│   │ memory protocol  │      │ memory_context()    │  │
│   │ seeded knowledge │      │ memory_search(q)    │  │
│   │ active triggers  │      │ memory_store(c)     │  │
│   └────────┬─────────┘      │ memory_reflect()    │  │
│            │                └──────────┬──────────┘  │
└────────────┼───────────────────────────┼─────────────┘
             │                           │
             └─────────┬─────────────────┘
                       ▼
           ┌───────────────────────────┐
           │  ctxcore server (MCP)     │
           └───────────┬───────────────┘
                       │
     ┌─────────────────┼─────────────────┐
     ▼                 ▼                 ▼
┌──────────┐    ┌─────────────┐    ┌─────────────┐
│ SQLite   │    │ Transformers│    │ Claude CLI  │
│ memory + │    │ .js (local) │    │ (reflexion) │
│ vec index│    │ or Ollama   │    │ subprocess  │
└──────────┘    └─────────────┘    └─────────────┘
```

Everything runs locally. No external services, no telemetry, no API keys required for core functionality. Claude CLI is only invoked for reflexion and `ctxcore ask`.

## Memory model

### Three tiers

| Tier | Half-life | Typical content |
|---|---|---|
| Short-term | hours | Current session, working notes, debug state |
| Operational | weeks | Active project knowledge, recent fixes |
| Long-term | months | Architecture decisions, core conventions |

Memories promote upward when frequently accessed and demote / archive when they fall below a relevance threshold. **Nothing is ever hard-deleted** — archived memories remain in the database and can be recovered.

### Importance classification

Every new memory gets an automatic importance score (0.0-1.0) based on content signals. The classifier looks at verbs, context markers, and keyword patterns.

| Level | Score | Signals |
|---|---|---|
| Routine | 0.1-0.3 | Rename, reformat, minor edit |
| Operational | 0.3-0.6 | Fix, implement, refactor |
| Decision | 0.6-0.8 | Chose, decided, architecture |
| Breakthrough | 0.8-1.0 | Root cause, discovered, insight |

Importance is a **decay shield** — high-importance memories lose actuality more slowly.

### Decay formula

```
decay_rate = base_decay × (1 − importance × 0.7)
actuality  = actuality × (decay_rate ^ hours_since_last_access)
score      = similarity × actuality × (1 + importance) + graph_boost
```

A memory with importance 0.9 and a memory with importance 0.1 can both be a year old — the first will still score high, the second will have faded to near-zero.

### Knowledge graph

Memories connect through typed edges: `causal`, `contradicts`, `supports`, `temporal`, `similar`. Edges are created by reflexion (see below) or explicitly by tools like `memory_decide`. Connected memories receive a graph boost during retrieval so related context surfaces together.

## Retrieval

Search is **hybrid**: semantic (vector) + keyword, combined with a scoring strategy.

1. Query is embedded with the configured provider (Transformers.js or Ollama).
2. sqlite-vec finds the nearest stored vectors by L2 distance.
3. Distance is converted to cosine similarity: `1 − (d² / 2)`.
4. Keyword search runs in parallel against memory content.
5. Results merge: memories matching both searches get a 1.2× boost and are tagged `hybrid`.
6. Final score = similarity × actuality × (1 + importance) + graph boost.

Archived memories are excluded unless explicitly requested.

## Reflexion

Between sessions — or on demand via `ctxcore reflect` — a reflexion cycle runs. It uses Claude CLI as a reasoning engine over ctxcore's own knowledge.

Four modes, each with its own prompt:

| Mode | What it looks for | Action |
|---|---|---|
| Consolidation | Duplicate or overlapping memories | `merge` — combine into one |
| Contradiction | Conflicting claims | `create-connection` with type `contradicts` |
| Pattern | Recurring themes or bug clusters | `tag-memory` with pattern label |
| Recalibration | Mis-sized importance scores | `update-importance` with new value |

A daily launchd agent runs reflexion at 2:23 AM on macOS (crontab on Linux). If the machine was asleep, launchd catches up on wake. A staleness guard on every `ctxcore` command silently triggers a background reflexion if nothing has run in 24 hours.

## Intelligence score

A single 0-100 number summarising how well ctxcore understands the project. Four equally-weighted dimensions:

| Dimension | Measures |
|---|---|
| Depth | Tier-weighted memory count × importance |
| Freshness | Importance-weighted average actuality |
| Coherence | Number of memories with graph connections (log scale) |
| Coverage | Memory count (log scale) + tag diversity |

The score is recorded after `init`, `reflect`, and sessions. `ctxcore history` shows the timeline. A rising trend means your project is accumulating and refining knowledge; a declining one means memories are going stale faster than they're being replaced or reinforced.

## Storage

A single file at `<project>/.memory.db`. Contains:

- `memories` — content, tier, importance, actuality, tags, metadata, timestamps
- `connections` — typed edges between memories with strength
- `memory_events` — audit trail (created, accessed, promoted, decayed, etc.)
- `memory_embeddings` — sqlite-vec virtual table with vector index
- `intelligence_history` — score timeline for trend detection
- `reflexions` — record of every reflexion cycle
- `tasks`, `task_comments`, `task_memory_links`, `task_spec_links` — optional task tracking
- `kanban_columns` — task board state

Schema versioning is automatic via `src/migrations.ts`. Every `ctxcore` invocation checks the schema version and applies pending migrations inside a transaction.

## Configuration layers

Three layers, merged in order (later overrides earlier):

1. `DEFAULT_CONFIG` in `src/types.ts` — sensible defaults
2. `~/.ctxcore/config.json` — user-global settings (Ollama URL, Claude CLI path)
3. `<project>/.ctxcore.json` — project-specific (embedding model, DB path, decay rates)

See [configuration.md](configuration.md) for the full schema.

## Embedding providers

A pluggable interface — any provider that produces a `Float32Array` per text works. Three built-ins:

| Provider | When | Notes |
|---|---|---|
| Transformers.js | Default | Runs ONNX locally. No daemon. Model downloads on first init. |
| Ollama | Opt-in | `ollama pull qwen3-embedding:0.6b` then set `embeddingProvider: "ollama"` |
| Null | Fallback | No embeddings. Search falls back to keyword-only. |

Auto-resolution tries Transformers.js first, then Ollama, then Null.

## Integration surface

Five ways ctxcore reaches Claude Code:

1. **MCP server** (`.mcp.json`) — registers `memory_*` tools
2. **CLAUDE.md patch** — injects memory protocol and project context between `<!-- ctxcore:start -->` markers
3. **`.claude/settings.json` hooks** — SessionStart, Stop, PreToolUse for auto-allow, UserPromptSubmit for correction detection, Pre/PostCompact for memory preservation
4. **Auto memory sync** — writes to `~/.claude/projects/<path>/memory/` so Claude sees ctxcore knowledge as its own notes
5. **Git hooks** (optional) — `post-commit` triggers reflexion, `post-merge` triggers incremental rescan

Uninstall reverses all five cleanly.

## Reference

- [CLI commands](cli.md)
- [MCP tools](mcp.md)
- [Configuration](configuration.md)
