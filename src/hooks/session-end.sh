#!/usr/bin/env bash
# ctxcore Stop hook — outputs plain text instructions for Claude

ctxcore sync --export 2>/dev/null

cat << 'HOOKEOF'
[ctxcore] SESSION ENDING - SAVE YOUR CONTEXT.

Before this session closes, you MUST save your working context to memory:

1. Call memory_store with a session summary: what was accomplished, what is still in progress, what is left to do, and any open questions.
2. Save any unsaved decisions with memory_decide.
3. Save any failed approaches, bug findings, or discoveries with memory_store.
4. Update any in-progress tasks with memory_task_comment noting current status and next steps.
5. If you deferred any work (TODOs, things to fix later), store each with memory_store tagged deferred.

The next session will start from scratch - anything not stored in memory will be forgotten. Save everything important NOW.
HOOKEOF

exit 0
