#!/usr/bin/env bash
# ctxcore PostToolUse hook for WebSearch/WebFetch
# Saves search results to memory tagged "websearch" for future reference

CTXCORE=$(which ctxcore 2>/dev/null)
[ -z "$CTXCORE" ] && exit 0

INPUT=$(cat 2>/dev/null)
[ -z "$INPUT" ] && exit 0

# Extract tool name, input, and output
PARSED=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tool = data.get('tool_name', '')
    inp = data.get('tool_input', {})
    out = data.get('tool_response', data.get('tool_output', data.get('output', '')))

    # Get the query/URL
    if isinstance(inp, dict):
        query = inp.get('query', inp.get('url', inp.get('search_query', '')))
    elif isinstance(inp, str):
        query = inp
    else:
        query = ''

    # Get the response content (truncate to keep memory reasonable)
    if isinstance(out, dict):
        content = out.get('content', out.get('text', out.get('result', json.dumps(out))))
    elif isinstance(out, list):
        # MCP tool response is often [{type:'text', text:'...'}]
        parts = []
        for item in out:
            if isinstance(item, dict) and 'text' in item:
                parts.append(item['text'])
        content = '\n'.join(parts) if parts else json.dumps(out)
    else:
        content = str(out) if out else ''

    # Truncate long content — keep first 2000 chars
    if len(content) > 2000:
        content = content[:2000] + '... (truncated)'

    if query and content:
        print(json.dumps({'tool': tool, 'query': str(query), 'content': content}))
    else:
        print('')
except Exception as e:
    print('')
" 2>/dev/null)

[ -z "$PARSED" ] && exit 0

# Extract fields
TOOL=$(echo "$PARSED" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool',''))" 2>/dev/null)
QUERY=$(echo "$PARSED" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('query',''))" 2>/dev/null)
CONTENT=$(echo "$PARSED" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('content',''))" 2>/dev/null)

[ -z "$QUERY" ] || [ -z "$CONTENT" ] && exit 0

# Build memory content
MEMORY="[${TOOL}] ${QUERY}

${CONTENT}"

# Store as short-term memory tagged websearch
"$CTXCORE" store "$MEMORY" --tier short-term --tags websearch "$TOOL" 2>/dev/null

exit 0
