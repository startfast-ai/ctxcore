# Configuration

ctxcore reads configuration from three layers, merged in order:

1. **Defaults** (baked into the binary)
2. **Global** — `~/.ctxcore/config.json`
3. **Project** — `<project>/.ctxcore.json`

Project overrides global, global overrides defaults.

## Project config (`.ctxcore.json`)

Created by `ctxcore init`. Contains project-specific overrides. Safe to commit to version control — contains no secrets.

```json
{
  "ollamaModel": "jina-code",
  "embeddingProvider": "auto",
  "claudeCliPath": "/opt/homebrew/bin/claude",
  "decay": {
    "shortTerm": 0.95,
    "operational": 0.995,
    "longTerm": 0.9995
  }
}
```

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `ollamaModel` | string | `"jina-code"` | Embedding model id (see below) |
| `embeddingProvider` | `"auto"` \| `"transformers"` \| `"ollama"` \| `"none"` | `"auto"` | Provider selection |
| `claudeCliPath` | string | auto-detected | Path to `claude` binary |
| `ollamaUrl` | string | `http://localhost:11434` | Ollama API URL (only used if provider is `ollama`) |
| `dbPath` | string | `<project>/.memory.db` | Override the database location |
| `decay.shortTerm` | number | `0.95` | Decay rate per hour for short-term memories |
| `decay.operational` | number | `0.995` | Decay rate per hour for operational memories |
| `decay.longTerm` | number | `0.9995` | Decay rate per hour for long-term memories |
| `embedding.dimensions` | number | auto-set from model | Vector dimension (auto-resolved from model) |
| `embedding.batchSize` | number | `32` | Batch size for bulk embedding |

### Embedding models

| Model id | Provider | Dim | Notes |
|---|---|---|---|
| `jina-code` | transformers | 768 | Code-optimized (default). ~162MB quantized |
| `all-MiniLM-L6-v2` | transformers | 384 | Fast, small. ~96MB |
| `jina-embeddings-v2-small-en` | transformers | 512 | General-purpose, 8K context |
| `qwen3-embedding:0.6b` | ollama | 1024 | Requires Ollama |
| `embeddinggemma:300m` | ollama | 768 | Requires Ollama |
| `qwen3-embedding:4b` | ollama | 2560 | Requires Ollama |

## Global config (`~/.ctxcore/config.json`)

User-global defaults. Applies to every project unless overridden.

```json
{
  "claudeCliPath": "/opt/homebrew/bin/claude",
  "ollamaUrl": "http://localhost:11434"
}
```

Typically only used to set `claudeCliPath` if auto-detection fails.

## Environment variables

| Variable | Purpose |
|---|---|
| `CTXCORE_PROJECT_ROOT` | Override project root (normally detected from `cwd`) |
| `CTXCORE_BACKGROUND` | Set to `1` by internal launchd/cron invocations. You should not set this. |
| `CTXCORE_LIVE_TESTS` | Set to `1` to enable live AI tests (contributors only) |

## Global files

```
~/.ctxcore/
├── config.json              # Global config
├── last-reflexion           # Timestamp of last reflexion (for staleness guard)
├── user_profile.db          # Global user preferences
├── models/                  # Cached Transformers.js model files
├── locks/                   # Advisory locks for concurrent operations
└── reflexion.log            # launchd stdout/stderr
```

## Project files

```
<project>/
├── .memory.db               # Main SQLite database
├── .memory.db-wal           # SQLite WAL
├── .memory.db-shm           # SQLite shared memory
├── .ctxcore.json            # Project config
├── .ctxcore/
│   └── specs/               # Spec documents (markdown + metadata)
├── CLAUDE.md                # Patched with ctxcore protocol + project context
└── .mcp.json                # MCP server registration
```

Default `.gitignore` rules (added by `ctxcore init`):

```
.memory.db
.memory.db-wal
.memory.db-shm
.ctxcore/
```

## Scheduling

On macOS, `ctxcore init` installs a `launchd` agent at `~/Library/LaunchAgents/com.ctxcore.reflexion.plist` that runs `ctxcore reflect --auto --quiet` daily at 2:23 AM. If the Mac is asleep, launchd catches up on wake.

On Linux, a crontab entry is written with a `# ctxcore` marker for clean removal.

To change the schedule:

```
ctxcore schedule --cron "0 3 * * *"
```

To remove:

```
ctxcore schedule --remove
```

## Claude Code hooks

Added to `.claude/settings.json` by `ctxcore init`:

| Event | Purpose |
|---|---|
| `SessionStart` | Load fresh memory context + sync from Claude auto memory |
| `Stop` | Trigger end-of-session reflexion + export to Claude auto memory |
| `PreToolUse` | Auto-allow `mcp__ctxcore__*` tool calls |
| `UserPromptSubmit` | Detect user corrections and store as preferences |
| `PreCompact` / `PostCompact` | Preserve critical memories across Claude context compaction |

All hook scripts live in the installed ctxcore package under `src/hooks/` and are referenced by absolute path.
