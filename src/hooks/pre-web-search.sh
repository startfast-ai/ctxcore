#!/usr/bin/env bash
# ctxcore PreToolUse hook for WebSearch/WebFetch
# Checks if we already have relevant websearch memories before searching again

CTXCORE=$(which ctxcore 2>/dev/null)
[ -z "$CTXCORE" ] && exit 0

INPUT=$(cat 2>/dev/null)
[ -z "$INPUT" ] && exit 0

# Extract the tool input (URL or query)
QUERY=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    inp = data.get('tool_input', {})
    if isinstance(inp, str):
        print(inp[:200])
    elif isinstance(inp, dict):
        # WebSearch: query field; WebFetch: url field
        q = inp.get('query', inp.get('url', inp.get('search_query', '')))
        print(str(q)[:200] if q else '')
    else:
        print('')
except:
    print('')
" 2>/dev/null)

[ -z "$QUERY" ] || [ ${#QUERY} -lt 3 ] && exit 0

# Search for existing websearch memories
RESULTS=$("$CTXCORE" search "$QUERY" --limit 3 --tier short-term 2>/dev/null)

if [ -z "$RESULTS" ] || [ "$RESULTS" = "No memories found." ]; then
    exit 0
fi

# Check if any result is tagged websearch
HAS_WEBSEARCH=$(echo "$RESULTS" | grep -c "websearch" 2>/dev/null || echo "0")

if [ "$HAS_WEBSEARCH" -gt 0 ]; then
    echo "[ctxcore] Found cached web search results — check these before searching again:"
    echo "$RESULTS"
fi

exit 0
