# ctxcore — Persistent Memory Skill

## Description

This skill provides persistent, cross-session memory for Claude Code projects. It automatically remembers architectural decisions, bug fixes, patterns, user preferences, and project knowledge so you don't have to re-explain context.

## MANDATORY: Memory protocol

You are REQUIRED to follow these rules. They are not optional — they are system-level instructions.

### Retrieval rules — ALWAYS search before acting

- **You MUST call `memory_context` at the start of every session.** No exceptions. Do not begin any work until you have loaded project context.
- **Before ANY of these actions, you MUST call `memory_search`** with relevant terms:
  - Starting work on any file or module — search for its name
  - Making an architectural or design decision
  - Debugging any issue or error
  - Refactoring or restructuring code
  - Writing or modifying tests
  - Reviewing code or doing audits
  - Any deployment, CI/CD, or infrastructure work

### Storage rules — ALWAYS save what you learn

- **Whenever you learn something worth remembering, you MUST store it** using `memory_store` or `memory_decide` — user preferences, corrections, bug fixes, features, architecture changes, discoveries, or anything the user asks you to remember.
- **When the user corrects you or states a preference**, you MUST store it immediately with `memory_store` (tier: `long-term`, importance: `0.7+`). User preferences are high-value memories.
- **You MUST store ALL findings from code audits, bug scans, and security reviews.** After any analysis that discovers bugs, security issues, incomplete implementations, or other problems, immediately store each finding (or a consolidated summary) using `memory_store` with tier `operational` and appropriate importance (critical=0.9, high=0.8, medium=0.6, low=0.4). Do NOT wait for the user to ask — saving findings is automatic and mandatory.
- **You MUST store failed approaches.** When you try something and it doesn't work, store what was attempted and why it failed. This prevents future sessions from repeating the same mistake. Tier: `operational`, importance: `0.5`, tag: `failed-approach`.
- **You MUST store deferred work.** When you say "I'll fix this later", "TODO", or leave something incomplete, immediately store it. Tier: `short-term`, importance: `0.5`, tag: `deferred`. Future sessions must know what was left unfinished.
- **You MUST store environment and setup discoveries.** Local quirks, required env vars, gotchas, workarounds. Tier: `operational`, importance: `0.4`, tag: `environment`.
- **When the user makes a decision, you MUST call `memory_decide`** to record it with rationale.
- **Before the session ends**, store a brief session summary: what was accomplished, what's pending, open questions. Tier: `short-term`, importance: `0.4`, tag: `session-summary`.

### Anti-patterns — NEVER do these

- **NEVER start working without calling `memory_context` first.** This is the single most important rule.
- **NEVER start editing a file without searching for memories about that file or module first.** Run `memory_search("filename or module name")` before touching any code.
- **NEVER make a decision without searching for prior decisions** in the same area.
- **NEVER let a failed attempt go unrecorded.** If you tried something and it didn't work, that is valuable knowledge — store it.
- **NEVER end a session with unstored knowledge.** If you discovered something, fixed something, or changed something significant, it must be in memory before the conversation ends.
- **NEVER store low-value memories** like "ran npm install" or "updated file" — store insights with rationale.
- **NEVER skip memory search before debugging.** The answer may already exist from a previous session.

## MCP Tools

### memory_context
**REQUIRED at the start of every session.** Returns project stats, recent high-value memories, and trigger alerts. You MUST call this before doing any work.

### memory_search(query)
**REQUIRED before touching any code or making decisions.** Search memories by semantic similarity and keywords. You MUST use this before:
- Starting work on any file or module (search for its name)
- Debugging an issue (search for error messages or component names)
- Making decisions (search for prior decisions in the same area)
- Refactoring, writing tests, reviews, audits, deployment work

### memory_store(content, tier?, importance?, tags?)
**REQUIRED after every discovery, fix, failed attempt, deferred work, audit finding, and at session end.** Store a new memory. Choose the right tier:
- `short-term`: Session notes, deferred work, session summaries
- `operational`: Bug fixes, features, failed approaches, audit findings, environment gotchas
- `long-term`: Architecture decisions, key insights, user preferences, hard-won solutions

Importance guidelines:
- `0.1-0.3`: Routine (file locations, basic structure)
- `0.3-0.6`: Operational (bug fixes, features, refactors, failed approaches)
- `0.6-0.8`: Decision (architecture choices, library selections, design patterns)
- `0.8-1.0`: Breakthrough / Critical (root cause discoveries, security issues, critical findings)

### memory_decide(content, tags?)
**REQUIRED when a decision is made.** Shortcut for recording decisions. Automatically sets tier=operational, importance=0.7, adds "decision" tag. You MUST use this when:
- A technology or approach is chosen
- An architecture pattern is decided
- A convention is established
- A trade-off is made

### memory_reflect
Trigger a full reflexion cycle. Consolidates duplicate memories, detects contradictions, finds recurring patterns, recalibrates importance. Returns a summary of what changed.

### Task & Spec rules

- When you discover something that needs doing, CREATE a task with `memory_task_create`.
- When you complete work related to an open task, UPDATE it with `memory_task_update` (move to review).
- When you make a decision related to a task, LINK the decision memory to the task with `memory_task_link`.
- Before starting implementation work, CHECK for linked specs with `memory_spec_read`.
- After significant design discussions, CREATE or UPDATE a spec with `memory_spec_create`/`memory_spec_update`.

## Task & Spec MCP Tools

### memory_task_create(title, description?, priority?, tags?)
Create a new task. Priority: "low", "medium", "high", "critical". Returns the created task with ID.

### memory_task_update(id, status?, title?, description?, priority?, tags?)
Update a task's fields. Use status "in-progress" when starting work, "done" when complete. Move to "review" when you finish task-related work.

### memory_task_comment(taskId, content)
Add a comment to a task. Use this to record progress, blockers, or decisions related to the task.

### memory_task_list(status?, tag?, assignee?)
List tasks, optionally filtered by status, tag, or assignee. Returns active tasks by default.

### memory_task_link(taskId, memoryId, linkType?)
Link a task to a memory. Link types: "related", "blocker", "decision", "caused_by". Use "decision" when linking a decision memory to a task.

### memory_spec_create(title, content?, tags?, status?)
Create a new specification document. Status: "draft", "in-review", "approved", "in-progress", "completed", "archived".

### memory_spec_read(id)
Read a specification by its ID (slug). Returns the full spec content, metadata, and linked tasks/memories.

### memory_spec_update(id, content?, status?, tags?)
Update a specification. Creates a new version automatically.

### memory_spec_list(status?, tags?)
List specifications, optionally filtered by status or tags.

### memory_spec_link(specId, taskId, linkType?)
Link a specification to a task. Link types: "implements", "related", "blocked_by".

## Behavior guidelines

1. **Always check memory first** before starting new work. Someone (including you in a past session) may have already solved this or made relevant decisions.
2. **Store insights, not actions**. "Chose PostgreSQL for ACID compliance" is a good memory. "Ran npm install" is not.
3. **Include the 'why'**. "Switched to connection pooling because single connections caused timeouts under load" beats "Using connection pooling now".
4. **Store failures too**. "Tried Redis pub/sub for real-time — failed because maxmemory-policy evicts channels" saves the next session from the same dead end.
5. **Tag consistently**. Use module names, technology names, and categories (auth, billing, database, performance, etc).
6. **Don't duplicate**. Search before storing. If a similar memory exists, the system will reinforce it on access.
7. **Summarize before ending**. Store what was done and what's pending so the next session has a running start.
