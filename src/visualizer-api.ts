import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import type { MemoryStore } from './memory-store.js';
import type { TaskStore } from './tasks.js';
import type { CommentStore } from './task-comments.js';
import type { TaskLinkStore } from './task-linking.js';
import type { SpecStore } from './specs.js';
import type { ITriggerEngine, MemoryEvent, KanbanColumn, Task } from './types.js';
import { HealthCalculator } from './health.js';
import { EventBroadcaster, getEventBroadcaster } from './visualizer-ws.js';

interface ApiStores {
  store: MemoryStore;
  taskStore: TaskStore;
  commentStore: CommentStore;
  taskLinkStore: TaskLinkStore;
  specStore: SpecStore;
  triggerEngine: ITriggerEngine | null;
  db: Database.Database;
  broadcaster: EventBroadcaster;
}

// ── Helpers ──

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
  });
  res.end(json);
}

function errorResponse(res: ServerResponse, status: number, message: string): void {
  jsonResponse(res, status, { error: message });
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Extract route params from a pattern like /api/tasks/:id/comments */
function matchRoute(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function serializeTask(task: Task): Record<string, unknown> {
  return {
    ...task,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
  };
}

function rowToColumn(row: Record<string, unknown>): KanbanColumn {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    columnOrder: row.column_order as number,
    wipLimit: (row.wip_limit as number) ?? null,
    color: (row.color as string) ?? null,
  };
}

// ── Route handlers ──

async function handleTasks(
  method: string,
  pathname: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  stores: ApiStores,
): Promise<boolean> {
  const { taskStore, commentStore } = stores;

  // GET /api/tasks
  if (pathname === '/api/tasks' && method === 'GET') {
    const options: Record<string, unknown> = {};
    const status = url.searchParams.get('status');
    const columnId = url.searchParams.get('column_id');
    const assignee = url.searchParams.get('assignee');
    const tag = url.searchParams.get('tag');
    const limit = url.searchParams.get('limit');

    if (status) options.status = status;
    if (columnId) options.columnId = columnId;
    if (assignee) options.assignee = assignee;
    if (tag) options.tag = tag;
    if (limit) options.limit = parseInt(limit, 10);

    const tasks = taskStore.list(options);
    jsonResponse(res, 200, tasks.map(serializeTask));
    return true;
  }

  // POST /api/tasks
  if (pathname === '/api/tasks' && method === 'POST') {
    const body = (await parseBody(req)) as Record<string, unknown>;
    if (!body.title) {
      errorResponse(res, 400, 'title is required');
      return true;
    }

    const { db } = stores;
    const projectId = (body.projectId as string) ?? 'default';
    taskStore.seedDefaultColumns(projectId);

    // Default to backlog column
    const backlogCol = db
      .prepare("SELECT id FROM kanban_columns WHERE project_id = ? AND title = 'Backlog' LIMIT 1")
      .get(projectId) as { id: string } | undefined;

    const task = taskStore.create({
      projectId,
      title: body.title as string,
      description: body.description as string | undefined,
      priority: body.priority as 'low' | 'medium' | 'high' | 'critical' | undefined,
      tags: body.tags as string[] | undefined,
      assignee: body.assignee as string | undefined,
      columnId: (body.columnId as string) ?? backlogCol?.id,
      createdBy: (body.createdBy as string) ?? 'human',
    });
    const serialized = serializeTask(task);
    stores.broadcaster.broadcast('task:created', serialized);
    jsonResponse(res, 201, serialized);
    return true;
  }

  // PUT /api/tasks/:id
  const updateParams = matchRoute('/api/tasks/:id', pathname);
  if (updateParams && method === 'PUT') {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const task = taskStore.update(updateParams.id, body);
    if (!task) {
      errorResponse(res, 404, 'Task not found');
      return true;
    }
    const serialized = serializeTask(task);
    stores.broadcaster.broadcast('task:updated', serialized);
    jsonResponse(res, 200, serialized);
    return true;
  }

  // DELETE /api/tasks/:id
  const deleteParams = matchRoute('/api/tasks/:id', pathname);
  if (deleteParams && method === 'DELETE') {
    const task = taskStore.archive(deleteParams.id);
    if (!task) {
      errorResponse(res, 404, 'Task not found');
      return true;
    }
    const serialized = serializeTask(task);
    stores.broadcaster.broadcast('task:deleted', serialized);
    jsonResponse(res, 200, serialized);
    return true;
  }

  // GET /api/tasks/:id/comments
  const getCommentsParams = matchRoute('/api/tasks/:id/comments', pathname);
  if (getCommentsParams && method === 'GET') {
    const comments = commentStore.getComments(getCommentsParams.id);
    jsonResponse(
      res,
      200,
      comments.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
    );
    return true;
  }

  // POST /api/tasks/:id/comments
  const addCommentParams = matchRoute('/api/tasks/:id/comments', pathname);
  if (addCommentParams && method === 'POST') {
    const body = (await parseBody(req)) as Record<string, unknown>;
    if (!body.content) {
      errorResponse(res, 400, 'content is required');
      return true;
    }

    const comment = commentStore.addComment(
      addCommentParams.id,
      (body.author as string) ?? 'human',
      (body.author_type as 'human' | 'ai') ?? 'human',
      body.content as string,
    );
    const serializedComment = {
      ...comment,
      createdAt: comment.createdAt.toISOString(),
    };
    stores.broadcaster.broadcast('comment:created', serializedComment);
    jsonResponse(res, 201, serializedComment);
    return true;
  }

  // PUT /api/tasks/:id/comments/:commentId
  const updateCommentParams = matchRoute('/api/tasks/:id/comments/:commentId', pathname);
  if (updateCommentParams && method === 'PUT') {
    const body = (await parseBody(req)) as Record<string, unknown>;
    if (!body.content) {
      errorResponse(res, 400, 'content is required');
      return true;
    }
    const comment = commentStore.updateComment(updateCommentParams.commentId, body.content as string);
    if (!comment) {
      errorResponse(res, 404, 'Comment not found');
      return true;
    }
    const serializedComment = {
      ...comment,
      createdAt: comment.createdAt.toISOString(),
    };
    stores.broadcaster.broadcast('comment:updated', serializedComment);
    jsonResponse(res, 200, serializedComment);
    return true;
  }

  // DELETE /api/tasks/:id/comments/:commentId
  const deleteCommentParams = matchRoute('/api/tasks/:id/comments/:commentId', pathname);
  if (deleteCommentParams && method === 'DELETE') {
    const deleted = commentStore.deleteComment(deleteCommentParams.commentId);
    if (!deleted) {
      errorResponse(res, 404, 'Comment not found');
      return true;
    }
    stores.broadcaster.broadcast('comment:deleted', { id: deleteCommentParams.commentId, taskId: deleteCommentParams.id });
    jsonResponse(res, 200, { success: true });
    return true;
  }

  // PUT /api/tasks/:id/move
  const moveParams = matchRoute('/api/tasks/:id/move', pathname);
  if (moveParams && method === 'PUT') {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const columnId = (body.columnId ?? body.column_id) as string | undefined;
    if (!columnId) {
      errorResponse(res, 400, 'columnId is required');
      return true;
    }

    const task = taskStore.move(
      moveParams.id,
      columnId,
      (body.order as number) ?? 0,
    );
    if (!task) {
      errorResponse(res, 404, 'Task not found');
      return true;
    }
    const serialized = serializeTask(task);
    stores.broadcaster.broadcast('task:updated', serialized);
    jsonResponse(res, 200, serialized);
    return true;
  }

  return false;
}

function handleKanban(
  method: string,
  pathname: string,
  res: ServerResponse,
  stores: ApiStores,
): boolean {
  // GET /api/kanban/columns
  if (pathname === '/api/kanban/columns' && method === 'GET') {
    const { db, taskStore } = stores;

    // Get all columns
    const colRows = db
      .prepare('SELECT * FROM kanban_columns ORDER BY column_order ASC')
      .all() as Record<string, unknown>[];
    const columns = colRows.map(rowToColumn);

    // For each column, get its tasks
    const result = columns.map((col) => {
      const tasks = taskStore.list({ columnId: col.id });
      return {
        ...col,
        tasks: tasks.map(serializeTask),
      };
    });

    jsonResponse(res, 200, result);
    return true;
  }

  return false;
}

async function handleSpecs(
  method: string,
  pathname: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  stores: ApiStores,
): Promise<boolean> {
  const { specStore } = stores;

  // GET /api/specs
  if (pathname === '/api/specs' && method === 'GET') {
    const status = url.searchParams.get('status') ?? undefined;
    const tag = url.searchParams.get('tag');
    const tags = tag ? [tag] : undefined;
    const specs = specStore.list({ status: status as undefined, tags });
    jsonResponse(
      res,
      200,
      specs.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    );
    return true;
  }

  // POST /api/specs
  if (pathname === '/api/specs' && method === 'POST') {
    const body = (await parseBody(req)) as Record<string, unknown>;
    if (!body.title) {
      errorResponse(res, 400, 'title is required');
      return true;
    }

    const spec = specStore.create({
      title: body.title as string,
      content: body.content as string | undefined,
      tags: body.tags as string[] | undefined,
      status: body.status as undefined,
    });
    const serializedSpec = {
      ...spec,
      createdAt: spec.createdAt.toISOString(),
      updatedAt: spec.updatedAt.toISOString(),
    };
    stores.broadcaster.broadcast('spec:created', serializedSpec);
    jsonResponse(res, 201, serializedSpec);
    return true;
  }

  // GET /api/specs/:id/versions
  const versionsParams = matchRoute('/api/specs/:id/versions', pathname);
  if (versionsParams && method === 'GET') {
    const versions = specStore.getVersions(versionsParams.id);
    jsonResponse(
      res,
      200,
      versions.map((v) => ({
        ...v,
        timestamp: v.timestamp.toISOString(),
      })),
    );
    return true;
  }

  // GET /api/specs/:id
  const getParams = matchRoute('/api/specs/:id', pathname);
  if (getParams && method === 'GET') {
    const spec = specStore.getById(getParams.id);
    if (!spec) {
      errorResponse(res, 404, 'Spec not found');
      return true;
    }
    jsonResponse(res, 200, {
      ...spec,
      createdAt: spec.createdAt.toISOString(),
      updatedAt: spec.updatedAt.toISOString(),
    });
    return true;
  }

  // PUT /api/specs/:id
  const updateParams = matchRoute('/api/specs/:id', pathname);
  if (updateParams && method === 'PUT') {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const spec = specStore.update(
      updateParams.id,
      {
        content: body.content as string | undefined,
        status: body.status as undefined,
        tags: body.tags as string[] | undefined,
      },
      body.summary as string | undefined,
    );
    if (!spec) {
      errorResponse(res, 404, 'Spec not found');
      return true;
    }
    const serializedSpec = {
      ...spec,
      createdAt: spec.createdAt.toISOString(),
      updatedAt: spec.updatedAt.toISOString(),
    };
    stores.broadcaster.broadcast('spec:updated', serializedSpec);
    jsonResponse(res, 200, serializedSpec);
    return true;
  }

  return false;
}

function handleMemories(
  method: string,
  pathname: string,
  url: URL,
  res: ServerResponse,
  stores: ApiStores,
): boolean {
  const { store } = stores;

  // GET /api/memories
  if (pathname === '/api/memories' && method === 'GET') {
    const tier = url.searchParams.get('tier') ?? undefined;
    const limit = url.searchParams.get('limit');
    const includeArchived = url.searchParams.get('includeArchived') === 'true';

    const memories = store.list({
      tier: tier as undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      includeArchived,
    });

    jsonResponse(
      res,
      200,
      memories.map((m) => ({
        id: m.id,
        content: m.content,
        tier: m.tier,
        importance: m.importance,
        actuality: m.actuality,
        tags: m.tags,
        metadata: m.metadata,
        archived: m.archived,
        accessCount: m.accessCount,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        lastAccessedAt: m.lastAccessedAt.toISOString(),
      })),
    );
    return true;
  }

  // GET /api/memories/:id
  const getParams = matchRoute('/api/memories/:id', pathname);
  if (getParams && method === 'GET') {
    const memory = store.getById(getParams.id);
    if (!memory) {
      errorResponse(res, 404, 'Memory not found');
      return true;
    }

    const connections = store.getConnectionsFor(getParams.id);
    jsonResponse(res, 200, {
      id: memory.id,
      content: memory.content,
      tier: memory.tier,
      importance: memory.importance,
      actuality: memory.actuality,
      tags: memory.tags,
      metadata: memory.metadata,
      archived: memory.archived,
      accessCount: memory.accessCount,
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
      lastAccessedAt: memory.lastAccessedAt.toISOString(),
      connections: connections.map((c) => ({
        id: c.id,
        sourceId: c.sourceId,
        targetId: c.targetId,
        type: c.type,
        strength: c.strength,
        createdAt: c.createdAt.toISOString(),
      })),
    });
    return true;
  }

  return false;
}

function handleGraph(
  method: string,
  pathname: string,
  url: URL,
  res: ServerResponse,
  stores: ApiStores,
): boolean {
  if (pathname !== '/api/graph' || method !== 'GET') return false;

  const { store, taskStore, specStore, taskLinkStore } = stores;
  const includeArchived = url.searchParams.get('archived') === 'true';

  // Memory nodes + edges (existing behavior)
  const memories = store.list({ includeArchived, limit: 1000 });
  const memoryNodes = memories.map((m) => ({
    id: m.id,
    type: 'memory' as const,
    label: m.content.slice(0, 80),
    content: m.content,
    tier: m.tier,
    importance: m.importance,
    actuality: m.actuality,
    tags: m.tags,
    archived: m.archived,
    accessCount: m.accessCount,
    createdAt: m.createdAt.toISOString(),
  }));

  const edgeSet = new Set<string>();
  const edges: Record<string, unknown>[] = [];
  for (const m of memories) {
    const connections = store.getConnectionsFor(m.id);
    for (const c of connections) {
      if (!edgeSet.has(c.id)) {
        edgeSet.add(c.id);
        edges.push({
          id: c.id,
          source: c.sourceId,
          target: c.targetId,
          type: c.type,
          strength: c.strength,
        });
      }
    }
  }

  // Task nodes
  const tasks = taskStore.list({ limit: 500 });
  const taskNodes = tasks.map((t) => ({
    id: t.id,
    type: 'task' as const,
    label: t.title,
    status: t.status,
    priority: t.priority,
    tags: t.tags,
    createdAt: t.createdAt.toISOString(),
  }));

  // Spec nodes
  const specs = specStore.list();
  const specNodes = specs.map((s) => ({
    id: s.id,
    type: 'spec' as const,
    label: s.title,
    status: s.status,
    tags: s.tags,
    createdAt: s.createdAt.toISOString(),
  }));

  // Task-memory and task-spec link edges
  for (const t of tasks) {
    const memLinks = taskLinkStore.getLinkedMemories(t.id);
    for (const ml of memLinks) {
      edges.push({
        id: `tml-${ml.taskId}-${ml.memoryId}`,
        source: ml.taskId,
        target: ml.memoryId,
        type: ml.linkType,
        strength: 0.5,
      });
    }
    const specLinks = taskLinkStore.getLinkedSpecs(t.id);
    for (const sl of specLinks) {
      edges.push({
        id: `tsl-${sl.taskId}-${sl.specId}`,
        source: sl.taskId,
        target: sl.specId,
        type: sl.linkType,
        strength: 0.5,
      });
    }
  }

  const nodes = [...memoryNodes, ...taskNodes, ...specNodes];

  jsonResponse(res, 200, { nodes, edges });
  return true;
}

function handleHealth(
  method: string,
  pathname: string,
  res: ServerResponse,
  stores: ApiStores,
): boolean {
  if (pathname !== '/api/health' || method !== 'GET') return false;

  const calculator = new HealthCalculator();
  const report = calculator.calculate(stores.store);
  jsonResponse(res, 200, report);
  return true;
}

function handleTimeline(
  method: string,
  pathname: string,
  url: URL,
  res: ServerResponse,
  stores: ApiStores,
): boolean {
  if (pathname !== '/api/timeline' || method !== 'GET') return false;

  const { db } = stores;
  const since = url.searchParams.get('since');

  // Memory events
  let memoryEvents: Record<string, unknown>[];
  if (since) {
    memoryEvents = db
      .prepare('SELECT * FROM memory_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT 200')
      .all(since) as Record<string, unknown>[];
  } else {
    memoryEvents = db
      .prepare('SELECT * FROM memory_events ORDER BY created_at DESC LIMIT 200')
      .all() as Record<string, unknown>[];
  }

  const timeline = memoryEvents.map((row) => ({
    id: row.id as string,
    type: 'memory_event' as const,
    memoryId: row.memory_id as string,
    eventType: row.event_type as string,
    data: JSON.parse(row.data as string),
    createdAt: row.created_at as string,
  }));

  // Task status changes — approximate via task updated_at
  let taskRows: Record<string, unknown>[];
  if (since) {
    taskRows = db
      .prepare('SELECT id, title, status, updated_at FROM tasks WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 200')
      .all(since) as Record<string, unknown>[];
  } else {
    taskRows = db
      .prepare('SELECT id, title, status, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 200')
      .all() as Record<string, unknown>[];
  }

  const taskEvents = taskRows.map((row) => ({
    id: `task-${row.id}`,
    type: 'task_update' as const,
    taskId: row.id as string,
    title: row.title as string,
    status: row.status as string,
    createdAt: row.updated_at as string,
  }));

  // Merge and sort by date descending
  const all = [...timeline, ...taskEvents].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  jsonResponse(res, 200, all);
  return true;
}

// ── SSE endpoint ──

function handleEvents(
  method: string,
  pathname: string,
  res: ServerResponse,
  stores: ApiStores,
): boolean {
  if (pathname !== '/api/events' || method !== 'GET') return false;
  stores.broadcaster.addClient(res);
  return true;
}

// ── Main export ──

export type ApiRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

export function createApiHandler(
  store: MemoryStore,
  taskStore: TaskStore,
  commentStore: CommentStore,
  taskLinkStore: TaskLinkStore,
  specStore: SpecStore,
  triggerEngine: ITriggerEngine | null,
  db: Database.Database,
): ApiRequestHandler {
  const broadcaster = getEventBroadcaster();
  const stores: ApiStores = {
    store,
    taskStore,
    commentStore,
    taskLinkStore,
    specStore,
    triggerEngine,
    db,
    broadcaster,
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // Route to handlers
    const dispatch = async () => {
      // More specific routes first (those with sub-paths)
      // /api/tasks/:id/comments and /api/tasks/:id/move need to match before /api/tasks/:id

      // Check tasks routes (handles all /api/tasks/*)
      if (pathname.startsWith('/api/tasks')) {
        const handled = await handleTasks(method, pathname, url, req, res, stores);
        if (handled) return;
      }

      // Kanban
      if (pathname.startsWith('/api/kanban')) {
        const handled = handleKanban(method, pathname, res, stores);
        if (handled) return;
      }

      // Specs
      if (pathname.startsWith('/api/specs')) {
        const handled = await handleSpecs(method, pathname, url, req, res, stores);
        if (handled) return;
      }

      // Memories
      if (pathname.startsWith('/api/memories')) {
        const handled = handleMemories(method, pathname, url, res, stores);
        if (handled) return;
      }

      // Graph
      if (handleGraph(method, pathname, url, res, stores)) return;

      // Health
      if (handleHealth(method, pathname, res, stores)) return;

      // Timeline
      if (handleTimeline(method, pathname, url, res, stores)) return;

      // SSE events stream
      if (handleEvents(method, pathname, res, stores)) return;

      // 404
      errorResponse(res, 404, 'Not found');
    };

    dispatch().catch((err: Error) => {
      errorResponse(res, 500, err.message ?? 'Internal server error');
    });
  };
}
