#!/usr/bin/env bash
# ctxcore PostCompact hook

ctxcore sync --import 2>/dev/null

cat << 'HOOKEOF'
[ctxcore] CONTEXT WAS JUST COMPACTED - your working memory has been reduced.

You MUST recover your context now:

1. Call memory_context to reload project stats, recent memories, and alerts.
2. Call memory_search with the topic you were working on before compaction to recover your prior knowledge and approach.
3. Look for memories tagged session-summary - they contain exactly where you left off, what files were being edited, and next steps.
4. Look for memories tagged deferred - these are things you planned to do but have not done yet.
5. Call memory_task_list to see active tasks and your last comments on them.

You had accumulated context that is now gone from your window. The memories contain everything you saved. Load them before continuing. Do NOT guess or re-derive what you already knew - it is stored in memory.
HOOKEOF

exit 0
