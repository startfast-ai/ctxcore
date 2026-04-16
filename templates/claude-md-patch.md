## ctxcore — Persistent Project Memory

This project uses **ctxcore** for persistent memory across Claude Code sessions. You have access to a knowledge base of project history, decisions, patterns, and preferences that persists between conversations.

### MANDATORY: Memory protocol

You MUST follow these rules in every session. They are not optional.

#### Retrieval rules — ALWAYS search before acting

1. **You MUST call `memory_context` at the start of every session.** This is required before doing any work. NEVER skip this step.
2. **You MUST call `memory_search` before ANY of these actions:**
   - Making an architectural or design decision
   - Debugging any issue or error
   - Starting work on any file or module — search for its name
   - Refactoring or restructuring code
   - Writing or modifying tests
   - Reviewing code or doing audits
   - Any deployment, CI/CD, or infrastructure work

#### Storage rules — ALWAYS save what you learn

3. **You MUST call `memory_store` or `memory_decide` whenever you learn something worth remembering** — user preferences, bug fixes, feature implementations, architecture changes, root cause discoveries, or any insight that would be valuable in a future session. This includes anything the user asks you to remember.
4. **When the user corrects you or states a preference**, you MUST store it immediately with `memory_store` using tier `long-term` and importance `0.7+`. User preferences are high-value memories.
5. **You MUST store ALL findings from code audits, bug scans, and security reviews.** After any analysis that discovers bugs, security issues, incomplete implementations, or other problems, immediately store each finding (or a consolidated summary) using `memory_store` with tier `operational` and appropriate importance (critical=0.9, high=0.8, medium=0.6, low=0.4). Do NOT wait for the user to ask — saving findings is automatic and mandatory.
6. **You MUST store failed approaches.** When you try something and it doesn't work, store what was attempted and why it failed. This prevents future sessions from repeating the same mistake. Use tier `operational`, importance `0.5`, tag with `failed-approach`.
7. **You MUST store deferred work.** When you say "I'll fix this later", "this needs follow-up", "TODO", or leave something incomplete, immediately store it with tier `short-term`, importance `0.5`, tag `deferred`. Future sessions must know what was left unfinished.
8. **You MUST store environment and setup discoveries.** Local quirks, required env vars, gotchas about the dev environment, workarounds — store with tier `operational`, importance `0.4`, tag `environment`.
9. **Before the session ends or when wrapping up a major task**, store a brief session summary: what was accomplished, what's pending, and any open questions. Use tier `short-term`, importance `0.4`, tag `session-summary`.

#### Hard rules — NEVER do these

10. **NEVER start working without calling `memory_context` first** — this is a hard requirement, not a suggestion.
11. **NEVER make a decision without first searching for prior decisions** in the same area using `memory_search`.
12. **NEVER start editing a file without searching for memories about that file or module first.** Run `memory_search("filename or module name")` before touching any code.
13. **NEVER let a failed attempt go unrecorded.** If you tried something and it didn't work, that is valuable knowledge — store it.
14. **NEVER end a session with unstored knowledge.** If you discovered something, fixed something, or changed something significant, it must be in memory before the conversation ends.

### Memory tools

| Tool | When to use |
|------|------------|
| `memory_context` | **REQUIRED at session start** — loads project context, stats, and trigger alerts |
| `memory_search(query)` | **REQUIRED before** starting work on any file/module, debugging, decisions, refactoring, reviews, tests |
| `memory_store(content, tier, importance, tags)` | **REQUIRED after** every discovery, fix, failed attempt, deferred work, audit finding, session end |
| `memory_decide(content, tags)` | **REQUIRED when** a decision is made — records it as operational memory with importance 0.7 |
| `memory_reflect` | Trigger a reflexion cycle — consolidates, detects contradictions, finds patterns, recalibrates |

### How to store good memories

**Do store**: Insights with rationale — *"Chose connection pooling (pg-pool) because single connections caused timeouts under load in production"*

**Do store**: Failed approaches — *"Tried using Redis pub/sub for real-time updates — failed because our Redis is configured with maxmemory-policy allkeys-lru which evicts pub/sub channels"*

**Do store**: Deferred work — *"Order total calculation still hardcoded to 0 — needs product price lookup implementation before billing can work"*

**Don't store**: Actions without context — *"Ran npm install"* or *"Updated file"*

**Tiers**: `short-term` (session notes, deferred work), `operational` (bug fixes, features, failed approaches), `long-term` (architecture, key decisions, user preferences)

**Importance**: `0.1-0.3` routine, `0.3-0.6` operational, `0.6-0.8` decisions, `0.8-1.0` breakthroughs/critical findings

**Always include tags**: module names, technology names, categories (auth, database, performance, etc.)

### Workflow

1. `memory_context` — **MUST** call at session start, no exceptions
2. `memory_search("file or topic")` — **MUST** check before touching any code or making decisions
3. Do your work
4. `memory_store(...)` — **MUST** save findings, fixes, failed attempts, deferred work
5. `memory_decide(...)` — **MUST** record any decisions with rationale
6. Before ending — **MUST** store session summary of what was done and what's pending
7. Search before storing — don't duplicate existing memories

### Task & Spec rules

- When you discover something that needs doing, CREATE a task with `memory_task_create`.
- When you complete work related to an open task, UPDATE it with `memory_task_update` (move to review).
- When you make a decision related to a task, LINK the decision memory to the task with `memory_task_link`.
- Before starting implementation work, CHECK for linked specs with `memory_spec_read`.
- After significant design discussions, CREATE or UPDATE a spec with `memory_spec_create`/`memory_spec_update`.

### Current project context

