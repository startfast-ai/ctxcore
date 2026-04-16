#!/usr/bin/env bash
# ctxcore PreCompact hook

ctxcore sync --export 2>/dev/null

cat << 'HOOKEOF'
[ctxcore] CRITICAL - CONTEXT COMPACTION IMMINENT.

You MUST save ALL working context to memory RIGHT NOW. This is not optional.

Do ALL of the following before continuing:

1. SESSION SUMMARY: Call memory_store with what you were working on, exactly where you left off, what files were being edited, what approach you were taking, and what the next steps are. Be specific - include file names, function names, error messages, and your current hypothesis. Tag: session-summary.
2. DECISIONS: Call memory_decide for every decision made in this session that has not been saved yet.
3. FINDINGS: Call memory_store for every bug found, failed approach tried, pattern discovered, or insight gained. Include what you tried and why it did or did not work.
4. TASK PROGRESS: Call memory_task_comment on every in-progress task with exactly what was done, what remains, and any blockers.
5. DEFERRED WORK: Call memory_store for anything you planned to do but have not done yet - TODOs, things to fix later, ideas to explore. Tag: deferred.
6. ENVIRONMENT: If you discovered any setup quirks, env var requirements, or workarounds, store them with memory_store. Tag: environment.
7. VERIFY: Call memory_search with your main work topic to confirm your context was saved.

After compaction, you will lose most of your current context. Anything not stored in memory will be GONE. Save EVERYTHING important now.
HOOKEOF

exit 0
