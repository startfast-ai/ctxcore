#!/usr/bin/env bash
# ctxcore SessionStart hook — outputs plain text context for Claude

ctxcore sync --import 2>/dev/null

cat << 'HOOKEOF'
[ctxcore] SESSION START - RECOVER YOUR MEMORY.

You have a persistent knowledge base from previous sessions. You MUST do the following BEFORE any other work:

1. Call memory_context to load project stats, recent memories, and active alerts.
2. Call memory_search with the topic the user is asking about to retrieve relevant prior knowledge, past decisions, known bugs, and failed approaches.
3. Call memory_task_list to see active tasks - check if the request relates to an existing task.
4. If the previous session left a session-summary, read it carefully - it tells you exactly where things left off.
5. If there are deferred items (tag: deferred), review them - the user may be expecting you to pick up where you left off.

Do NOT start working until you have loaded your context. Skipping this means repeating solved problems and contradicting past decisions.
HOOKEOF

exit 0
