#!/usr/bin/env bash
# ctxcore UserPromptSubmit hook
# Output plain text to stdout — Claude Code adds it as context automatically

# Find ctxcore
CTXCORE=$(which ctxcore 2>/dev/null)
[ -z "$CTXCORE" ] && exit 0

# Read stdin, extract prompt field
INPUT=$(cat 2>/dev/null)
[ -z "$INPUT" ] && exit 0

USER_MSG=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(str(data.get('prompt', ''))[:500])
except:
    print('')
" 2>/dev/null)

[ -z "$USER_MSG" ] || [ ${#USER_MSG} -lt 3 ] && exit 0

# Search memories — output plain text (not JSON)
RESULTS=$("$CTXCORE" search "$USER_MSG" --limit 5 2>/dev/null)

[ -z "$RESULTS" ] || [ "$RESULTS" = "No memories found." ] && exit 0

echo "[ctxcore] Relevant memories:"
echo "$RESULTS"

exit 0
