import { randomUUID } from 'node:crypto';
import type {
  Memory,
  IClaudeCliRunner,
  IReflexionEngine,
  IMemoryStore,
  ReflexionResult,
  ReflexionSuggestion,
  ReflexionEntry,
} from './types.js';
import { ReflexionApplicator, type ApplyResult } from './reflexion-applicator.js';
import {
  buildConsolidationPrompt,
  buildContradictionPrompt,
  buildPatternPrompt,
  buildRecalibrationPrompt,
  buildTaskCreationPrompt,
} from './reflexion-prompts.js';

export interface TaskSuggestion {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  relatedMemoryIds: string[];
}

/**
 * Self-reflexion engine that uses Claude CLI to analyze and improve the knowledge base.
 * Each method constructs a prompt, calls Claude CLI, and parses the JSON response.
 */
export class ReflexionEngine implements IReflexionEngine {
  constructor(private readonly cli: IClaudeCliRunner) {}

  async runConsolidation(memories: Memory[]): Promise<ReflexionResult> {
    const prompt = buildConsolidationPrompt(memories);
    return this.executeReflexion('consolidation', prompt, memories);
  }

  async detectContradictions(memories: Memory[]): Promise<ReflexionResult> {
    const prompt = buildContradictionPrompt(memories);
    return this.executeReflexion('contradiction', prompt, memories);
  }

  async findPatterns(memories: Memory[]): Promise<ReflexionResult> {
    const prompt = buildPatternPrompt(memories);
    return this.executeReflexion('pattern', prompt, memories);
  }

  async recalibrateImportance(memories: Memory[]): Promise<ReflexionResult> {
    const prompt = buildRecalibrationPrompt(memories);
    return this.executeReflexion('recalibration', prompt, memories);
  }

  async suggestTasks(memories: Memory[]): Promise<TaskSuggestion[]> {
    const prompt = buildTaskCreationPrompt(memories);
    let rawResponse: string;
    try {
      rawResponse = await this.cli.run(prompt, { timeout: 120_000 });
    } catch {
      return [];
    }

    try {
      const parsed = this.parseResponse(rawResponse);
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      return tasks.map((t: Record<string, unknown>) => ({
        title: typeof t.title === 'string' ? t.title : '',
        description: typeof t.description === 'string' ? t.description : '',
        priority: (['low', 'medium', 'high', 'critical'].includes(t.priority as string)
          ? t.priority
          : 'medium') as TaskSuggestion['priority'],
        tags: Array.isArray(t.tags) ? (t.tags as string[]) : [],
        relatedMemoryIds: Array.isArray(t.relatedMemoryIds) ? (t.relatedMemoryIds as string[]) : [],
      }));
    } catch {
      return [];
    }
  }

  async runFull(store: IMemoryStore): Promise<ReflexionResult[]> {
    const memories = store.list({ includeArchived: false });
    const results: ReflexionResult[] = [];

    results.push(await this.runConsolidation(memories));
    results.push(await this.detectContradictions(memories));
    results.push(await this.findPatterns(memories));
    results.push(await this.recalibrateImportance(memories));

    return results;
  }

  async runFullAndApply(
    store: IMemoryStore,
  ): Promise<{ results: ReflexionResult[]; applied: ApplyResult }> {
    const results = await this.runFull(store);
    const allSuggestions = results.flatMap((r) => r.suggestions);
    const applicator = new ReflexionApplicator();
    const applied = applicator.apply(allSuggestions, store);
    return { results, applied };
  }

  private async executeReflexion(
    type: ReflexionEntry['type'],
    prompt: string,
    memories: Memory[],
  ): Promise<ReflexionResult> {
    let rawResponse: string;
    try {
      rawResponse = await this.cli.run(prompt, { timeout: 120_000 });
    } catch (error) {
      return this.createErrorResult(
        type,
        memories,
        `CLI execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const parsed = this.parseResponse(rawResponse);
      const memoriesAffected: string[] = Array.isArray(parsed.memoriesAffected)
        ? parsed.memoriesAffected
        : [];
      const suggestions: ReflexionSuggestion[] = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((s: Record<string, unknown>) => ({
            action: s.action as ReflexionSuggestion['action'],
            targetIds: Array.isArray(s.targetIds) ? (s.targetIds as string[]) : [],
            reason: typeof s.reason === 'string' ? s.reason : '',
            ...(s.data ? { data: s.data as Record<string, unknown> } : {}),
          }))
        : [];

      const journal: ReflexionEntry = {
        id: randomUUID(),
        type,
        input: { memoryIds: memories.map((m) => m.id), memoryCount: memories.length },
        output: parsed,
        memoriesAffected,
        createdAt: new Date(),
      };

      return { type, memoriesAffected, suggestions, journal };
    } catch {
      return this.createErrorResult(type, memories, `Failed to parse response: ${rawResponse}`);
    }
  }

  private parseResponse(raw: string): Record<string, unknown> {
    // Try to extract JSON from the response, handling markdown code fences
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    return JSON.parse(jsonStr);
  }

  private createErrorResult(
    type: ReflexionEntry['type'],
    memories: Memory[],
    errorMessage: string,
  ): ReflexionResult {
    const journal: ReflexionEntry = {
      id: randomUUID(),
      type,
      input: { memoryIds: memories.map((m) => m.id), memoryCount: memories.length },
      output: { error: errorMessage },
      memoriesAffected: [],
      createdAt: new Date(),
    };

    return {
      type,
      memoriesAffected: [],
      suggestions: [],
      journal,
    };
  }
}
