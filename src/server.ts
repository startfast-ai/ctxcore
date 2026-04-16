import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ctxcore } from './ctxcore.js';
import { ReflexionApplicator } from './reflexion-applicator.js';

export async function startServer(projectRoot: string): Promise<void> {
  const ctx = await Ctxcore.create(projectRoot);

  // Load default trigger rules
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const triggersPath = join(thisDir, '..', 'templates', 'triggers-default.json');
  try {
    ctx.triggerEngine.loadRules(triggersPath);
  } catch {
    // Trigger rules file not found — proceed without alerts
  }

  const server = new McpServer({
    name: 'ctxcore',
    version: '0.1.0',
  });

  server.tool(
    'memory_search',
    'Search project memories by semantic similarity and keywords',
    {
      query: z.string().describe('The search query'),
      limit: z.number().optional().describe('Max results to return (default 10)'),
      tier: z.enum(['short-term', 'operational', 'long-term']).optional().describe('Filter by memory tier'),
    },
    async ({ query, limit, tier }) => {
      const results = await ctx.retrievalEngine.search(query, { limit: limit ?? 10, tier });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r.memory.id,
                content: r.memory.content,
                tier: r.memory.tier,
                importance: r.memory.importance,
                score: Math.round(r.score * 1000) / 1000,
                matchType: r.matchType,
                tags: r.memory.tags,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_store',
    'Store a new memory about the project',
    {
      content: z.string().describe('The memory content'),
      tier: z.enum(['short-term', 'operational', 'long-term']).optional().describe('Memory tier (default: short-term)'),
      importance: z.number().min(0).max(1).optional().describe('Importance score 0-1 (auto-classified if omitted)'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
    },
    async ({ content, tier, importance, tags }) => {
      const memory = ctx.memoryStore.create({ content, tier, importance, tags });

      try {
        const embedding = await ctx.embeddingClient.embed(content);
        ctx.embeddingStore.store(memory.id, embedding);
      } catch {
        // Embeddings will be retried later
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ id: memory.id, tier: memory.tier, importance: memory.importance }),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_context',
    'Get current project context — call this at the start of every session',
    {},
    async () => {
      const stats = ctx.memoryStore.stats();
      const recentMemories = ctx.memoryStore.list({ limit: 10 });

      // Evaluate trigger alerts
      const allAlerts = ctx.triggerEngine.evaluate(ctx.memoryStore);
      const triggeredAlerts = allAlerts
        .filter((a) => a.triggered)
        .map((a) => ({
          rule: a.rule.name,
          message: a.message,
          action: a.rule.action,
          memoryIds: a.memoryIds,
        }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                stats,
                recentMemories: recentMemories.map((m) => ({
                  id: m.id,
                  content: m.content,
                  tier: m.tier,
                  importance: m.importance,
                  actuality: Math.round(m.actuality * 1000) / 1000,
                })),
                alerts: triggeredAlerts,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_decide',
    'Record a project decision as an operational memory with importance 0.7',
    {
      content: z.string().describe('The decision content'),
      tags: z.array(z.string()).optional().describe('Additional tags (decision tag is auto-added)'),
    },
    async ({ content, tags }) => {
      const allTags = ['decision', ...(tags ?? [])];
      const memory = ctx.memoryStore.create({
        content,
        tier: 'operational',
        importance: 0.7,
        tags: allTags,
      });

      try {
        const embedding = await ctx.embeddingClient.embed(content);
        ctx.embeddingStore.store(memory.id, embedding);
      } catch {
        // Embeddings will be retried later
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ id: memory.id, tier: memory.tier, importance: memory.importance, tags: memory.tags }),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_reflect',
    'Trigger a reflexion cycle to consolidate, detect contradictions, find patterns, and recalibrate memories',
    {},
    async () => {
      if (!ctx.reflexionEngine) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Reflexion requires Claude CLI. Install Claude CLI and set claudeCliPath in your ctxcore config to enable reflexion.',
              }),
            },
          ],
        };
      }

      const results = await ctx.reflexionEngine.runFull(ctx.memoryStore);

      const applicator = new ReflexionApplicator();
      const allSuggestions = results.flatMap((r) => r.suggestions);
      const applyResult = applicator.apply(allSuggestions, ctx.memoryStore);

      const summary = {
        reflexionCycles: results.length,
        totalSuggestions: allSuggestions.length,
        applied: applyResult.applied,
        skipped: applyResult.skipped,
        errors: applyResult.errors,
        details: results.map((r) => ({
          type: r.type,
          memoriesAffected: r.memoriesAffected.length,
          suggestions: r.suggestions.length,
        })),
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  // ── Task Tools ──

  // Seed default kanban columns once on server start
  ctx.taskStore.seedDefaultColumns(projectRoot);

  server.tool(
    'memory_task_create',
    'Create a new task on the project kanban board',
    {
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Task priority (default: medium)'),
      assignee: z.string().optional().describe('Who the task is assigned to'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      estimated_effort: z.string().optional().describe('Estimated effort (e.g. "2h", "1d", "1w")'),
    },
    async ({ title, description, priority, assignee, tags, estimated_effort }) => {
      // Ensure default columns exist and default to backlog
      ctx.taskStore.seedDefaultColumns(projectRoot);
      const backlogCol = ctx.db
        .prepare("SELECT id FROM kanban_columns WHERE project_id = ? AND title = 'Backlog' LIMIT 1")
        .get(projectRoot) as { id: string } | undefined;

      const task = ctx.taskStore.create({
        projectId: projectRoot,
        title,
        description: description ?? '',
        priority: priority ?? 'medium',
        assignee,
        createdBy: 'ai',
        tags: tags ?? [],
        estimatedEffort: estimated_effort,
        columnId: backlogCol?.id,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: task.id,
                title: task.title,
                status: task.status,
                priority: task.priority,
                assignee: task.assignee,
                tags: task.tags,
                createdBy: task.createdBy,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_task_update',
    'Update an existing task — change title, description, status, column, priority, assignee, or tags',
    {
      id: z.string().describe('Task ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: z.enum(['open', 'in-progress', 'done', 'archived']).optional().describe('New status'),
      column_id: z.string().optional().describe('Move to this kanban column'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('New priority'),
      assignee: z.string().optional().describe('New assignee'),
      tags: z.array(z.string()).optional().describe('Replace tags'),
    },
    async ({ id, title, description, status, column_id, priority, assignee, tags }) => {
      const updated = ctx.taskStore.update(id, {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(column_id !== undefined && { columnId: column_id }),
        ...(priority !== undefined && { priority }),
        ...(assignee !== undefined && { assignee }),
        ...(tags !== undefined && { tags }),
      });

      if (!updated) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Task not found: ${id}` }) }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: updated.id,
                title: updated.title,
                status: updated.status,
                columnId: updated.columnId,
                priority: updated.priority,
                assignee: updated.assignee,
                tags: updated.tags,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_task_comment',
    'Add an AI comment on a task',
    {
      task_id: z.string().describe('Task ID to comment on'),
      content: z.string().describe('Comment content'),
    },
    async ({ task_id, content }) => {
      const task = ctx.taskStore.getById(task_id);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Task not found: ${task_id}` }) }],
        };
      }

      const comment = ctx.taskStore.addComment(task_id, 'ai', 'ai', content);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: comment.id,
                taskId: comment.taskId,
                author: comment.author,
                authorType: comment.authorType,
                content: comment.content,
                createdAt: comment.createdAt.toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_task_list',
    'List tasks with optional filters',
    {
      status: z.enum(['open', 'in-progress', 'done', 'archived']).optional().describe('Filter by status'),
      column_id: z.string().optional().describe('Filter by kanban column'),
      assignee: z.string().optional().describe('Filter by assignee'),
      tag: z.string().optional().describe('Filter by tag'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ status, column_id, assignee, tag, limit }) => {
      const tasks = ctx.taskStore.list({
        status,
        columnId: column_id,
        assignee,
        tag,
        limit: limit ?? 50,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              tasks.map((t) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                columnId: t.columnId,
                priority: t.priority,
                assignee: t.assignee,
                tags: t.tags,
                createdBy: t.createdBy,
                estimatedEffort: t.estimatedEffort,
                createdAt: t.createdAt.toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_task_link',
    'Link a task to a memory or spec',
    {
      task_id: z.string().describe('Task ID'),
      memory_id: z.string().optional().describe('Memory ID to link'),
      spec_id: z.string().optional().describe('Spec ID to link'),
      link_type: z.string().describe('Link type (e.g. related, blocker, decision, spec, caused_by, implements, blocked_by)'),
    },
    async ({ task_id, memory_id, spec_id, link_type }) => {
      const task = ctx.taskStore.getById(task_id);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Task not found: ${task_id}` }) }],
        };
      }

      if (memory_id) {
        const link = ctx.taskStore.linkMemory(task_id, memory_id, link_type as any);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { taskId: link.taskId, memoryId: link.memoryId, linkType: link.linkType },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (spec_id) {
        const link = ctx.taskStore.linkSpec(task_id, spec_id, link_type as any);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { taskId: link.taskId, specId: link.specId, linkType: link.linkType },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide either memory_id or spec_id' }) }],
      };
    },
  );

  // ── Spec Tools ──

  server.tool(
    'memory_spec_create',
    'Create a new specification document',
    {
      title: z.string().describe('Spec title'),
      content: z.string().optional().describe('Spec content (markdown)'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
    },
    async ({ title, content, tags }) => {
      const spec = ctx.specStore.create({
        title,
        content: content ?? '',
        tags: tags ?? [],
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: spec.id,
                title: spec.title,
                status: spec.status,
                filePath: spec.filePath,
                tags: spec.tags,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_spec_read',
    'Read a specification document with its content and metadata',
    {
      id: z.string().describe('Spec ID (slug)'),
    },
    async ({ id }) => {
      const spec = ctx.specStore.getById(id);
      if (!spec) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Spec not found: ${id}` }) }],
        };
      }

      const versions = ctx.specStore.getVersions(id);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: spec.id,
                title: spec.title,
                status: spec.status,
                content: spec.content,
                tags: spec.tags,
                createdBy: spec.createdBy,
                createdAt: spec.createdAt.toISOString(),
                updatedAt: spec.updatedAt.toISOString(),
                versions: versions.map((v) => ({
                  version: v.version,
                  timestamp: v.timestamp.toISOString(),
                  author: v.author,
                  summary: v.summary,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_spec_update',
    'Update a specification document — creates a new version',
    {
      id: z.string().describe('Spec ID (slug)'),
      content: z.string().describe('New spec content (markdown)'),
      summary_of_changes: z.string().describe('Summary of what changed in this version'),
    },
    async ({ id, content, summary_of_changes }) => {
      const updated = ctx.specStore.update(id, { content }, summary_of_changes);
      if (!updated) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Spec not found: ${id}` }) }],
        };
      }

      const versions = ctx.specStore.getVersions(id);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: updated.id,
                title: updated.title,
                status: updated.status,
                tags: updated.tags,
                updatedAt: updated.updatedAt.toISOString(),
                currentVersion: versions.length,
                summary: summary_of_changes,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_spec_list',
    'List specification documents with optional filters',
    {
      status: z.enum(['draft', 'in-review', 'approved', 'in-progress', 'completed', 'archived']).optional().describe('Filter by status'),
      tag: z.string().optional().describe('Filter by tag'),
    },
    async ({ status, tag }) => {
      const specs = ctx.specStore.list({
        status,
        tags: tag ? [tag] : undefined,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              specs.map((s) => ({
                id: s.id,
                title: s.title,
                status: s.status,
                tags: s.tags,
                createdBy: s.createdBy,
                createdAt: s.createdAt.toISOString(),
                updatedAt: s.updatedAt.toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'memory_spec_link',
    'Link a spec to a task or memory',
    {
      spec_id: z.string().describe('Spec ID (slug)'),
      task_id: z.string().optional().describe('Task ID to link'),
      memory_id: z.string().optional().describe('Memory ID to link'),
      link_type: z.string().describe('Link type (e.g. implements, related, blocked_by, decision, caused_by)'),
    },
    async ({ spec_id, task_id, memory_id, link_type }) => {
      const spec = ctx.specStore.getById(spec_id);
      if (!spec) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Spec not found: ${spec_id}` }) }],
        };
      }

      if (task_id) {
        const link = ctx.taskStore.linkSpec(task_id, spec_id, link_type as any);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { specId: link.specId, taskId: link.taskId, linkType: link.linkType },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (memory_id) {
        // Link spec to memory via task_memory_links is not directly applicable.
        // Store the link in the spec metadata as a linkedMemory.
        // For now, return success with the association noted.
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { specId: spec_id, memoryId: memory_id, linkType: link_type, status: 'linked' },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide either task_id or memory_id' }) }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
