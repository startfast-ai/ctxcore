import type { Command } from 'commander';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { createDatabase, createVecTable } from '../database.js';
import { MemoryStore } from '../memory-store.js';
import { TaskStore } from '../tasks.js';
import { CommentStore } from '../task-comments.js';
import { TaskLinkStore } from '../task-linking.js';
import { SpecStore } from '../specs.js';
import { resolveConfig, isValidEmbeddingModel } from '../config.js';
import { createApiHandler, type ApiRequestHandler } from '../visualizer-api.js';

interface GraphNode {
  id: string;
  content: string;
  tier: string;
  importance: number;
  actuality: number;
  tags: string[];
  archived: boolean;
  accessCount: number;
  createdAt: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function buildGraphData(store: MemoryStore, includeArchived: boolean = false): GraphData {
  const memories = store.list({ includeArchived, limit: 1000 });
  const nodes: GraphNode[] = memories.map((m) => ({
    id: m.id,
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
  const edges: GraphEdge[] = [];
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

  return { nodes, edges };
}

function getHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ctxcore — Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0d1117; color: #c9d1d9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  display: flex; height: 100vh; overflow: hidden;
}

/* ── Nav sidebar (icon bar) ── */
#nav-sidebar {
  width: 60px; min-width: 60px; background: #161b22;
  border-right: 1px solid #30363d; display: flex; flex-direction: column;
  align-items: center; padding-top: 12px; gap: 4px; z-index: 100;
}
.nav-btn {
  width: 44px; height: 44px; border: none; background: transparent;
  color: #8b949e; font-size: 20px; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: all 0.15s;
  position: relative;
}
.nav-btn:hover { background: #21262d; color: #c9d1d9; }
.nav-btn.active { background: #1f6feb33; color: #58a6ff; }
.nav-btn .nav-label {
  display: none; position: absolute; left: 56px; background: #161b22;
  border: 1px solid #30363d; border-radius: 6px; padding: 4px 8px;
  font-size: 11px; white-space: nowrap; color: #c9d1d9; z-index: 200;
}
.nav-btn:hover .nav-label { display: block; }

/* ── Main content area ── */
#main-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }

/* ── Views ── */
.view { display: none; flex: 1; overflow: auto; }
.view.active { display: flex; flex-direction: column; }

/* ── Shared styles ── */
.badge {
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px;
  text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;
}
.badge-high { background: #f8514922; color: #f85149; }
.badge-medium { background: #d2992222; color: #d29922; }
.badge-low { background: #3fb95022; color: #3fb950; }
.tag { font-size: 10px; background: #21262d; color: #8b949e; padding: 1px 6px; border-radius: 8px; }

/* ── Dashboard view ── */
#view-dashboard { padding: 24px; }
.dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
.dash-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; }
.dash-card h3 { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.dash-card .big-number { font-size: 36px; font-weight: 700; color: #c9d1d9; }
.health-ring-wrap { display: flex; align-items: center; gap: 16px; }
.health-ring { position: relative; width: 80px; height: 80px; }
.health-ring svg { transform: rotate(-90deg); }
.health-ring-label {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 22px; font-weight: 700;
}
.activity-item {
  display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #21262d;
  font-size: 12px; align-items: flex-start;
}
.activity-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.activity-time { color: #484f58; font-size: 11px; margin-left: auto; white-space: nowrap; }

/* ── Memories view ── */
#view-memories { flex-direction: row !important; }
.mem-sidebar {
  width: 420px; min-width: 420px; background: #161b22; border-right: 1px solid #30363d;
  display: flex; flex-direction: column; overflow: hidden;
}
.mem-sidebar-header { padding: 16px; border-bottom: 1px solid #30363d; }
.mem-sidebar-header h2 { font-size: 16px; color: #58a6ff; margin-bottom: 8px; }
.mem-stats-bar { font-size: 12px; color: #8b949e; display: flex; gap: 12px; }
.mem-stat { display: flex; align-items: center; gap: 4px; }
.mem-stat-dot { width: 8px; height: 8px; border-radius: 50%; }
.mem-filters { padding: 10px 16px; border-bottom: 1px solid #30363d; display: flex; gap: 8px; flex-wrap: wrap; }
.mem-filter-btn {
  background: #21262d; border: 1px solid #30363d; border-radius: 16px; color: #8b949e;
  padding: 3px 10px; font-size: 11px; cursor: pointer; transition: all 0.15s;
}
.mem-filter-btn:hover { border-color: #58a6ff; color: #c9d1d9; }
.mem-filter-btn.active { background: #1f6feb33; border-color: #58a6ff; color: #58a6ff; }
.mem-search-box { padding: 10px 16px; border-bottom: 1px solid #30363d; }
.mem-search-input {
  width: 100%; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  color: #c9d1d9; padding: 6px 10px; font-size: 13px; outline: none;
}
.mem-search-input:focus { border-color: #58a6ff; }
.mem-search-input::placeholder { color: #484f58; }
.mem-count-badge { padding: 4px 16px; font-size: 11px; color: #8b949e; border-bottom: 1px solid #30363d; }
.mem-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.mem-list::-webkit-scrollbar { width: 6px; }
.mem-list::-webkit-scrollbar-track { background: transparent; }
.mem-list::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
.memory-card {
  padding: 10px 16px; border-bottom: 1px solid #21262d; cursor: pointer; transition: background 0.1s;
}
.memory-card:hover { background: #1c2128; }
.memory-card.selected { background: #1f6feb22; border-left: 3px solid #58a6ff; }
.memory-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.tier-badge {
  font-size: 9px; font-weight: 700; letter-spacing: 0.5px; padding: 1px 5px;
  border-radius: 3px; text-transform: uppercase;
}
.tier-lt { background: #bc8cff22; color: #bc8cff; }
.tier-op { background: #58a6ff22; color: #58a6ff; }
.tier-st { background: #3fb95022; color: #3fb950; }
.importance-bar { display: flex; gap: 1px; margin-left: auto; }
.importance-pip { width: 4px; height: 10px; border-radius: 1px; background: #21262d; }
.importance-pip.filled { background: #d29922; }
.memory-content-text {
  font-size: 12px; color: #c9d1d9; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.memory-meta { font-size: 10px; color: #484f58; margin-top: 4px; display: flex; gap: 8px; }
.memory-tags { margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
.mem-detail-panel {
  flex: 1; overflow-y: auto; padding: 24px; background: #0d1117;
  display: flex; align-items: center; justify-content: center; color: #484f58; font-size: 14px;
}
.mem-detail-panel.has-content { align-items: flex-start; justify-content: flex-start; display: block; color: #c9d1d9; }
.mem-detail-panel h3 { font-size: 14px; color: #58a6ff; margin-bottom: 12px; }
.mem-detail-content { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.mem-detail-meta { font-size: 12px; color: #8b949e; margin-top: 16px; }
.mem-detail-meta div { margin: 4px 0; }
.mem-detail-label { color: #484f58; }

/* ── Kanban view ── */
#view-kanban { flex-direction: column !important; }
.kanban-header {
  padding: 12px 20px; border-bottom: 1px solid #30363d; display: flex;
  align-items: center; gap: 12px; flex-shrink: 0;
}
.kanban-header h2 { font-size: 16px; color: #58a6ff; }
.kanban-board {
  flex: 1; display: flex; gap: 12px; padding: 16px 20px; overflow-x: auto;
  overflow-y: hidden; align-items: flex-start;
}
.kanban-column {
  min-width: 280px; max-width: 280px; background: #161b22; border: 1px solid #30363d;
  border-radius: 8px; display: flex; flex-direction: column; max-height: 100%;
}
.kanban-column.drag-over { border-color: #58a6ff; background: #1f6feb11; }
.kanban-col-header {
  padding: 12px 14px; border-bottom: 1px solid #30363d; display: flex;
  align-items: center; justify-content: space-between; flex-shrink: 0;
}
.kanban-col-title { font-size: 13px; font-weight: 600; }
.kanban-col-count { font-size: 11px; color: #8b949e; }
.kanban-col-count.at-limit { color: #d29922; }
.kanban-col-count.over-limit { color: #f85149; }
.kanban-col-body { flex: 1; overflow-y: auto; padding: 8px; }
.kanban-col-body::-webkit-scrollbar { width: 4px; }
.kanban-col-body::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }
.kanban-add-btn {
  background: transparent; border: 1px dashed #30363d; border-radius: 6px;
  color: #484f58; padding: 8px; font-size: 12px; cursor: pointer; width: 100%;
  margin-bottom: 8px; transition: all 0.15s;
}
.kanban-add-btn:hover { border-color: #58a6ff; color: #58a6ff; }
.task-card {
  background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  padding: 10px 12px; margin-bottom: 8px; cursor: grab; transition: all 0.15s;
}
.task-card:hover { border-color: #484f58; }
.task-card.dragging { opacity: 0.4; }
.task-card-title { font-size: 13px; font-weight: 500; margin-bottom: 6px; }
.task-card-bottom { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.task-card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.task-card-tag { font-size: 10px; background: #21262d; color: #8b949e; padding: 1px 6px; border-radius: 8px; }
.task-card-info { display: flex; align-items: center; gap: 8px; margin-left: auto; font-size: 11px; color: #484f58; }
.task-assignee { font-size: 14px; }

/* Task detail slide-out */
.task-slideout {
  position: fixed; top: 0; right: -540px; width: 540px; height: 100vh;
  background: #161b22; border-left: 1px solid #30363d; z-index: 300;
  transition: right 0.25s ease; display: flex; flex-direction: column;
  box-shadow: -4px 0 20px rgba(0,0,0,0.3);
}
.task-slideout.open { right: 0; }
.task-slideout-header {
  padding: 16px 20px; border-bottom: 1px solid #30363d; display: flex;
  align-items: center; justify-content: space-between; flex-shrink: 0;
}
.task-slideout-close {
  background: none; border: none; color: #8b949e; font-size: 20px; cursor: pointer;
  padding: 4px 8px; border-radius: 4px;
}
.task-slideout-close:hover { background: #21262d; color: #c9d1d9; }
.task-slideout-body { flex: 1; overflow-y: auto; padding: 20px; }
.task-slideout-body h2 { font-size: 18px; margin-bottom: 12px; }
.task-slideout-body .desc { font-size: 13px; line-height: 1.6; margin-bottom: 16px; white-space: pre-wrap; }
.task-slideout-section { margin-bottom: 20px; }
.task-slideout-section h4 { font-size: 12px; color: #8b949e; text-transform: uppercase; margin-bottom: 8px; }
.comment-item { padding: 10px 0; border-bottom: 1px solid #21262d; position: relative; }
.comment-author { font-size: 11px; font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
.comment-author .ai-badge { color: #58a6ff; }
.comment-author .human-badge { color: #3fb950; }
.comment-text { font-size: 12px; line-height: 1.5; }
.comment-time { font-size: 10px; color: #484f58; margin-top: 4px; }
.comment-actions { display: inline-flex; gap: 6px; margin-left: auto; }
.comment-actions button {
  background: none; border: none; color: #484f58; cursor: pointer; font-size: 11px; padding: 2px 6px; border-radius: 3px;
}
.comment-actions button:hover { background: #21262d; color: #c9d1d9; }
.comment-actions button.delete-btn:hover { color: #f85149; }
.overlay {
  display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  background: rgba(0,0,0,0.5); z-index: 250;
}
.overlay.open { display: block; }

/* Editable fields */
.edit-inline { cursor: pointer; border-bottom: 1px dashed transparent; transition: border-color 0.15s; }
.edit-inline:hover { border-bottom-color: #484f58; }
.edit-input, .edit-textarea, .edit-select {
  background: #0d1117; border: 1px solid #30363d; border-radius: 4px;
  color: #c9d1d9; font-family: inherit; font-size: inherit; padding: 4px 8px; outline: none; width: 100%;
}
.edit-input:focus, .edit-textarea:focus, .edit-select:focus { border-color: #58a6ff; }
.edit-textarea { min-height: 80px; resize: vertical; line-height: 1.5; }
.edit-btn-group { display: flex; gap: 6px; margin-top: 6px; }
.edit-btn {
  background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9;
  padding: 4px 12px; font-size: 11px; cursor: pointer; transition: all 0.15s;
}
.edit-btn:hover { border-color: #58a6ff; color: #58a6ff; }
.edit-btn.save-btn { background: #238636; border-color: #238636; color: #fff; }
.edit-btn.save-btn:hover { background: #2ea043; }
.tag-chip {
  display: inline-flex; align-items: center; gap: 4px; background: #21262d; color: #8b949e;
  padding: 2px 8px; border-radius: 12px; font-size: 11px;
}
.tag-chip .tag-remove {
  cursor: pointer; color: #484f58; font-size: 13px; line-height: 1;
}
.tag-chip .tag-remove:hover { color: #f85149; }
.tag-add-input {
  background: transparent; border: 1px dashed #30363d; border-radius: 12px;
  color: #c9d1d9; padding: 2px 8px; font-size: 11px; outline: none; width: 80px;
}
.tag-add-input:focus { border-color: #58a6ff; }
.add-comment-box { margin-top: 12px; }
.add-comment-box textarea {
  background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  color: #c9d1d9; font-family: inherit; font-size: 12px; padding: 8px 10px;
  width: 100%; min-height: 60px; resize: vertical; outline: none; line-height: 1.5;
}
.add-comment-box textarea:focus { border-color: #58a6ff; }
.add-comment-box button {
  background: #238636; border: none; border-radius: 4px; color: #fff;
  padding: 6px 14px; font-size: 12px; cursor: pointer; margin-top: 6px;
}
.add-comment-box button:hover { background: #2ea043; }
.desc-rendered h1,.desc-rendered h2,.desc-rendered h3 { color: #f0f6fc; margin: 8px 0 4px; }
.desc-rendered h1 { font-size: 18px; } .desc-rendered h2 { font-size: 16px; } .desc-rendered h3 { font-size: 14px; }
.desc-rendered p { margin-bottom: 6px; } .desc-rendered ul,.desc-rendered ol { margin: 4px 0 4px 18px; }
.desc-rendered code { background: #21262d; padding: 1px 4px; border-radius: 3px; font-size: 11px; font-family: 'SF Mono',Consolas,monospace; }
.desc-rendered pre { background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 8px; margin: 6px 0; overflow-x: auto; }
.desc-rendered pre code { background: none; padding: 0; }
.desc-rendered strong { font-weight: 600; } .desc-rendered em { font-style: italic; }

/* Spec editor */
.spec-editor-wrap { position: relative; }
.spec-save-indicator {
  position: absolute; top: -28px; right: 0; font-size: 11px; color: #484f58;
  transition: color 0.3s;
}
.spec-save-indicator.saving { color: #d29922; }
.spec-save-indicator.saved { color: #3fb950; }
.spec-block {
  position: relative; padding: 2px 4px 2px 20px; min-height: 24px; line-height: 1.7;
  font-size: 14px; outline: none; border-radius: 3px; transition: background 0.1s;
}
.spec-block:focus { background: #161b2288; }
.spec-block:hover .block-handle { opacity: 0.5; }
.block-handle {
  position: absolute; left: 2px; top: 4px; opacity: 0; cursor: grab;
  color: #484f58; font-size: 12px; user-select: none; transition: opacity 0.15s;
}
.block-handle:hover { opacity: 1 !important; }
.spec-block[data-type="h1"] { font-size: 22px; font-weight: 700; color: #f0f6fc; margin: 16px 0 6px; }
.spec-block[data-type="h2"] { font-size: 18px; font-weight: 600; color: #f0f6fc; margin: 12px 0 4px; border-bottom: 1px solid #21262d; padding-bottom: 2px; }
.spec-block[data-type="h3"] { font-size: 15px; font-weight: 600; color: #f0f6fc; margin: 10px 0 4px; }
.spec-block[data-type="code"] {
  font-family: 'SF Mono',Consolas,monospace; font-size: 12px; background: #0d1117;
  border: 1px solid #30363d; border-radius: 6px; padding: 10px 12px 10px 20px; margin: 6px 0;
  white-space: pre-wrap; color: #c9d1d9;
}
.spec-block[data-type="quote"] {
  border-left: 3px solid #30363d; padding-left: 16px; color: #8b949e; margin: 6px 0;
}
.spec-block[data-type="list"] { padding-left: 36px; }
.spec-block[data-type="list"]::before { content: '\\2022'; position: absolute; left: 22px; color: #8b949e; }
.spec-block[data-type="checklist"] { padding-left: 40px; }
.spec-block[data-type="divider"] { border: none; border-top: 1px solid #30363d; margin: 12px 0; min-height: 1px; padding: 0; pointer-events: none; }

/* Slash command menu */
.slash-menu {
  position: absolute; background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 4px; min-width: 200px; z-index: 400; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  max-height: 260px; overflow-y: auto;
}
.slash-menu-item {
  padding: 6px 10px; border-radius: 4px; font-size: 13px; cursor: pointer;
  display: flex; align-items: center; gap: 8px; color: #c9d1d9;
}
.slash-menu-item:hover, .slash-menu-item.active { background: #1f6feb33; color: #58a6ff; }
.slash-menu-icon { font-size: 14px; width: 20px; text-align: center; color: #8b949e; }
.slash-menu-label { font-weight: 500; }
.slash-menu-hint { font-size: 11px; color: #484f58; margin-left: auto; }

/* ── Specs view ── */
#view-specs { padding: 0; }
.specs-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.specs-header h2 { font-size: 16px; color: #58a6ff; }
.specs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.spec-card {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 16px; cursor: pointer; transition: all 0.15s;
}
.spec-card:hover { border-color: #484f58; }
.spec-card-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.spec-card-meta { font-size: 11px; color: #484f58; margin-top: 8px; }
.spec-card-tags { margin-top: 8px; display: flex; gap: 4px; flex-wrap: wrap; }
.spec-status-badge {
  font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; display: inline-block;
}
.spec-status-draft { background: #484f5833; color: #8b949e; }
.spec-status-in-review { background: #d2992233; color: #d29922; }
.spec-status-approved { background: #3fb95033; color: #3fb950; }
.spec-status-in-progress { background: #58a6ff33; color: #58a6ff; }
.spec-status-completed { background: #3fb95033; color: #3fb950; }
.spec-status-archived { background: #484f5833; color: #484f58; }
.spec-detail-view { display: none; }
.spec-detail-view.active { display: flex; flex: 1; }
.spec-detail-main { flex: 7; padding: 24px; overflow-y: auto; }
.spec-detail-sidebar {
  flex: 3; min-width: 240px; max-width: 340px; border-left: 1px solid #30363d;
  padding: 16px; overflow-y: auto; background: #161b22;
}
.spec-detail-sidebar h4 { font-size: 12px; color: #8b949e; text-transform: uppercase; margin-bottom: 8px; margin-top: 16px; }
.spec-detail-sidebar h4:first-child { margin-top: 0; }
.spec-back-btn {
  background: none; border: 1px solid #30363d; border-radius: 6px;
  color: #8b949e; padding: 6px 12px; font-size: 12px; cursor: pointer; margin-bottom: 16px;
}
.spec-back-btn:hover { border-color: #58a6ff; color: #58a6ff; }
.spec-rendered { font-size: 14px; line-height: 1.7; }
.spec-rendered h1 { font-size: 22px; margin: 20px 0 10px; color: #f0f6fc; }
.spec-rendered h2 { font-size: 18px; margin: 18px 0 8px; color: #f0f6fc; border-bottom: 1px solid #21262d; padding-bottom: 4px; }
.spec-rendered h3 { font-size: 15px; margin: 14px 0 6px; color: #f0f6fc; }
.spec-rendered p { margin-bottom: 10px; }
.spec-rendered ul, .spec-rendered ol { margin: 8px 0 8px 20px; }
.spec-rendered li { margin-bottom: 4px; }
.spec-rendered code {
  background: #21262d; padding: 2px 6px; border-radius: 3px; font-size: 12px;
  font-family: 'SF Mono', Consolas, monospace;
}
.spec-rendered pre {
  background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  padding: 12px; margin: 10px 0; overflow-x: auto;
}
.spec-rendered pre code { background: none; padding: 0; }
.spec-version-item { padding: 8px 0; border-bottom: 1px solid #21262d; font-size: 12px; }
.spec-version-num { font-weight: 600; color: #58a6ff; }
.spec-version-meta { color: #484f58; font-size: 11px; margin-top: 2px; }

/* ── Graph view ── */
#view-graph { position: relative; }
#graph-canvas { display: block; width: 100%; height: 100%; }
#graph-tooltip {
  position: fixed; display: none; background: #161b22; border: 1px solid #30363d;
  border-radius: 6px; padding: 10px 14px; font-size: 12px; max-width: 350px;
  pointer-events: none; z-index: 20; word-wrap: break-word;
}
#graph-legend {
  position: absolute; bottom: 12px; left: 12px; background: #161b22ee;
  border: 1px solid #30363d; border-radius: 6px; padding: 10px 14px; font-size: 11px; z-index: 10;
}
.legend-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
.legend-color { width: 10px; height: 10px; border-radius: 50%; }
.legend-square { width: 10px; height: 10px; border-radius: 2px; }
.legend-pentagon { width: 10px; height: 10px; clip-path: polygon(50% 0%, 100% 38%, 81% 100%, 19% 100%, 0% 38%); }
.legend-line { width: 18px; height: 2px; border-radius: 1px; }

/* ── Utility ── */
.loading { color: #484f58; font-size: 13px; padding: 20px; }
.empty-state { display: flex; align-items: center; justify-content: center; flex: 1; color: #484f58; font-size: 14px; }

/* ── SSE Toast notifications ── */
#sse-toast-container {
  position: fixed; bottom: 16px; right: 16px; z-index: 9999;
  display: flex; flex-direction: column-reverse; gap: 8px; pointer-events: none;
}
.sse-toast {
  background: #161b22; border: 1px solid #30363d; border-left: 3px solid #58a6ff;
  border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #c9d1d9;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4); max-width: 320px;
  animation: sseToastIn 0.25s ease-out;
  pointer-events: auto;
}
.sse-toast.fade-out { animation: sseToastOut 0.3s ease-in forwards; }
.sse-toast-type { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
@keyframes sseToastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes sseToastOut { from { opacity: 1; } to { opacity: 0; transform: translateY(10px); } }
</style>
</head>
<body>

<!-- Nav sidebar -->
<div id="nav-sidebar">
  <button class="nav-btn active" data-route="dashboard" title="Dashboard">
    <span style="font-size:18px">&#9638;</span>
    <span class="nav-label">Dashboard</span>
  </button>
  <button class="nav-btn" data-route="memories" title="Memories">
    <span style="font-size:18px">&#9881;</span>
    <span class="nav-label">Memories</span>
  </button>
  <button class="nav-btn" data-route="kanban" title="Kanban">
    <span style="font-size:18px">&#9783;</span>
    <span class="nav-label">Kanban</span>
  </button>
  <button class="nav-btn" data-route="specs" title="Specs">
    <span style="font-size:18px">&#9776;</span>
    <span class="nav-label">Specs</span>
  </button>
  <button class="nav-btn" data-route="graph" title="Graph">
    <span style="font-size:18px">&#11042;</span>
    <span class="nav-label">Graph</span>
  </button>
</div>

<!-- Main content -->
<div id="main-content">

  <!-- Dashboard View -->
  <div id="view-dashboard" class="view active">
    <div style="padding:24px;overflow-y:auto;flex:1">
      <h2 style="font-size:18px;color:#58a6ff;margin-bottom:20px">Dashboard</h2>
      <div class="dash-grid" id="dash-cards"></div>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px">
        <h3 style="font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Recent Activity</h3>
        <div id="dash-activity-list" class="loading">Loading...</div>
      </div>
    </div>
  </div>

  <!-- Memories View -->
  <div id="view-memories" class="view">
    <div class="mem-sidebar">
      <div class="mem-sidebar-header">
        <h2>Memories</h2>
        <div class="mem-stats-bar">
          <div class="mem-stat"><div class="mem-stat-dot" style="background:#3fb950"></div><span id="mem-st-count">0</span> short-term</div>
          <div class="mem-stat"><div class="mem-stat-dot" style="background:#58a6ff"></div><span id="mem-op-count">0</span> operational</div>
          <div class="mem-stat"><div class="mem-stat-dot" style="background:#bc8cff"></div><span id="mem-lt-count">0</span> long-term</div>
        </div>
      </div>
      <div class="mem-filters" id="mem-filters">
        <button class="mem-filter-btn active" data-filter="all">All</button>
        <button class="mem-filter-btn" data-filter="short-term">Short-term</button>
        <button class="mem-filter-btn" data-filter="operational">Operational</button>
        <button class="mem-filter-btn" data-filter="long-term">Long-term</button>
        <button class="mem-filter-btn" data-filter="high">High importance</button>
      </div>
      <div class="mem-search-box">
        <input class="mem-search-input" id="mem-search" type="text" placeholder="Search memories..." />
      </div>
      <div class="mem-count-badge" id="mem-count-badge">Loading...</div>
      <div class="mem-list" id="mem-list"></div>
    </div>
    <div class="mem-detail-panel" id="mem-detail">Select a memory to view details</div>
  </div>

  <!-- Kanban View -->
  <div id="view-kanban" class="view">
    <div class="kanban-header">
      <h2>Kanban Board</h2>
    </div>
    <div class="kanban-board" id="kanban-board">
      <div class="loading">Loading board...</div>
    </div>
  </div>

  <!-- Specs View -->
  <div id="view-specs" class="view">
    <div id="specs-list-view" style="padding:24px;overflow-y:auto;flex:1">
      <div class="specs-header"><h2>Specifications</h2></div>
      <div class="specs-grid" id="specs-grid"><div class="loading">Loading specs...</div></div>
    </div>
    <div class="spec-detail-view" id="spec-detail-view">
      <div class="spec-detail-main" id="spec-detail-main"></div>
      <div class="spec-detail-sidebar" id="spec-detail-sidebar"></div>
    </div>
  </div>

  <!-- Graph View -->
  <div id="view-graph" class="view">
    <canvas id="graph-canvas"></canvas>
    <div id="graph-tooltip"></div>
    <div id="graph-legend">
      <div style="margin-bottom:4px;color:#8b949e;font-weight:600">Nodes</div>
      <div class="legend-row"><div class="legend-color" style="background:#3fb950"></div>short-term memory</div>
      <div class="legend-row"><div class="legend-color" style="background:#58a6ff"></div>operational memory</div>
      <div class="legend-row"><div class="legend-color" style="background:#bc8cff"></div>long-term memory</div>
      <div class="legend-row"><div class="legend-square" style="background:#d29922"></div>task</div>
      <div class="legend-row"><div class="legend-pentagon" style="background:#a371f7"></div>spec</div>
      <div style="margin-top:6px;margin-bottom:4px;color:#8b949e;font-weight:600">Edges</div>
      <div class="legend-row"><div class="legend-line" style="background:#3fb950"></div>supports</div>
      <div class="legend-row"><div class="legend-line" style="background:#f85149"></div>contradicts</div>
      <div class="legend-row"><div class="legend-line" style="background:#8b949e"></div>causal</div>
      <div class="legend-row"><div class="legend-line" style="background:#d29922"></div>temporal / task link</div>
      <div class="legend-row"><div class="legend-line" style="background:#484f58"></div>similar</div>
    </div>
  </div>
</div>

<!-- Task detail slideout + overlay -->
<div class="overlay" id="task-overlay"></div>
<div class="task-slideout" id="task-slideout">
  <div class="task-slideout-header">
    <span style="font-size:14px;font-weight:600;color:#58a6ff">Task Detail</span>
    <button class="task-slideout-close" id="task-slideout-close">&times;</button>
  </div>
  <div class="task-slideout-body" id="task-slideout-body"></div>
</div>

<!-- SSE toast container -->
<div id="sse-toast-container"></div>

<script>
/* ================================================================
   ctxcore SPA - Dashboard, Memories, Kanban, Specs, Graph
   Pure vanilla JS, hash-based routing, fetch() API calls
   ================================================================ */

// -- Utilities --
function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function timeAgo(ts) {
  if (!ts) return '';
  var d = typeof ts === 'number' ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(ts);
  var secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs/60) + 'm ago';
  if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
  return Math.floor(secs/86400) + 'd ago';
}
function priorityBadge(p) {
  if (!p) return '';
  var cls = p === 'high' ? 'badge-high' : p === 'medium' ? 'badge-medium' : 'badge-low';
  return '<span class="badge ' + cls + '">' + escHtml(p) + '</span>';
}
function tierBadgeClass(t) {
  return t === 'short-term' ? 'tier-st' : t === 'operational' ? 'tier-op' : 'tier-lt';
}
function tierLabel(t) {
  return t === 'short-term' ? 'ST' : t === 'operational' ? 'OP' : 'LT';
}

// -- API helpers --
async function apiGet(path) {
  try { var r = await fetch(path); if (!r.ok) return null; return await r.json(); } catch(e) { return null; }
}
async function apiPost(path, body) {
  try { var r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); if (!r.ok) return null; return await r.json(); } catch(e) { return null; }
}
async function apiPut(path, body) {
  try { var r = await fetch(path, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); if (!r.ok) return null; return await r.json(); } catch(e) { return null; }
}
async function apiDelete(path) {
  try { var r = await fetch(path, { method:'DELETE' }); if (!r.ok) return null; return await r.json(); } catch(e) { return null; }
}

// -- Router --
var currentRoute = 'dashboard';
function navigate(route) {
  currentRoute = route;
  window.location.hash = '#/' + route;
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
  var view = document.getElementById('view-' + route);
  if (view) view.classList.add('active');
  var btn = document.querySelector('.nav-btn[data-route="' + route + '"]');
  if (btn) btn.classList.add('active');
  if (route === 'dashboard') loadDashboard();
  if (route === 'memories') loadMemories();
  if (route === 'kanban') loadKanban();
  if (route === 'specs') loadSpecs();
  if (route === 'graph') initGraphView();
}
document.querySelectorAll('.nav-btn').forEach(function(btn) {
  btn.addEventListener('click', function() { navigate(btn.dataset.route); });
});
window.addEventListener('hashchange', function() {
  var h = window.location.hash.replace('#/', '') || 'dashboard';
  if (h !== currentRoute) navigate(h);
});

// ================================================================
// DASHBOARD
// ================================================================
var dashLoaded = false;
async function loadDashboard() {
  if (dashLoaded) return;
  dashLoaded = true;
  var cardsEl = document.getElementById('dash-cards');
  var actEl = document.getElementById('dash-activity-list');

  var graphP = apiGet('/api/graph');
  var healthP = apiGet('/api/health');
  var tasksP = apiGet('/api/tasks');
  var timelineP = apiGet('/api/timeline');

  var graph = await graphP;
  var health = await healthP;
  var tasks = await tasksP;
  var timeline = await timelineP;

  var allNodes = graph ? graph.nodes || [] : [];
  var memories = allNodes.filter(function(n){ return n.type==='memory'; });
  var stCount = memories.filter(function(n){ return n.tier==='short-term'; }).length;
  var opCount = memories.filter(function(n){ return n.tier==='operational'; }).length;
  var ltCount = memories.filter(function(n){ return n.tier==='long-term'; }).length;
  var totalMem = memories.length;

  var score = health && health.score != null ? health.score : 0;
  var scoreColor = score >= 70 ? '#3fb950' : score >= 40 ? '#d29922' : '#f85149';

  var taskArr = tasks && Array.isArray(tasks) ? tasks : (tasks && tasks.tasks ? tasks.tasks : []);
  var taskCols = {};
  taskArr.forEach(function(t){ var k = t.columnId||t.column_id||t.status||'backlog'; taskCols[k]=(taskCols[k]||0)+1; });

  var html = '';
  // Health card
  var circ = 2 * Math.PI * 34;
  var offset = circ - (score / 100) * circ;
  html += '<div class="dash-card"><h3>Health Score</h3><div class="health-ring-wrap">';
  html += '<div class="health-ring"><svg width="80" height="80"><circle cx="40" cy="40" r="34" fill="none" stroke="#21262d" stroke-width="6"/>';
  html += '<circle cx="40" cy="40" r="34" fill="none" stroke="'+scoreColor+'" stroke-width="6" stroke-dasharray="'+circ+'" stroke-dashoffset="'+offset+'" stroke-linecap="round"/>';
  html += '</svg><div class="health-ring-label" style="color:'+scoreColor+'">'+score+'</div></div>';
  html += '<div style="font-size:12px;color:#8b949e">'+(health&&health.status?escHtml(health.status):'No data')+'</div>';
  html += '</div></div>';

  // Memory stats
  html += '<div class="dash-card"><h3>Memories</h3><div class="big-number">'+totalMem+'</div>';
  html += '<div style="margin-top:8px;font-size:12px;display:flex;gap:12px">';
  html += '<span style="color:#3fb950">'+stCount+' ST</span><span style="color:#58a6ff">'+opCount+' OP</span><span style="color:#bc8cff">'+ltCount+' LT</span>';
  html += '</div></div>';

  // Tasks
  html += '<div class="dash-card"><h3>Active Tasks</h3><div class="big-number">'+taskArr.length+'</div>';
  if (Object.keys(taskCols).length) {
    html += '<div style="margin-top:8px;font-size:12px;color:#8b949e">';
    Object.keys(taskCols).forEach(function(c){ html += '<div>'+escHtml(c)+': '+taskCols[c]+'</div>'; });
    html += '</div>';
  }
  html += '</div>';
  cardsEl.innerHTML = html;

  // Activity
  var events = timeline && Array.isArray(timeline) ? timeline : (timeline && timeline.events ? timeline.events : []);
  if (!events.length) { actEl.innerHTML = '<div style="color:#484f58">No recent activity</div>'; }
  else {
    var ah = '';
    events.slice(0,10).forEach(function(ev){
      var icon = ev.type==='memory_event'?'&#9881;':ev.type==='task_update'?'&#9783;':'&#9679;';
      var desc = ev.title ? ev.title + ' (' + (ev.status||'') + ')' : ev.eventType || ev.type || 'Event';
      ah += '<div class="activity-item"><span class="activity-icon">'+icon+'</span>';
      ah += '<span>'+escHtml(desc)+'</span>';
      ah += '<span class="activity-time">'+timeAgo(ev.createdAt)+'</span></div>';
    });
    actEl.innerHTML = ah;
  }
}

// ================================================================
// MEMORIES
// ================================================================
var memData = { all:[], filtered:[], edges:[], selectedId:null, filter:'all', search:'' };
var memLoaded = false;

async function loadMemories() {
  if (memLoaded) return;
  memLoaded = true;
  var graph = await apiGet('/api/graph');
  if (!graph) return;
  var gNodes = graph.nodes || [];
  memData.all = gNodes.filter(function(n){ return n.type==='memory'; });
  memData.edges = graph.edges || [];
  document.getElementById('mem-st-count').textContent = memData.all.filter(function(n){return n.tier==='short-term';}).length;
  document.getElementById('mem-op-count').textContent = memData.all.filter(function(n){return n.tier==='operational';}).length;
  document.getElementById('mem-lt-count').textContent = memData.all.filter(function(n){return n.tier==='long-term';}).length;
  memApplyFilters();
}

function memApplyFilters() {
  var f = memData.filter, q = memData.search.toLowerCase();
  memData.filtered = memData.all.filter(function(n){
    if (f==='high' && n.importance<0.6) return false;
    if (f!=='all' && f!=='high' && n.tier!==f) return false;
    if (q && n.content.toLowerCase().indexOf(q)===-1 && !n.tags.some(function(t){return t.toLowerCase().indexOf(q)>=0;})) return false;
    return true;
  });
  memData.filtered.sort(function(a,b){ return (b.importance-a.importance)||(b.actuality-a.actuality); });
  document.getElementById('mem-count-badge').textContent = memData.filtered.length + ' of ' + memData.all.length + ' memories';
  memRenderList();
}

function memRenderList() {
  var list = document.getElementById('mem-list');
  list.innerHTML = '';
  memData.filtered.forEach(function(n){
    var div = document.createElement('div');
    div.className = 'memory-card' + (n.id===memData.selectedId?' selected':'');
    var pips = '';
    for (var i=0;i<5;i++) pips += '<div class="importance-pip'+(i<Math.round(n.importance*5)?' filled':'')+'"></div>';
    div.innerHTML =
      '<div class="memory-header"><span class="tier-badge '+tierBadgeClass(n.tier)+'">'+tierLabel(n.tier)+'</span><div class="importance-bar">'+pips+'</div></div>'+
      '<div class="memory-content-text">'+escHtml(n.content)+'</div>'+
      '<div class="memory-meta"><span>actuality: '+n.actuality.toFixed(2)+'</span><span>accessed: '+n.accessCount+'x</span></div>'+
      (n.tags.length?'<div class="memory-tags">'+n.tags.map(function(t){return '<span class="tag">'+escHtml(t)+'</span>';}).join('')+'</div>':'');
    div.addEventListener('click', function(){ memSelect(n.id); });
    list.appendChild(div);
  });
}

function memSelect(id) {
  memData.selectedId = id;
  var n = memData.all.find(function(m){return m.id===id;});
  if (!n) return;
  var panel = document.getElementById('mem-detail');
  panel.className = 'mem-detail-panel has-content';
  var conns = memData.edges.filter(function(e){return e.source===id||e.target===id;});
  panel.innerHTML =
    '<h3>Memory Detail</h3>'+
    '<div class="mem-detail-content">'+escHtml(n.content)+'</div>'+
    '<div class="mem-detail-meta">'+
      '<div><span class="mem-detail-label">ID:</span> '+n.id.slice(0,8)+'...</div>'+
      '<div><span class="mem-detail-label">Tier:</span> '+n.tier+'</div>'+
      '<div><span class="mem-detail-label">Importance:</span> '+n.importance.toFixed(2)+'</div>'+
      '<div><span class="mem-detail-label">Actuality:</span> '+n.actuality.toFixed(2)+'</div>'+
      '<div><span class="mem-detail-label">Accessed:</span> '+n.accessCount+' times</div>'+
      '<div><span class="mem-detail-label">Created:</span> '+new Date(n.createdAt).toLocaleString()+'</div>'+
      '<div><span class="mem-detail-label">Tags:</span> '+(n.tags.length?n.tags.join(', '):'none')+'</div>'+
      '<div><span class="mem-detail-label">Connections:</span> '+conns.length+'</div>'+
    '</div>';
  memRenderList();
}

document.getElementById('mem-filters').addEventListener('click', function(e){
  var btn = e.target.closest('.mem-filter-btn');
  if (!btn) return;
  document.querySelectorAll('.mem-filter-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  memData.filter = btn.dataset.filter;
  memApplyFilters();
});
document.getElementById('mem-search').addEventListener('input', function(e){
  memData.search = e.target.value;
  memApplyFilters();
});

// ================================================================
// KANBAN
// ================================================================
var kanbanData = { columns:[], tasks:[] };
var kanbanLoaded = false;

async function loadKanban() {
  if (kanbanLoaded) return;
  kanbanLoaded = true;
  var colsData = await apiGet('/api/kanban/columns');

  var cols = colsData && Array.isArray(colsData) ? colsData : (colsData && colsData.columns ? colsData.columns : null);
  if (!cols) {
    cols = [
      {id:'backlog',title:'Backlog',columnOrder:0},
      {id:'todo',title:'Todo',columnOrder:1,wipLimit:5},
      {id:'in-progress',title:'In Progress',columnOrder:2,wipLimit:3},
      {id:'review',title:'Review',columnOrder:3},
      {id:'done',title:'Done',columnOrder:4}
    ];
  }
  kanbanData.columns = cols.sort(function(a,b){return (a.columnOrder!=null?a.columnOrder:a.column_order||0)-(b.columnOrder!=null?b.columnOrder:b.column_order||0);});
  // Collect all tasks from columns (API nests them)
  var allTasks = [];
  cols.forEach(function(c){ if (c.tasks && Array.isArray(c.tasks)) { c.tasks.forEach(function(t){ allTasks.push(t); }); } });
  // If columns had nested tasks use them; otherwise fall back to separate fetch
  if (allTasks.length > 0) {
    kanbanData.tasks = allTasks;
  } else {
    var tasksData = await apiGet('/api/tasks');
    kanbanData.tasks = tasksData && Array.isArray(tasksData) ? tasksData : (tasksData && tasksData.tasks ? tasksData.tasks : []);
  }
  renderKanban();
}

function renderKanban() {
  var board = document.getElementById('kanban-board');
  board.innerHTML = '';
  kanbanData.columns.forEach(function(col){
    var colTasks = kanbanData.tasks.filter(function(t){return (t.columnId||t.column_id||t.status)===col.id;});
    colTasks.sort(function(a,b){return (a.columnOrder||0)-(b.columnOrder||0);});

    var colDiv = document.createElement('div');
    colDiv.className = 'kanban-column';
    colDiv.dataset.columnId = col.id;

    var countClass = '';
    var wl = col.wipLimit != null ? col.wipLimit : col.wip_limit;
    if (wl) {
      if (colTasks.length > wl) countClass = ' over-limit';
      else if (colTasks.length >= wl) countClass = ' at-limit';
    }
    var countText = colTasks.length + (wl ? '/'+wl : '');
    colDiv.innerHTML = '<div class="kanban-col-header"><span class="kanban-col-title">'+escHtml(col.title)+'</span><span class="kanban-col-count'+countClass+'">'+countText+'</span></div>';

    var body = document.createElement('div');
    body.className = 'kanban-col-body';

    var addBtn = document.createElement('button');
    addBtn.className = 'kanban-add-btn';
    addBtn.textContent = '+ Add task';
    addBtn.addEventListener('click', function(){ showAddTaskForm(col.id); });
    body.appendChild(addBtn);

    colTasks.forEach(function(task){
      var card = document.createElement('div');
      card.className = 'task-card';
      card.draggable = true;
      card.dataset.taskId = task.id;
      var tags = typeof task.tags==='string' ? JSON.parse(task.tags||'[]') : (task.tags||[]);
      var tagsHtml = tags.length ? '<div class="task-card-tags">'+tags.map(function(t){return '<span class="task-card-tag">'+escHtml(t)+'</span>';}).join('')+'</div>' : '';
      var assigneeIcon = task.assignee==='ai' ? '&#129302;' : (task.assignee ? '&#128100;' : '');
      var commentCount = task.comment_count || 0;
      card.innerHTML =
        '<div class="task-card-title">'+escHtml(task.title)+'</div>'+
        '<div class="task-card-bottom">'+priorityBadge(task.priority)+tagsHtml+
        '<div class="task-card-info">'+(assigneeIcon?'<span class="task-assignee">'+assigneeIcon+'</span>':'')+
        (commentCount>0?'<span>&#128172; '+commentCount+'</span>':'')+'</div></div>';

      card.addEventListener('dragstart', function(e){ e.dataTransfer.setData('text/plain',task.id); card.classList.add('dragging'); });
      card.addEventListener('dragend', function(){ card.classList.remove('dragging'); });
      card.addEventListener('click', function(){ openTaskDetail(task.id); });
      body.appendChild(card);
    });

    colDiv.addEventListener('dragover', function(e){ e.preventDefault(); colDiv.classList.add('drag-over'); });
    colDiv.addEventListener('dragleave', function(){ colDiv.classList.remove('drag-over'); });
    colDiv.addEventListener('drop', function(e){
      e.preventDefault(); colDiv.classList.remove('drag-over');
      var taskId = e.dataTransfer.getData('text/plain');
      if (taskId) moveTask(taskId, col.id);
    });

    colDiv.appendChild(body);
    board.appendChild(colDiv);
  });
}

async function moveTask(taskId, newColumnId) {
  await apiPut('/api/tasks/'+taskId+'/move', { columnId: newColumnId, column_id: newColumnId });
  kanbanLoaded = false;
  await loadKanban();
}

function showAddTaskForm(columnId) {
  var title = prompt('Task title:');
  if (!title) return;
  apiPost('/api/tasks', { title:title, columnId:columnId, priority:'medium', createdBy:'human' }).then(function(){
    kanbanLoaded = false; loadKanban();
  });
}

var _currentTaskId = null;

async function openTaskDetail(taskId) {
  _currentTaskId = taskId;
  var task = kanbanData.tasks.find(function(t){return t.id===taskId;});
  if (!task) return;
  var comments = await apiGet('/api/tasks/'+taskId+'/comments');
  var commentArr = comments && Array.isArray(comments) ? comments : (comments && comments.comments ? comments.comments : []);

  var body = document.getElementById('task-slideout-body');
  var tags = typeof task.tags==='string' ? JSON.parse(task.tags||'[]') : (task.tags||[]);

  var html = '';
  // Editable title
  html += '<div id="td-title-wrap"><h2 class="edit-inline" id="td-title" onclick="tdEditTitle()">'+escHtml(task.title)+'</h2></div>';

  // Priority + Assignee row
  html += '<div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">';
  html += '<div id="td-priority-wrap">';
  html += '<select class="edit-select" id="td-priority" style="width:auto;font-size:11px;padding:2px 6px" onchange="tdSaveField(\\'priority\\',this.value)">';
  ['low','medium','high','critical'].forEach(function(p){
    html += '<option value="'+p+'"'+(task.priority===p?' selected':'')+'>'+p+'</option>';
  });
  html += '</select></div>';
  html += '<div id="td-assignee-wrap" style="display:flex;align-items:center;gap:4px">';
  html += '<span style="font-size:11px;color:#484f58">Assignee:</span>';
  html += '<span class="edit-inline" id="td-assignee" onclick="tdEditAssignee()" style="font-size:12px;color:#8b949e">'+(escHtml(task.assignee)||'unassigned')+'</span>';
  html += '</div>';
  html += '</div>';

  // Description (rendered markdown + edit)
  html += '<div class="task-slideout-section" id="td-desc-section">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><h4 style="margin:0">Description</h4>';
  html += '<button class="edit-btn" onclick="tdEditDesc()" id="td-desc-edit-btn" style="font-size:10px;padding:2px 8px">Edit</button></div>';
  html += '<div id="td-desc-display" class="desc-rendered" style="font-size:13px;line-height:1.6">'+(task.description?renderMarkdown(task.description):'<span style="color:#484f58">No description</span>')+'</div>';
  html += '<div id="td-desc-editor" style="display:none">';
  html += '<textarea class="edit-textarea" id="td-desc-textarea" style="width:100%;min-height:100px">'+escHtml(task.description||'')+'</textarea>';
  html += '<div class="edit-btn-group"><button class="edit-btn save-btn" onclick="tdSaveDesc()">Save</button><button class="edit-btn" onclick="tdCancelDesc()">Cancel</button></div>';
  html += '</div></div>';

  // Tags with chips
  html += '<div class="task-slideout-section"><h4>Tags</h4><div id="td-tags-wrap" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">';
  tags.forEach(function(t,i){ html += '<span class="tag-chip">'+escHtml(t)+'<span class="tag-remove" onclick="tdRemoveTag('+i+')">&times;</span></span>'; });
  html += '<input class="tag-add-input" id="td-tag-input" placeholder="+ tag" onkeydown="tdAddTagKey(event)">';
  html += '</div></div>';

  // Comments with full CRUD
  html += '<div class="task-slideout-section"><h4>Comments ('+commentArr.length+')</h4>';
  html += '<div id="td-comments-list">';
  if (!commentArr.length) { html += '<div style="color:#484f58;font-size:12px">No comments yet</div>'; }
  else {
    commentArr.forEach(function(c){
      html += buildCommentHtml(c);
    });
  }
  html += '</div>';
  // Add comment form
  html += '<div class="add-comment-box"><textarea id="td-new-comment" placeholder="Write a comment..."></textarea>';
  html += '<button onclick="tdAddComment()">Submit</button></div>';
  html += '</div>';

  html += '<div class="task-slideout-section"><h4>Details</h4><div style="font-size:12px;color:#8b949e">';
  html += '<div>Status: '+escHtml(task.status||task.columnId||'')+'</div>';
  html += '<div>Created: '+timeAgo(task.createdAt||task.created_at)+'</div>';
  if (task.updatedAt||task.updated_at) html += '<div>Updated: '+timeAgo(task.updatedAt||task.updated_at)+'</div>';
  html += '</div></div>';

  body.innerHTML = html;

  // Ctrl+Enter to save description
  var descTa = document.getElementById('td-desc-textarea');
  if (descTa) descTa.addEventListener('keydown', function(e){ if (e.ctrlKey && e.key==='Enter') tdSaveDesc(); });

  document.getElementById('task-slideout').classList.add('open');
  document.getElementById('task-overlay').classList.add('open');
}

function buildCommentHtml(c) {
  var bc = (c.authorType||c.author_type)==='ai'?'ai-badge':'human-badge';
  var h = '<div class="comment-item" id="comment-'+c.id+'">';
  h += '<div class="comment-author"><span class="'+bc+'">'+escHtml(c.author||(c.authorType||c.author_type))+'</span>';
  h += '<span class="comment-time" style="margin-left:8px">'+timeAgo(c.createdAt||c.created_at)+'</span>';
  h += '<span class="comment-actions"><button onclick="tdEditComment(\\''+c.id+'\\',this)">Edit</button><button class="delete-btn" onclick="tdDeleteComment(\\''+c.id+'\\')">Delete</button></span>';
  h += '</div>';
  h += '<div class="comment-text" id="comment-text-'+c.id+'">'+escHtml(c.content)+'</div>';
  h += '</div>';
  return h;
}

// -- Task detail edit helpers --
function tdEditTitle() {
  var el = document.getElementById('td-title');
  var current = el.textContent;
  var wrap = document.getElementById('td-title-wrap');
  wrap.innerHTML = '<input class="edit-input" id="td-title-input" value="'+escHtml(current)+'" style="font-size:18px;font-weight:600">';
  var inp = document.getElementById('td-title-input');
  inp.focus(); inp.select();
  inp.addEventListener('keydown', function(e){
    if (e.key==='Enter') { tdSaveField('title', inp.value); wrap.innerHTML='<h2 class="edit-inline" id="td-title" onclick="tdEditTitle()">'+escHtml(inp.value)+'</h2>'; }
    if (e.key==='Escape') { wrap.innerHTML='<h2 class="edit-inline" id="td-title" onclick="tdEditTitle()">'+escHtml(current)+'</h2>'; }
  });
  inp.addEventListener('blur', function(){ setTimeout(function(){ if (document.getElementById('td-title-input')) { wrap.innerHTML='<h2 class="edit-inline" id="td-title" onclick="tdEditTitle()">'+escHtml(current)+'</h2>'; } },150); });
}

function tdEditAssignee() {
  var el = document.getElementById('td-assignee');
  var current = el.textContent === 'unassigned' ? '' : el.textContent;
  var wrap = document.getElementById('td-assignee-wrap');
  var lbl = '<span style="font-size:11px;color:#484f58">Assignee:</span>';
  wrap.innerHTML = lbl+'<input class="edit-input" id="td-assignee-input" value="'+escHtml(current)+'" style="width:120px;font-size:12px">';
  var inp = document.getElementById('td-assignee-input');
  inp.focus();
  inp.addEventListener('keydown', function(e){
    if (e.key==='Enter') { tdSaveField('assignee', inp.value); wrap.innerHTML=lbl+'<span class="edit-inline" id="td-assignee" onclick="tdEditAssignee()" style="font-size:12px;color:#8b949e">'+(escHtml(inp.value)||'unassigned')+'</span>'; }
    if (e.key==='Escape') { wrap.innerHTML=lbl+'<span class="edit-inline" id="td-assignee" onclick="tdEditAssignee()" style="font-size:12px;color:#8b949e">'+(escHtml(current)||'unassigned')+'</span>'; }
  });
  inp.addEventListener('blur', function(){ setTimeout(function(){ if (document.getElementById('td-assignee-input')) { wrap.innerHTML=lbl+'<span class="edit-inline" id="td-assignee" onclick="tdEditAssignee()" style="font-size:12px;color:#8b949e">'+(escHtml(current)||'unassigned')+'</span>'; } },150); });
}

function tdEditDesc() {
  document.getElementById('td-desc-display').style.display = 'none';
  document.getElementById('td-desc-editor').style.display = '';
  document.getElementById('td-desc-edit-btn').style.display = 'none';
}
function tdCancelDesc() {
  document.getElementById('td-desc-display').style.display = '';
  document.getElementById('td-desc-editor').style.display = 'none';
  document.getElementById('td-desc-edit-btn').style.display = '';
}
async function tdSaveDesc() {
  var val = document.getElementById('td-desc-textarea').value;
  await tdSaveField('description', val);
  document.getElementById('td-desc-display').innerHTML = val ? renderMarkdown(val) : '<span style="color:#484f58">No description</span>';
  tdCancelDesc();
}

async function tdSaveField(field, value) {
  if (!_currentTaskId) return;
  var body = {};
  body[field] = value;
  var result = await apiPut('/api/tasks/'+_currentTaskId, body);
  if (result) {
    var idx = kanbanData.tasks.findIndex(function(t){return t.id===_currentTaskId;});
    if (idx>=0) { kanbanData.tasks[idx][field] = value; }
  }
}

function tdRemoveTag(index) {
  if (!_currentTaskId) return;
  var task = kanbanData.tasks.find(function(t){return t.id===_currentTaskId;});
  if (!task) return;
  var tags = typeof task.tags==='string' ? JSON.parse(task.tags||'[]') : (task.tags||[]);
  tags.splice(index, 1);
  tdSaveField('tags', tags);
  openTaskDetail(_currentTaskId);
}
function tdAddTagKey(e) {
  if (e.key!=='Enter') return;
  var inp = document.getElementById('td-tag-input');
  var val = inp.value.trim();
  if (!val) return;
  var task = kanbanData.tasks.find(function(t){return t.id===_currentTaskId;});
  if (!task) return;
  var tags = typeof task.tags==='string' ? JSON.parse(task.tags||'[]') : (task.tags||[]);
  if (tags.indexOf(val)<0) tags.push(val);
  tdSaveField('tags', tags);
  openTaskDetail(_currentTaskId);
}

// Comment CRUD
async function tdAddComment() {
  var ta = document.getElementById('td-new-comment');
  var content = ta.value.trim();
  if (!content || !_currentTaskId) return;
  await apiPost('/api/tasks/'+_currentTaskId+'/comments', { content: content, author:'human', author_type:'human' });
  ta.value = '';
  // Re-render comments
  var comments = await apiGet('/api/tasks/'+_currentTaskId+'/comments');
  var commentArr = comments && Array.isArray(comments) ? comments : [];
  var list = document.getElementById('td-comments-list');
  if (!commentArr.length) { list.innerHTML = '<div style="color:#484f58;font-size:12px">No comments yet</div>'; }
  else { list.innerHTML = commentArr.map(buildCommentHtml).join(''); }
}

function tdEditComment(commentId, btn) {
  var textEl = document.getElementById('comment-text-'+commentId);
  var current = textEl.textContent;
  textEl.innerHTML = '<textarea class="edit-textarea" id="comment-edit-'+commentId+'" style="width:100%;min-height:50px">'+escHtml(current)+'</textarea>'+
    '<div class="edit-btn-group"><button class="edit-btn save-btn" onclick="tdSaveComment(\\''+commentId+'\\')">Save</button><button class="edit-btn" onclick="tdCancelEditComment(\\''+commentId+'\\',\\''+escHtml(current).replace(/'/g,"\\\\'")+'\\')" >Cancel</button></div>';
  document.getElementById('comment-edit-'+commentId).focus();
}
async function tdSaveComment(commentId) {
  var ta = document.getElementById('comment-edit-'+commentId);
  if (!ta) return;
  var content = ta.value.trim();
  if (!content) return;
  await apiPut('/api/tasks/'+_currentTaskId+'/comments/'+commentId, { content: content });
  document.getElementById('comment-text-'+commentId).textContent = content;
}
function tdCancelEditComment(commentId, original) {
  document.getElementById('comment-text-'+commentId).textContent = original;
}
async function tdDeleteComment(commentId) {
  if (!confirm('Delete this comment?')) return;
  await apiDelete('/api/tasks/'+_currentTaskId+'/comments/'+commentId);
  var el = document.getElementById('comment-'+commentId);
  if (el) el.remove();
}

document.getElementById('task-slideout-close').addEventListener('click', closeTaskSlideout);
document.getElementById('task-overlay').addEventListener('click', closeTaskSlideout);
function closeTaskSlideout() {
  document.getElementById('task-slideout').classList.remove('open');
  document.getElementById('task-overlay').classList.remove('open');
  _currentTaskId = null;
}

// ================================================================
// SPECS
// ================================================================
var specsData = { list:[] };
var specsLoaded = false;

async function loadSpecs() {
  if (specsLoaded) return;
  specsLoaded = true;
  var data = await apiGet('/api/specs');
  specsData.list = data && Array.isArray(data) ? data : (data && data.specs ? data.specs : []);
  renderSpecsList();
}

function renderSpecsList() {
  document.getElementById('specs-list-view').style.display = '';
  document.getElementById('spec-detail-view').classList.remove('active');
  var grid = document.getElementById('specs-grid');
  if (!specsData.list.length) { grid.innerHTML = '<div class="empty-state">No specifications found</div>'; return; }
  grid.innerHTML = '';
  specsData.list.forEach(function(spec){
    var card = document.createElement('div');
    card.className = 'spec-card';
    var status = spec.status || 'draft';
    var statusCls = 'spec-status-'+status.replace(/\\s+/g,'-');
    var tags = typeof spec.tags==='string' ? JSON.parse(spec.tags||'[]') : (spec.tags||[]);
    card.innerHTML =
      '<div class="spec-card-title">'+escHtml(spec.title)+'</div>'+
      '<span class="spec-status-badge '+statusCls+'">'+escHtml(status)+'</span>'+
      (tags.length?'<div class="spec-card-tags">'+tags.map(function(t){return '<span class="tag">'+escHtml(t)+'</span>';}).join('')+'</div>':'')+
      '<div class="spec-card-meta">Updated '+timeAgo(spec.updatedAt||spec.updated_at)+'</div>';
    card.addEventListener('click', function(){ openSpecDetail(spec.id); });
    grid.appendChild(card);
  });
}

// ── Spec block editor state ──
var specEditor = { specId:null, blocks:[], saveTimer:null, dirty:false };

var SLASH_COMMANDS = [
  { cmd:'h1', label:'Heading 1', icon:'H1', type:'h1' },
  { cmd:'h2', label:'Heading 2', icon:'H2', type:'h2' },
  { cmd:'h3', label:'Heading 3', icon:'H3', type:'h3' },
  { cmd:'code', label:'Code Block', icon:'{ }', type:'code' },
  { cmd:'list', label:'Bullet List', icon:'\\u2022', type:'list' },
  { cmd:'quote', label:'Blockquote', icon:'\\u201C', type:'quote' },
  { cmd:'divider', label:'Divider', icon:'\\u2014', type:'divider' },
  { cmd:'checklist', label:'Checklist', icon:'\\u2611', type:'checklist' }
];

function parseMarkdownToBlocks(md) {
  if (!md || !md.trim()) return [{ type:'paragraph', content:'' }];
  var blocks = [], lines = md.split('\\n'), i = 0;
  while (i < lines.length) {
    var line = lines[i];
    if (line.match(/^\`\`\`/)) {
      var code = [];
      i++;
      while (i < lines.length && !lines[i].match(/^\`\`\`/)) { code.push(lines[i]); i++; }
      blocks.push({ type:'code', content: code.join('\\n') });
      i++; continue;
    }
    if (line.match(/^### /)) { blocks.push({ type:'h3', content: line.slice(4) }); i++; continue; }
    if (line.match(/^## /)) { blocks.push({ type:'h2', content: line.slice(3) }); i++; continue; }
    if (line.match(/^# /)) { blocks.push({ type:'h1', content: line.slice(2) }); i++; continue; }
    if (line.match(/^---+$/)) { blocks.push({ type:'divider', content:'' }); i++; continue; }
    if (line.match(/^>\\s?/)) { blocks.push({ type:'quote', content: line.replace(/^>\\s?/,'') }); i++; continue; }
    if (line.match(/^- \\[[ x]\\]/)) { blocks.push({ type:'checklist', content: line.replace(/^- \\[[ x]\\]\\s?/,''), checked: line.indexOf('[x]')>=0 }); i++; continue; }
    if (line.match(/^\\s*[-*]\\s/)) { blocks.push({ type:'list', content: line.replace(/^\\s*[-*]\\s/,'') }); i++; continue; }
    if (line.trim()==='') { i++; continue; }
    blocks.push({ type:'paragraph', content: line });
    i++;
  }
  if (!blocks.length) blocks.push({ type:'paragraph', content:'' });
  return blocks;
}

function serializeBlocksToMarkdown(blocks) {
  return blocks.map(function(b) {
    switch(b.type) {
      case 'h1': return '# '+b.content;
      case 'h2': return '## '+b.content;
      case 'h3': return '### '+b.content;
      case 'code': return '\`\`\`\\n'+b.content+'\\n\`\`\`';
      case 'list': return '- '+b.content;
      case 'quote': return '> '+b.content;
      case 'divider': return '---';
      case 'checklist': return '- ['+(b.checked?'x':' ')+'] '+b.content;
      default: return b.content;
    }
  }).join('\\n');
}

function specScheduleSave() {
  specEditor.dirty = true;
  var indicator = document.getElementById('spec-save-indicator');
  if (indicator) { indicator.textContent = 'Unsaved'; indicator.className = 'spec-save-indicator'; }
  if (specEditor.saveTimer) clearTimeout(specEditor.saveTimer);
  specEditor.saveTimer = setTimeout(specDoSave, 1000);
}

async function specDoSave() {
  if (!specEditor.specId) return;
  var indicator = document.getElementById('spec-save-indicator');
  if (indicator) { indicator.textContent = 'Saving...'; indicator.className = 'spec-save-indicator saving'; }
  // Read content from DOM
  specSyncBlocksFromDom();
  var md = serializeBlocksToMarkdown(specEditor.blocks);
  await apiPut('/api/specs/'+specEditor.specId, { content: md, summary: 'Dashboard edit' });
  specEditor.dirty = false;
  if (indicator) { indicator.textContent = 'Saved'; indicator.className = 'spec-save-indicator saved'; }
}

function specSyncBlocksFromDom() {
  var container = document.getElementById('spec-blocks-container');
  if (!container) return;
  var els = container.querySelectorAll('.spec-block');
  specEditor.blocks = [];
  els.forEach(function(el) {
    specEditor.blocks.push({
      type: el.dataset.type || 'paragraph',
      content: el.dataset.type==='divider' ? '' : el.innerText,
      checked: el.dataset.checked === 'true'
    });
  });
}

function specRenderBlocks() {
  var container = document.getElementById('spec-blocks-container');
  if (!container) return;
  container.innerHTML = '';
  specEditor.blocks.forEach(function(block, idx) {
    container.appendChild(specCreateBlockEl(block, idx));
  });
}

function specCreateBlockEl(block, idx) {
  var div = document.createElement('div');
  div.className = 'spec-block';
  div.dataset.type = block.type;
  div.dataset.index = idx;
  if (block.type === 'divider') {
    div.contentEditable = 'false';
    return div;
  }
  if (block.type === 'checklist') {
    div.dataset.checked = block.checked ? 'true' : 'false';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!block.checked;
    cb.style.cssText = 'position:absolute;left:22px;top:6px;cursor:pointer';
    cb.addEventListener('change', function(){ div.dataset.checked = cb.checked?'true':'false'; specScheduleSave(); });
    div.appendChild(cb);
    div.style.paddingLeft = '40px';
  }
  div.contentEditable = 'true';
  var handle = document.createElement('span');
  handle.className = 'block-handle';
  handle.textContent = '\\u2261';
  div.appendChild(handle);
  var textNode = document.createTextNode(block.content);
  div.appendChild(textNode);

  div.addEventListener('input', function() { specScheduleSave(); specCheckSlash(div); });
  div.addEventListener('keydown', function(e) { specBlockKeydown(e, div, idx); });
  return div;
}

function specCheckSlash(el) {
  var text = el.innerText;
  if (text.indexOf('/') === 0 && text.length >= 1) {
    var query = text.slice(1).toLowerCase();
    var filtered = SLASH_COMMANDS.filter(function(c){ return c.cmd.indexOf(query)===0 || c.label.toLowerCase().indexOf(query)>=0; });
    if (filtered.length) {
      specShowSlashMenu(el, filtered);
      return;
    }
  }
  specHideSlashMenu();
}

var _slashMenuActive = false, _slashMenuIdx = 0, _slashMenuItems = [], _slashMenuTarget = null;

function specShowSlashMenu(targetEl, items) {
  _slashMenuActive = true;
  _slashMenuIdx = 0;
  _slashMenuItems = items;
  _slashMenuTarget = targetEl;
  var menu = document.getElementById('slash-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'slash-menu';
    menu.className = 'slash-menu';
    document.body.appendChild(menu);
  }
  menu.innerHTML = '';
  items.forEach(function(item, i) {
    var row = document.createElement('div');
    row.className = 'slash-menu-item' + (i===0?' active':'');
    row.innerHTML = '<span class="slash-menu-icon">'+item.icon+'</span><span class="slash-menu-label">'+item.label+'</span><span class="slash-menu-hint">/'+item.cmd+'</span>';
    row.addEventListener('click', function(){ specApplySlashCommand(item); });
    row.addEventListener('mouseenter', function(){ _slashMenuIdx=i; specUpdateSlashHighlight(); });
    menu.appendChild(row);
  });
  var rect = targetEl.getBoundingClientRect();
  menu.style.display = 'block';
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
}

function specUpdateSlashHighlight() {
  var menu = document.getElementById('slash-menu');
  if (!menu) return;
  var items = menu.querySelectorAll('.slash-menu-item');
  items.forEach(function(el, i) { el.classList.toggle('active', i===_slashMenuIdx); });
}

function specHideSlashMenu() {
  _slashMenuActive = false;
  var menu = document.getElementById('slash-menu');
  if (menu) menu.style.display = 'none';
}

function specApplySlashCommand(cmd) {
  specHideSlashMenu();
  if (!_slashMenuTarget) return;
  _slashMenuTarget.innerText = '';
  _slashMenuTarget.dataset.type = cmd.type;
  _slashMenuTarget.className = 'spec-block';
  // Re-apply handle
  var handle = document.createElement('span');
  handle.className = 'block-handle';
  handle.textContent = '\\u2261';
  _slashMenuTarget.insertBefore(handle, _slashMenuTarget.firstChild);
  if (cmd.type === 'divider') {
    _slashMenuTarget.contentEditable = 'false';
    // Create new block below
    specSyncBlocksFromDom();
    var nextIdx = parseInt(_slashMenuTarget.dataset.index) + 1;
    specEditor.blocks.splice(nextIdx, 0, { type:'paragraph', content:'' });
    specRenderBlocks();
    var container = document.getElementById('spec-blocks-container');
    var nextEl = container.children[nextIdx];
    if (nextEl) nextEl.focus();
  } else {
    _slashMenuTarget.focus();
  }
  specScheduleSave();
}

function specBlockKeydown(e, el, idx) {
  // Slash menu navigation
  if (_slashMenuActive) {
    if (e.key==='ArrowDown') { e.preventDefault(); _slashMenuIdx = Math.min(_slashMenuIdx+1, _slashMenuItems.length-1); specUpdateSlashHighlight(); return; }
    if (e.key==='ArrowUp') { e.preventDefault(); _slashMenuIdx = Math.max(_slashMenuIdx-1, 0); specUpdateSlashHighlight(); return; }
    if (e.key==='Enter') { e.preventDefault(); specApplySlashCommand(_slashMenuItems[_slashMenuIdx]); return; }
    if (e.key==='Escape') { e.preventDefault(); specHideSlashMenu(); return; }
  }

  // Inline formatting
  if (e.ctrlKey || e.metaKey) {
    if (e.key==='b') { e.preventDefault(); document.execCommand('bold'); specScheduleSave(); return; }
    if (e.key==='i') { e.preventDefault(); document.execCommand('italic'); specScheduleSave(); return; }
    if (e.key==='e') {
      e.preventDefault();
      var sel = window.getSelection();
      if (sel.rangeCount) {
        var range = sel.getRangeAt(0);
        var code = document.createElement('code');
        code.style.cssText = 'background:#21262d;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:12px';
        range.surroundContents(code);
        specScheduleSave();
      }
      return;
    }
  }

  // Enter creates new block
  if (e.key==='Enter' && !e.shiftKey) {
    e.preventDefault();
    specSyncBlocksFromDom();
    var newIdx = parseInt(el.dataset.index) + 1;
    specEditor.blocks.splice(newIdx, 0, { type:'paragraph', content:'' });
    specRenderBlocks();
    var container = document.getElementById('spec-blocks-container');
    var newEl = container.children[newIdx];
    if (newEl) newEl.focus();
    return;
  }

  // Backspace on empty block removes it
  if (e.key==='Backspace' && el.innerText.trim()==='' && el.dataset.type!=='divider') {
    specSyncBlocksFromDom();
    if (specEditor.blocks.length <= 1) return;
    var rmIdx = parseInt(el.dataset.index);
    specEditor.blocks.splice(rmIdx, 1);
    specRenderBlocks();
    var container = document.getElementById('spec-blocks-container');
    var focusIdx = Math.max(0, rmIdx - 1);
    if (container.children[focusIdx]) container.children[focusIdx].focus();
    e.preventDefault();
    return;
  }
}

async function openSpecDetail(specId) {
  specEditor.specId = specId;
  var spec = await apiGet('/api/specs/'+specId);
  if (!spec) return;
  var versions = await apiGet('/api/specs/'+specId+'/versions');
  var vArr = versions && Array.isArray(versions) ? versions : (versions && versions.versions ? versions.versions : []);

  document.getElementById('specs-list-view').style.display = 'none';
  document.getElementById('spec-detail-view').classList.add('active');

  var main = document.getElementById('spec-detail-main');
  var sidebar = document.getElementById('spec-detail-sidebar');

  // Parse content into blocks
  specEditor.blocks = parseMarkdownToBlocks(spec.content || '');

  main.innerHTML = '<button class="spec-back-btn" id="spec-back-btn">&#8592; Back to Specs</button>' +
    '<div class="spec-editor-wrap"><span class="spec-save-indicator" id="spec-save-indicator">Saved</span>'+
    '<div id="spec-blocks-container"></div></div>';
  document.getElementById('spec-back-btn').addEventListener('click', function(){
    if (specEditor.dirty) specDoSave();
    specEditor.specId = null;
    specsLoaded = false;
    loadSpecs();
  });

  specRenderBlocks();

  // Sidebar: status dropdown, tags, dates, versions, linked tasks
  var tags = typeof spec.tags==='string' ? JSON.parse(spec.tags||'[]') : (spec.tags||[]);
  var sh = '<h4>Status</h4>';
  sh += '<select class="edit-select" id="spec-status-select" style="width:100%;margin-bottom:8px">';
  ['draft','in-review','approved','in-progress','completed','archived'].forEach(function(s){
    sh += '<option value="'+s+'"'+((spec.status||'draft')===s?' selected':'')+'>'+s+'</option>';
  });
  sh += '</select>';

  sh += '<h4>Tags</h4>';
  sh += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">';
  tags.forEach(function(t){ sh += '<span class="tag">'+escHtml(t)+'</span>'; });
  if (!tags.length) sh += '<span style="font-size:12px;color:#484f58">No tags</span>';
  sh += '</div>';

  sh += '<h4>Created</h4><div style="font-size:12px;color:#8b949e;margin-bottom:8px">'+new Date(spec.createdAt||spec.created_at).toLocaleString()+'</div>';
  sh += '<h4>Updated</h4><div style="font-size:12px;color:#8b949e;margin-bottom:8px">'+new Date(spec.updatedAt||spec.updated_at).toLocaleString()+'</div>';

  sh += '<h4>Version History</h4>';
  if (!vArr.length) sh += '<div style="color:#484f58;font-size:12px">No versions</div>';
  else vArr.forEach(function(v){
    sh += '<div class="spec-version-item"><span class="spec-version-num">v'+(v.version||v.id||'?')+'</span>';
    sh += '<div class="spec-version-meta">'+escHtml(v.author||'')+' &mdash; '+escHtml(v.summary||'')+'</div>';
    sh += '<div class="spec-version-meta">'+timeAgo(v.timestamp||v.created_at)+'</div></div>';
  });

  if (spec.linked_tasks && spec.linked_tasks.length) {
    sh += '<h4>Linked Tasks</h4>';
    spec.linked_tasks.forEach(function(lt){
      sh += '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid #21262d">'+escHtml(typeof lt==='string'?lt:lt.title||lt.id)+'</div>';
    });
  }
  if (spec.linked_memories && spec.linked_memories.length) {
    sh += '<h4>Linked Memories</h4>';
    spec.linked_memories.forEach(function(lm){
      sh += '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid #21262d">'+escHtml(typeof lm==='string'?lm:lm.content||lm.id)+'</div>';
    });
  }
  sidebar.innerHTML = sh;

  // Status change handler
  document.getElementById('spec-status-select').addEventListener('change', function(){
    apiPut('/api/specs/'+specId, { status: this.value });
  });

  // Close slash menu on outside click
  document.addEventListener('click', function(e) {
    if (_slashMenuActive && !e.target.closest('.slash-menu') && !e.target.closest('.spec-block')) {
      specHideSlashMenu();
    }
  });
}

function renderMarkdown(md) {
  if (!md) return '<p style="color:#484f58">No content</p>';
  var lines = md.split('\\n');
  var html = '', inCode = false, inList = false, lt = '';
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim().indexOf('\`\`\`') === 0) {
      if (inCode) { html += '</code></pre>'; inCode = false; }
      else { if (inList) { html += lt==='ul'?'</ul>':'</ol>'; inList = false; } inCode = true; html += '<pre><code>'; }
      continue;
    }
    if (inCode) { html += escHtml(line) + '\\n'; continue; }
    if (inList && !line.match(/^\\s*[-*]\\s/) && !line.match(/^\\s*\\d+\\.\\s/) && line.trim()!=='') {
      html += lt==='ul'?'</ul>':'</ol>'; inList = false;
    }
    if (line.trim()==='') continue;
    if (line.match(/^### /)) { html += '<h3>'+inlineFmt(line.slice(4))+'</h3>'; continue; }
    if (line.match(/^## /)) { html += '<h2>'+inlineFmt(line.slice(3))+'</h2>'; continue; }
    if (line.match(/^# /)) { html += '<h1>'+inlineFmt(line.slice(2))+'</h1>'; continue; }
    if (line.match(/^---+$/)) { html += '<hr style="border:none;border-top:1px solid #30363d;margin:12px 0">'; continue; }
    if (line.match(/^\\s*[-*]\\s/)) {
      if (!inList) { html += '<ul>'; inList = true; lt = 'ul'; }
      html += '<li>'+inlineFmt(line.replace(/^\\s*[-*]\\s/,''))+'</li>'; continue;
    }
    if (line.match(/^\\s*\\d+\\.\\s/)) {
      if (!inList) { html += '<ol>'; inList = true; lt = 'ol'; }
      html += '<li>'+inlineFmt(line.replace(/^\\s*\\d+\\.\\s/,''))+'</li>'; continue;
    }
    html += '<p>'+inlineFmt(line)+'</p>';
  }
  if (inCode) html += '</code></pre>';
  if (inList) html += lt==='ul'?'</ul>':'</ol>';
  return html;
}
function inlineFmt(t) {
  var s = escHtml(t);
  s = s.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
  s = s.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
  s = s.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2" style="color:#58a6ff" target="_blank">$1</a>');
  return s;
}

// ================================================================
// GRAPH
// ================================================================
var graphState = { nodes:[], edges:[], graphNodes:[], dragging:null, selectedId:null, alpha:1.0, initialized:false };
var TIER_COLORS = { 'short-term':'#3fb950', 'operational':'#58a6ff', 'long-term':'#bc8cff' };
var EDGE_COLORS = { causal:'#8b949e', contradicts:'#f85149', supports:'#3fb950', temporal:'#d29922', similar:'#484f58', related:'#d29922', decision:'#58a6ff', implements:'#a371f7', blocker:'#f85149', caused_by:'#f8514988' };

async function initGraphView() {
  var canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  var ct = canvas.getContext('2d');
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  if (graphState.initialized) return;
  graphState.initialized = true;

  var graphData = await apiGet('/api/graph');
  var allN = graphData ? graphData.nodes||[] : [];
  var allEdges = graphData ? graphData.edges||[] : [];

  // Normalize node properties — /api/graph already includes memory, task, and spec nodes
  allN = allN.map(function(n){
    return {
      id: n.id,
      type: n.type || 'memory',
      label: n.label || n.content || n.title || '',
      tier: n.tier,
      importance: n.importance,
      actuality: n.actuality,
      tags: typeof n.tags === 'string' ? JSON.parse(n.tags || '[]') : (n.tags || []),
      accessCount: n.accessCount || 0,
      createdAt: n.createdAt,
      priority: n.priority,
      status: n.status
    };
  });

  graphState.nodes = allN;
  graphState.edges = allEdges.slice();

  var W = canvas.width, H = canvas.height;
  graphState.graphNodes = allN.map(function(n){
    var r = n.type==='memory' ? 5+(n.importance||0.5)*12 : n.type==='task' ? 10 : 9;
    return { id:n.id, type:n.type, label:n.label, tier:n.tier, importance:n.importance,
      actuality:n.actuality, tags:n.tags, priority:n.priority, status:n.status,
      accessCount:n.accessCount, createdAt:n.createdAt,
      x: W/2+(Math.random()-0.5)*Math.min(W,600), y: H/2+(Math.random()-0.5)*Math.min(H,400),
      vx:0, vy:0, r:r };
  });
  graphState.alpha = 1.0;
  graphState.selectedId = null;
  gTick(canvas,ct); gDraw(canvas,ct);

  canvas.onmousemove = function(e){
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX-rect.left, my = e.clientY-rect.top;
    if (graphState.dragging) { graphState.dragging.x=mx; graphState.dragging.y=my; return; }
    var hit = null;
    for (var i=0;i<graphState.graphNodes.length;i++) {
      var nd=graphState.graphNodes[i], dx=mx-nd.x, dy=my-nd.y;
      if (dx*dx+dy*dy<nd.r*nd.r) { hit=nd; break; }
    }
    var tip = document.getElementById('graph-tooltip');
    if (hit) {
      tip.style.display='block'; tip.style.left=(e.clientX+14)+'px'; tip.style.top=(e.clientY+14)+'px';
      var lbl=hit.label||'', trunc=lbl.length>150?lbl.slice(0,147)+'...':lbl;
      var color=hit.type==='task'?'#d29922':hit.type==='spec'?'#a371f7':(TIER_COLORS[hit.tier]||'#8b949e');
      tip.innerHTML='<div style="color:'+color+';font-weight:600;font-size:10px;text-transform:uppercase">'+hit.type+(hit.tier?' ('+hit.tier+')':'')+'</div><div style="margin-top:4px">'+escHtml(trunc)+'</div>';
      canvas.style.cursor='pointer';
    } else { tip.style.display='none'; canvas.style.cursor='default'; }
  };
  canvas.onmousedown = function(e){
    var rect=canvas.getBoundingClientRect(), mx=e.clientX-rect.left, my=e.clientY-rect.top;
    for (var i=0;i<graphState.graphNodes.length;i++) {
      var nd=graphState.graphNodes[i], dx=mx-nd.x, dy=my-nd.y;
      if (dx*dx+dy*dy<nd.r*nd.r) { graphState.dragging=nd; nd.vx=0; nd.vy=0; graphState.alpha=Math.max(graphState.alpha,0.3); graphState.selectedId=nd.id; break; }
    }
  };
  canvas.onmouseup = function(){ graphState.dragging=null; };

  window.addEventListener('resize', function(){
    if (currentRoute==='graph') { canvas.width=canvas.parentElement.clientWidth; canvas.height=canvas.parentElement.clientHeight; }
  });
}

function gTick(canvas, ct) {
  if (graphState.alpha<0.005) { graphState.graphNodes.forEach(function(n){n.vx=0;n.vy=0;}); return; }
  graphState.alpha *= 0.95;
  var W=canvas.width, H=canvas.height, gn=graphState.graphNodes;
  for (var i=0;i<gn.length;i++) {
    for (var j=i+1;j<gn.length;j++) {
      var dx=gn[j].x-gn[i].x, dy=gn[j].y-gn[i].y, dist=Math.sqrt(dx*dx+dy*dy);
      if (dist<1) dist=1; if (dist>300) continue;
      var force=-400*graphState.alpha/(dist*dist);
      var fx=(dx/dist)*force, fy=(dy/dist)*force;
      gn[i].vx-=fx; gn[i].vy-=fy; gn[j].vx+=fx; gn[j].vy+=fy;
    }
  }
  var nodeMap={}; gn.forEach(function(n){nodeMap[n.id]=n;});
  graphState.edges.forEach(function(e){
    var a=nodeMap[e.source], b=nodeMap[e.target];
    if (!a||!b) return;
    var dx=b.x-a.x, dy=b.y-a.y, dist=Math.sqrt(dx*dx+dy*dy)||1;
    var force=(dist-80)*0.005*(e.strength||0.5)*graphState.alpha;
    a.vx+=(dx/dist)*force; a.vy+=(dy/dist)*force;
    b.vx-=(dx/dist)*force; b.vy-=(dy/dist)*force;
  });
  gn.forEach(function(n){
    n.vx+=(W/2-n.x)*0.0005*graphState.alpha; n.vy+=(H/2-n.y)*0.0005*graphState.alpha;
    n.vx*=0.4; n.vy*=0.4;
    if (n!==graphState.dragging) { n.x+=n.vx; n.y+=n.vy; }
    n.x=Math.max(n.r,Math.min(W-n.r,n.x)); n.y=Math.max(n.r,Math.min(H-n.r,n.y));
  });
}

function gDraw(canvas, ct) {
  var W=canvas.width, H=canvas.height;
  ct.clearRect(0,0,W,H);
  var nodeMap={}; graphState.graphNodes.forEach(function(n){nodeMap[n.id]=n;});
  var sel=graphState.selectedId;

  graphState.edges.forEach(function(e){
    var a=nodeMap[e.source], b=nodeMap[e.target];
    if (!a||!b) return;
    ct.beginPath(); ct.moveTo(a.x,a.y); ct.lineTo(b.x,b.y);
    ct.strokeStyle=EDGE_COLORS[e.type]||'#30363d';
    var isH=sel&&(e.source===sel||e.target===sel);
    ct.globalAlpha=isH?0.9:0.25; ct.lineWidth=isH?2.5:1;
    ct.stroke(); ct.globalAlpha=1;
  });

  graphState.graphNodes.forEach(function(n){
    var isS=n.id===sel;
    var isC=sel&&graphState.edges.some(function(e){return (e.source===sel&&e.target===n.id)||(e.target===sel&&e.source===n.id);});
    var dim=sel&&!isS&&!isC;

    if (n.type==='task') {
      ct.fillStyle='#d29922'; ct.globalAlpha=dim?0.12:0.8;
      ct.fillRect(n.x-n.r,n.y-n.r,n.r*2,n.r*2); ct.globalAlpha=1;
      ct.strokeStyle=isS?'#f0f6fc':'#30363d'; ct.lineWidth=isS?2.5:1;
      ct.strokeRect(n.x-n.r,n.y-n.r,n.r*2,n.r*2);
    } else if (n.type==='spec') {
      ct.beginPath();
      for (var p=0;p<5;p++) {
        var angle=(p*2*Math.PI/5)-Math.PI/2;
        var px=n.x+n.r*Math.cos(angle), py=n.y+n.r*Math.sin(angle);
        if (p===0) ct.moveTo(px,py); else ct.lineTo(px,py);
      }
      ct.closePath(); ct.fillStyle='#a371f7'; ct.globalAlpha=dim?0.12:0.8;
      ct.fill(); ct.globalAlpha=1;
      ct.strokeStyle=isS?'#f0f6fc':'#30363d'; ct.lineWidth=isS?2.5:1; ct.stroke();
    } else {
      ct.beginPath(); ct.arc(n.x,n.y,n.r,0,Math.PI*2);
      ct.fillStyle=TIER_COLORS[n.tier]||'#8b949e';
      ct.globalAlpha=dim?0.12:(0.35+(n.actuality||0.5)*0.65);
      ct.fill(); ct.globalAlpha=1;
      ct.strokeStyle=isS?'#f0f6fc':'#30363d'; ct.lineWidth=isS?2.5:1; ct.stroke();
    }
  });
  requestAnimationFrame(function(){ gTick(canvas,ct); gDraw(canvas,ct); });
}

// ================================================================
// REFRESH HELPERS (for SSE and polling)
// ================================================================
function refreshDashboard() {
  dashLoaded = false;
  loadDashboard();
}
function refreshMemories() {
  memLoaded = false;
  loadMemories();
}
function refreshKanban() {
  kanbanLoaded = false;
  loadKanban();
}
function refreshSpecs() {
  specsLoaded = false;
  loadSpecs();
}
function refreshGraph() {
  graphState.initialized = false;
  initGraphView();
}

// ================================================================
// SSE REAL-TIME UPDATES
// ================================================================
function showToast(eventType, data) {
  var container = document.getElementById('sse-toast-container');
  var toast = document.createElement('div');
  toast.className = 'sse-toast';
  var label = eventType.replace(':', ' ');
  var detail = '';
  if (data) {
    if (data.title) detail = data.title;
    else if (data.content && data.content.length > 60) detail = data.content.slice(0, 60) + '...';
    else if (data.content) detail = data.content;
  }
  toast.innerHTML = '<div class="sse-toast-type">' + escHtml(label) + '</div>' +
    (detail ? '<div>' + escHtml(detail) + '</div>' : '');
  container.appendChild(toast);
  setTimeout(function() {
    toast.classList.add('fade-out');
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }, 3000);
}

function handleSseEvent(eventType, data) {
  showToast(eventType, data);

  // Refresh the currently visible view based on event type
  if (eventType.startsWith('task:') || eventType.startsWith('comment:')) {
    if (currentRoute === 'kanban') refreshKanban();
    if (currentRoute === 'dashboard') refreshDashboard();
    if (currentRoute === 'graph') refreshGraph();
  }
  if (eventType.startsWith('memory:')) {
    if (currentRoute === 'memories') refreshMemories();
    if (currentRoute === 'dashboard') refreshDashboard();
    if (currentRoute === 'graph') refreshGraph();
  }
  if (eventType.startsWith('spec:')) {
    if (currentRoute === 'specs') refreshSpecs();
    if (currentRoute === 'dashboard') refreshDashboard();
    if (currentRoute === 'graph') refreshGraph();
  }
}

// Connect SSE
var sseEvents = [
  'task:created', 'task:updated', 'task:deleted',
  'comment:created', 'comment:updated', 'comment:deleted',
  'memory:created', 'memory:updated',
  'spec:created', 'spec:updated'
];
var evtSource = new EventSource('/api/events');
sseEvents.forEach(function(evt) {
  evtSource.addEventListener(evt, function(e) {
    var data = null;
    try { data = JSON.parse(e.data); } catch(err) { /* ignore */ }
    handleSseEvent(evt, data);
  });
});

// Polling fallback for MCP mutations (every 5 seconds)
setInterval(function() {
  if (currentRoute === 'kanban') refreshKanban();
  else if (currentRoute === 'dashboard') refreshDashboard();
  else if (currentRoute === 'memories') refreshMemories();
  else if (currentRoute === 'specs') refreshSpecs();
}, 5000);

// -- Init --
var initRoute = window.location.hash.replace('#/','') || 'dashboard';
navigate(initRoute);
</script>
</body>
</html>`;
}

function handleRequest(
  apiHandler: ApiRequestHandler,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = req.url ?? '/';
  if (url.startsWith('/api/')) {
    apiHandler(req, res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getHtmlPage());
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} ${url}`);
}

export function registerVisualizeCommand(program: Command): void {
  program
    .command('visualize')
    .description('Open memory dashboard with knowledge graph')
    .option('-p, --port <port>', 'Port number', parseInt, 3333)
    .option('--no-open', 'Do not open browser automatically')
    .action((opts: { port: number; open: boolean }) => {
      const projectRoot = process.cwd();
      const config = resolveConfig(projectRoot);

      if (!existsSync(config.dbPath)) {
        console.error('Not initialized. Run `ctxcore init` first.');
        process.exit(1);
      }

      const dimensions = isValidEmbeddingModel(config.ollamaModel)
        ? config.embedding.dimensions
        : 1024;
      const db = createDatabase(config.dbPath);
      createVecTable(db, dimensions);
      const store = new MemoryStore(db);
      const taskStore = new TaskStore(db);
      const commentStore = new CommentStore(db);
      const taskLinkStore = new TaskLinkStore(db);
      const specStore = new SpecStore(projectRoot);

      const apiHandler = createApiHandler(
        store,
        taskStore,
        commentStore,
        taskLinkStore,
        specStore,
        null,
        db,
      );

      const server = createServer((req, res) => handleRequest(apiHandler, req, res));

      server.listen(opts.port, () => {
        const url = `http://localhost:${opts.port}`;
        console.log(`\n  ctxcore memory dashboard: ${url}`);
        console.log('  Press Ctrl+C to stop.\n');

        if (opts.open) {
          openBrowser(url);
        }
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${opts.port} is already in use. Try --port <number>.`);
        } else {
          console.error(`Server error: ${err.message}`);
        }
        db.close();
        process.exit(1);
      });

      const cleanup = () => {
        server.close();
        db.close();
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });
}
