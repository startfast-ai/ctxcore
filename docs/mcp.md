# MCP Tools

ctxcore exposes itself to Claude Code over the Model Context Protocol. After `ctxcore init`, the server is registered in `.mcp.json` and Claude can call any of these tools.

Naming: Claude sees tools as `mcp__ctxcore__<name>`. The documentation below uses the short name.

## Memory

### `memory_context`

Load project intelligence into the current session. Returns a markdown summary of long-term decisions, active operational context, and recent findings — sized to a token budget.

**Parameters**: none.

**When Claude should call it**: at the start of every session, before beginning any work.

### `memory_search`

Hybrid semantic + keyword search.

```typescript
memory_search({ query: string, limit?: number, tier?: string, tags?: string[] })
```

| Field | Required | Description |
|---|---|---|
| `query` | yes | Natural-language search string |
| `limit` | no | Max results (default: 10) |
| `tier` | no | `short-term` \| `operational` \| `long-term` |
| `tags` | no | Filter by tags (any match) |

Returns memories with content, tier, importance, actuality, match type (`vector`, `keyword`, `hybrid`), and score.

### `memory_store`

Store a new memory with auto-classification.

```typescript
memory_store({ content: string, tier?: string, importance?: number, tags?: string[] })
```

Claude should call this whenever it learns something worth remembering — user preferences, corrections, bug fixes, architecture decisions.

### `memory_decide`

Record a decision. Convenience wrapper that sets tier to `operational`, importance to 0.7, and tags with `decision` by default.

```typescript
memory_decide({ content: string, tags?: string[] })
```

### `memory_reflect`

Trigger a reflexion cycle. Blocks until complete. Use sparingly — reflexion uses Claude CLI and costs real tokens.

**Parameters**: none.

## Tasks

Optional kanban-style task tracking. Data lives in the same `.memory.db`.

### `memory_task_create`

```typescript
memory_task_create({
  title: string,
  description?: string,
  status?: "open" | "in-progress" | "done" | "archived",
  priority?: "low" | "medium" | "high" | "critical",
  assignee?: string,
  tags?: string[],
  estimatedEffort?: string,
})
```

### `memory_task_update`

```typescript
memory_task_update({ id: string, ...fields })
```

Any field from `memory_task_create` can be updated. Use `columnId` and `columnOrder` to move cards on the board.

### `memory_task_comment`

Add a comment to a task. `authorType` distinguishes human vs. AI comments.

```typescript
memory_task_comment({
  taskId: string,
  author: string,
  authorType: "human" | "ai",
  content: string,
})
```

### `memory_task_list`

List tasks with filters.

```typescript
memory_task_list({ status?: string, tag?: string, assignee?: string, columnId?: string })
```

### `memory_task_link`

Link a task to a memory or spec.

```typescript
memory_task_link({
  taskId: string,
  memoryId?: string,
  specId?: string,
  linkType: "related" | "blocker" | "decision" | "spec" | "caused_by" | "implements" | "blocked_by",
})
```

## Specs

Specification documents. Markdown files with frontmatter metadata, stored in `.ctxcore/specs/` with version history.

### `memory_spec_create`

```typescript
memory_spec_create({
  title: string,
  content: string,      // markdown
  status?: "draft" | "in-review" | "approved" | "in-progress" | "completed" | "archived",
  tags?: string[],
})
```

### `memory_spec_read`

Read a spec by id.

```typescript
memory_spec_read({ id: string })
```

### `memory_spec_update`

Update a spec. Previous versions are preserved in `.ctxcore/specs/.meta/`.

```typescript
memory_spec_update({ id: string, content?: string, status?: string, tags?: string[] })
```

### `memory_spec_list`

```typescript
memory_spec_list({ status?: string, tag?: string })
```

### `memory_spec_link`

Link a spec to a memory or task (see `memory_task_link`).

## Auto-allow

`ctxcore init` writes a `PreToolUse` hook to `.claude/settings.json` that auto-allows all `mcp__ctxcore__*` tool calls. You will not be prompted for permission every time Claude uses memory.
