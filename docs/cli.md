# CLI Reference

All commands are run from the project root.

## Setup

### `ctxcore init`

Initialize ctxcore in the current directory. Detects Claude CLI, sets up embeddings, creates `.memory.db`, seeds memories from the project, patches `CLAUDE.md`, registers the MCP server, installs hooks, and schedules nightly reflexion.

```
ctxcore init [options]
```

| Flag | Description |
|---|---|
| `-m, --model <id>` | Embedding model (default: `jina-code`) |
| `--force` | Overwrite existing setup without prompting |
| `--no-analysis` | Skip Claude-powered deep analysis (fast seed only) |
| `--no-mcp` | Skip MCP registration |
| `--no-claude-md` | Skip `CLAUDE.md` patch |
| `--claude-cli <path>` | Explicit Claude CLI path |
| `--analysis-model <name>` | Claude model for analysis (`haiku`, `sonnet`, `opus`) |
| `--verbose` | Show detailed output |

### `ctxcore doctor`

Diagnose installation issues. Reports on database, config, Claude CLI, embedding provider, MCP registration, hook state, and schema version.

### `ctxcore uninstall`

Remove ctxcore from the current project. Removes MCP registration, hooks, `CLAUDE.md` section, and `.ctxcore.json`.

```
ctxcore uninstall [--purge] [-y, --yes]
```

`--purge` also deletes `.memory.db` and `~/.ctxcore/`.

### `ctxcore update`

Re-apply hooks, permissions, MCP config, and the `CLAUDE.md` template without touching stored memories. Use after upgrading ctxcore.

## Memory

### `ctxcore store <content>`

Store a new memory with auto-classification.

```
ctxcore store "Auth uses JWT RS256" --tier operational --importance 0.7 --tags auth,decision
```

| Flag | Description |
|---|---|
| `--tier <tier>` | `short-term`, `operational`, `long-term` (default: auto) |
| `--importance <n>` | 0.0-1.0 (default: auto-classified) |
| `--tags <csv>` | Comma-separated tags |

### `ctxcore search <query>`

Hybrid semantic + keyword search.

```
ctxcore search "auth timeout" --limit 10 --tier operational
```

| Flag | Description |
|---|---|
| `-n, --limit <n>` | Max results (default: 20) |
| `--tier <tier>` | Filter by tier |
| `--tags <csv>` | Filter by tags |
| `--min-score <n>` | Minimum score threshold |
| `--include-archived` | Include archived memories |

### `ctxcore ask <question>`

RAG-style answer over the knowledge base. Retrieves relevant memories and asks Claude CLI to synthesize an answer.

```
ctxcore ask "why does payments use MongoDB?"
```

| Flag | Description |
|---|---|
| `-n, --limit <n>` | Max memories used as context (default: 5) |

### `ctxcore status`

Current intelligence score, dimension breakdown, memory counts by tier, and recent memories.

### `ctxcore export`

Dump all memories to stdout as JSON, including graph connections.

```
ctxcore export [--include-archived]
```

## Intelligence

### `ctxcore reflect`

Run a reflexion cycle. Without flags, runs all four modes: consolidation, contradictions, patterns, recalibration. Requires Claude CLI.

```
ctxcore reflect [--auto] [--dry-run] [--quiet]
```

| Flag | Description |
|---|---|
| `--consolidate` | Run consolidation only |
| `--contradictions` | Run contradiction detection only |
| `--patterns` | Run pattern detection only |
| `--recalibrate` | Run importance recalibration only |
| `--model <name>` | Claude model (default: `sonnet`) |
| `--dry-run` | Show suggestions without applying |
| `--auto` | Apply without confirmation (non-interactive) |
| `--quiet` | Suppress output (for scheduled runs) |

### `ctxcore contradictions`

List all contradictions currently in the knowledge graph.

### `ctxcore patterns`

List detected patterns and recurring tag themes.

```
ctxcore patterns [--days <n>]
```

### `ctxcore history`

Intelligence score timeline.

```
ctxcore history [-n, --limit <n>]
```

### `ctxcore onboard`

Generate a project briefing from accumulated intelligence — architecture, conventions, tech stack, contradictions, recent activity.

## Project analysis

### `ctxcore rescan`

Re-analyze the project. Updates memories from current file state, config, and git log.

```
ctxcore rescan [--incremental]
```

`--incremental` only processes files changed since the last scan.

### `ctxcore diff`

Show memory changes over time.

```
ctxcore diff --since yesterday
ctxcore diff --since 2026-04-01
```

## Preferences

Preferences are global (per user), not per project. Stored in `~/.ctxcore/user_profile.db`.

```
ctxcore preferences list
ctxcore preferences add "Always use raw SQL, never ORMs"
ctxcore preferences forget <id>
```

## Automation

### `ctxcore schedule`

Manage the automated reflexion schedule. Uses launchd on macOS (survives sleep), crontab on Linux.

```
ctxcore schedule --cron "0 2 * * *"   # install
ctxcore schedule --status             # show current
ctxcore schedule --remove             # remove
```

### `ctxcore hooks install`

Install git `post-commit` and `post-merge` hooks. Post-commit runs `ctxcore reflect --consolidate --auto --quiet`; post-merge runs `ctxcore rescan --incremental`.

### `ctxcore hooks uninstall`

Remove the git hooks.

## Other

### `ctxcore visualize`

Open the local knowledge graph dashboard.

### `ctxcore sync`

Manually sync with Claude's auto memory directory.

```
ctxcore sync              # bidirectional
ctxcore sync --import     # one-way: Claude auto memory → ctxcore
ctxcore sync --export     # one-way: ctxcore → Claude auto memory
```

### `ctxcore task`, `ctxcore spec`

Task and specification management. Run `ctxcore task --help` / `ctxcore spec --help` for subcommands.

### `ctxcore research`

Deep research mode — multi-pass project analysis via Claude CLI. Generates security, weakness, and insight memories.

### `ctxcore serve`

Start the MCP server. You normally don't invoke this directly — Claude Code starts it via `.mcp.json` registration.
