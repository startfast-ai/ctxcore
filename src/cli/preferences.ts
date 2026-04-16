import type { Command } from 'commander';
import { UserProfileManager, createProfileDatabase } from '../user-profile.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PreferenceCategory } from '../types.js';

const VALID_CATEGORIES: PreferenceCategory[] = ['communication', 'technical', 'workflow', 'tooling', 'code-style'];

function getProfileManager(dbPath?: string): UserProfileManager {
  const path = dbPath ?? join(homedir(), '.ctxcore', 'user_profile.db');
  const db = createProfileDatabase(path);
  return new UserProfileManager(db);
}

export function registerPreferencesCommand(program: Command): void {
  const prefs = program
    .command('preferences')
    .description('Manage user preferences');

  prefs
    .command('list')
    .description('Show all preferences with confidence')
    .option('-c, --category <category>', 'Filter by category')
    .option('-s, --scope <scope>', 'Filter by scope (global or project)')
    .option('--min-confidence <n>', 'Minimum confidence threshold', parseFloat)
    .action((opts: { category?: string; scope?: string; minConfidence?: number }) => {
      const manager = getProfileManager();

      const preferences = manager.getPreferences({
        category: opts.category as PreferenceCategory | undefined,
        scope: opts.scope as 'global' | 'project' | undefined,
        minConfidence: opts.minConfidence,
      });

      if (preferences.length === 0) {
        console.log('No preferences found.');
        manager.close();
        return;
      }

      console.log(`Found ${preferences.length} preference(s):\n`);

      for (const pref of preferences) {
        const scopeBadge = `[${pref.scope}]`;
        const catBadge = `(${pref.category})`;
        const confidenceBar = `confidence: ${(pref.confidence * 100).toFixed(0)}%`;
        const observations = `observations: ${pref.observationCount}`;
        console.log(`  ${pref.id}`);
        console.log(`    ${scopeBadge} ${catBadge} ${confidenceBar} | ${observations}`);
        console.log(`    "${pref.content}"`);
        if (pref.projectRoot) {
          console.log(`    project: ${pref.projectRoot}`);
        }
        console.log();
      }

      manager.close();
    });

  prefs
    .command('add')
    .description('Explicitly set a preference (confidence 0.9)')
    .argument('<content>', 'Preference content')
    .option('-c, --category <category>', 'Category (communication, technical, workflow, tooling, code-style)', 'workflow')
    .option('-s, --scope <scope>', 'Scope (global or project)', 'global')
    .option('-p, --project <path>', 'Project root (for project-scoped preferences)')
    .action((content: string, opts: { category: string; scope: string; project?: string }) => {
      if (!VALID_CATEGORIES.includes(opts.category as PreferenceCategory)) {
        console.error(`Invalid category: "${opts.category}". Valid: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }

      const scope = opts.scope as 'global' | 'project';
      if (scope !== 'global' && scope !== 'project') {
        console.error('Invalid scope. Must be "global" or "project".');
        process.exit(1);
      }

      const projectRoot = opts.project ?? (scope === 'project' ? process.cwd() : undefined);

      const manager = getProfileManager();
      const pref = manager.addPreference({
        category: opts.category as PreferenceCategory,
        content,
        confidence: 0.9,
        scope,
        projectRoot,
      });

      console.log(`Added preference ${pref.id}`);
      console.log(`  [${pref.scope}] (${pref.category}) confidence: 90%`);
      console.log(`  "${pref.content}"`);

      manager.close();
    });

  prefs
    .command('forget')
    .description('Remove a preference')
    .argument('<id>', 'Preference ID')
    .action((id: string) => {
      const manager = getProfileManager();
      const removed = manager.forgetPreference(id);

      if (removed) {
        console.log(`Removed preference ${id}`);
      } else {
        console.error(`Preference ${id} not found.`);
        process.exit(1);
      }

      manager.close();
    });
}
