import { execSync } from 'node:child_process';
import type { IBranchManager, IMemoryStore, Memory } from './types.js';

export class BranchManager implements IBranchManager {
  getCurrentBranch(projectRoot: string): string | null {
    try {
      const result = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const branch = result.trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  tagMemory(memoryId: string, branch: string, store: IMemoryStore): void {
    const memory = store.getById(memoryId);
    if (!memory) {
      return;
    }

    const metadata = { ...memory.metadata, branch };

    // Also add branch to tags if not already present
    const branchTag = `branch:${branch}`;
    const tags = memory.tags.includes(branchTag) ? memory.tags : [...memory.tags, branchTag];

    store.update(memoryId, { metadata, tags });
  }

  filterByBranch(memories: Memory[], branch: string): Memory[] {
    const branchTag = `branch:${branch}`;

    // Partition into branch-matching and non-branch memories
    const branchMemories: Memory[] = [];
    const otherMemories: Memory[] = [];

    for (const memory of memories) {
      const memBranch = memory.metadata.branch as string | undefined;
      const hasBranchTag = memory.tags.includes(branchTag);

      if (memBranch === branch || hasBranchTag) {
        branchMemories.push(memory);
      } else {
        otherMemories.push(memory);
      }
    }

    // Return branch memories first, then others (prioritization)
    return [...branchMemories, ...otherMemories];
  }
}
