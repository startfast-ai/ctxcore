import type { Memory, Spec } from './types.js';

function serializeMemories(memories: Memory[]): string {
  return memories
    .map(
      (m) =>
        `[${m.id}] (tier: ${m.tier}, importance: ${m.importance.toFixed(2)}, actuality: ${m.actuality.toFixed(2)})\n${m.content}`,
    )
    .join('\n\n');
}

export function buildConsolidationPrompt(memories: Memory[]): string {
  return `You are a memory consolidation engine. Analyze the following memories and identify clusters that should be merged into consolidated memories.

MEMORIES:
${serializeMemories(memories)}

Respond with ONLY valid JSON in this exact format:
{
  "memoriesAffected": ["id1", "id2"],
  "suggestions": [
    {
      "action": "merge",
      "targetIds": ["id1", "id2"],
      "reason": "These memories describe the same topic and can be consolidated",
      "data": { "mergedContent": "The consolidated content" }
    }
  ]
}

Rules:
- Only suggest merging memories that are clearly about the same topic or event
- Each suggestion must include a "mergedContent" field in data with the proposed consolidated text
- The action must be "merge"
- Return an empty suggestions array if no consolidation is needed`;
}

export function buildContradictionPrompt(memories: Memory[]): string {
  return `You are a contradiction detection engine. Analyze the following memories and identify any that contradict each other.

MEMORIES:
${serializeMemories(memories)}

Respond with ONLY valid JSON in this exact format:
{
  "memoriesAffected": ["id1", "id2"],
  "suggestions": [
    {
      "action": "archive",
      "targetIds": ["id1"],
      "reason": "This memory contradicts a newer, more accurate memory"
    },
    {
      "action": "create-connection",
      "targetIds": ["id1", "id2"],
      "reason": "These memories contradict each other",
      "data": { "connectionType": "contradicts" }
    }
  ]
}

Rules:
- Look for factual contradictions, conflicting decisions, or incompatible statements
- Suggest archiving the stale/outdated memory
- Suggest creating a "contradicts" connection between conflicting memories
- Return an empty suggestions array if no contradictions are found`;
}

export function buildPatternPrompt(memories: Memory[]): string {
  return `You are a pattern recognition engine. Analyze the following memories and detect recurring themes, repeated issues, or emergent patterns.

MEMORIES:
${serializeMemories(memories)}

Respond with ONLY valid JSON in this exact format:
{
  "memoriesAffected": ["id1", "id2", "id3"],
  "suggestions": [
    {
      "action": "create-connection",
      "targetIds": ["id1", "id2"],
      "reason": "Both memories relate to the same recurring pattern",
      "data": { "connectionType": "similar", "pattern": "Description of the pattern" }
    },
    {
      "action": "promote",
      "targetIds": ["id1"],
      "reason": "This memory captures a key recurring theme that should be long-term"
    }
  ]
}

Rules:
- Look for recurring bugs, repeated decisions, workflow patterns, or thematic clusters
- Suggest connections between memories that share a pattern
- Suggest promoting memories that capture important recurring themes
- Return an empty suggestions array if no patterns are detected`;
}

export function buildRecalibrationPrompt(memories: Memory[]): string {
  return `You are an importance recalibration engine. Analyze the following memories and suggest adjustments to their importance scores.

MEMORIES:
${serializeMemories(memories)}

Respond with ONLY valid JSON in this exact format:
{
  "memoriesAffected": ["id1", "id2"],
  "suggestions": [
    {
      "action": "update-importance",
      "targetIds": ["id1"],
      "reason": "This memory captures a key architectural decision that should have higher importance",
      "data": { "newImportance": 0.8 }
    }
  ]
}

Rules:
- Importance scale: 0.1-0.3 (routine), 0.3-0.6 (operational), 0.6-0.8 (decision), 0.8-1.0 (breakthrough)
- Look for memories whose importance seems miscalibrated based on their content
- Architectural decisions and root cause discoveries should be high importance
- Routine file changes and formatting should be low importance
- Return an empty suggestions array if all importance scores seem appropriate`;
}

export function buildTaskCreationPrompt(memories: Memory[]): string {
  return `You are a task identification engine. Analyze the following memories and identify patterns that suggest tasks should be created. Look for recurring bugs in the same module, unresolved issues, deferred work, and improvement opportunities.

MEMORIES:
${serializeMemories(memories)}

Respond with ONLY valid JSON in this exact format:
{
  "tasks": [
    {
      "title": "Short descriptive title",
      "description": "Detailed description of what needs to be done",
      "priority": "high",
      "tags": ["module-name", "category"],
      "relatedMemoryIds": ["id1", "id2"]
    }
  ]
}

Rules:
- Priority must be one of: "low", "medium", "high", "critical"
- Only suggest tasks when there is clear evidence from multiple memories or a strong signal from one
- 3+ related bug or issue memories in the same module → suggest a refactoring task
- Deferred work or TODO mentions → suggest a follow-up task
- Recurring patterns of the same problem → suggest a systemic fix task
- Include the memory IDs that support the task creation in relatedMemoryIds
- Return an empty tasks array if no tasks are warranted`;
}

function serializeSpecs(specs: Spec[]): string {
  return specs
    .map(
      (s) =>
        `[${s.id}] (status: ${s.status}, updated: ${s.updatedAt.toISOString().slice(0, 10)})\nTitle: ${s.title}\nTags: ${s.tags.join(', ')}\nContent preview: ${s.content.slice(0, 200)}`,
    )
    .join('\n\n');
}

export function buildSpecStalenessPrompt(specs: Spec[], memories: Memory[]): string {
  return `You are a spec staleness detection engine. Analyze the following specs and recent memories to identify specs that may be outdated or contradicted by newer information.

SPECS:
${serializeSpecs(specs)}

RECENT MEMORIES:
${serializeMemories(memories)}

Respond with ONLY valid JSON in this exact format:
{
  "staleSpecs": [
    {
      "specId": "spec-slug",
      "reason": "Why this spec appears outdated",
      "contradictingMemoryIds": ["mem-1", "mem-2"]
    }
  ]
}

Rules:
- Only flag specs where memories clearly contradict or supersede the spec content
- A spec is stale if decisions recorded in memories conflict with what the spec describes
- A spec is stale if implementation memories show a different approach than the spec prescribes
- Include all memory IDs that contradict or supersede the spec
- Return an empty staleSpecs array if all specs appear current`;
}
