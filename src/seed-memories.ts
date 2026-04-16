import type {
  IMemorySeeder,
  IMemoryStore,
  Memory,
  ProjectSignals,
  LanguageSignal,
  FrameworkSignal,
  StructureSignal,
  ConfigFileSignal,
  DependencySignal,
  ScriptSignal,
} from './types.js';

/**
 * Converts project analysis signals into initial seed memories.
 *
 * Importance tiers:
 *   - Language/framework → long-term, importance 0.6
 *   - Dependencies → operational, importance 0.4
 *   - Structure → long-term, importance 0.5
 *   - Config → operational, importance 0.3
 *   - Scripts → operational, importance 0.3
 */
export class MemorySeeder implements IMemorySeeder {
  seed(signals: ProjectSignals, store: IMemoryStore): Memory[] {
    const memories: Memory[] = [];
    const idMap = new Map<string, string>(); // category-key → memory.id for connections

    // Build a set of existing memory content for deduplication
    const existingContent = new Set<string>();
    const existingMemories = store.list({ limit: 1000, includeArchived: true });
    for (const m of existingMemories) {
      existingContent.add(m.content);
    }

    const createIfNew = (input: Parameters<typeof store.create>[0]): Memory | null => {
      if (existingContent.has(input.content)) return null;
      existingContent.add(input.content);
      return store.create(input);
    };

    // Language memories
    for (const lang of signals.language) {
      const mem = createIfNew({
        content: `Project uses ${lang.name} (${lang.evidence})`,
        tier: 'long-term',
        importance: 0.6,
        tags: ['project-analysis', 'language'],
        metadata: { source: 'project-scanner', signal: 'language', name: lang.name },
      });
      if (mem) {
        memories.push(mem);
        idMap.set(`language:${lang.name}`, mem.id);
      }
    }

    // Framework memories
    for (const fw of signals.framework) {
      const versionStr = fw.version ? ` ${fw.version}` : '';
      const mem = createIfNew({
        content: `Project uses ${fw.name}${versionStr} framework (${fw.evidence})`,
        tier: 'long-term',
        importance: 0.6,
        tags: ['project-analysis', 'framework'],
        metadata: { source: 'project-scanner', signal: 'framework', name: fw.name, version: fw.version },
      });
      if (mem) {
        memories.push(mem);
        idMap.set(`framework:${fw.name}`, mem.id);
      }
    }

    // Structure memories — group into a single memory if multiple dirs
    if (signals.structure.length > 0) {
      const dirList = signals.structure.map((s) => `${s.directory} (${s.purpose})`).join(', ');
      const mem = createIfNew({
        content: `Project structure: ${dirList}`,
        tier: 'long-term',
        importance: 0.5,
        tags: ['project-analysis', 'structure'],
        metadata: {
          source: 'project-scanner',
          signal: 'structure',
          directories: signals.structure.map((s) => s.directory),
        },
      });
      if (mem) {
        memories.push(mem);
        idMap.set('structure', mem.id);
      }
    }

    // Config file memories — group by category
    const configByCategory = new Map<string, ConfigFileSignal[]>();
    for (const cf of signals.configFiles) {
      const list = configByCategory.get(cf.category) ?? [];
      list.push(cf);
      configByCategory.set(cf.category, list);
    }
    for (const [category, files] of configByCategory) {
      const fileList = files.map((f) => f.path).join(', ');
      const mem = createIfNew({
        content: `Project has ${category} configuration: ${fileList}`,
        tier: 'operational',
        importance: 0.3,
        tags: ['project-analysis', 'config', category],
        metadata: { source: 'project-scanner', signal: 'config', category, files: files.map((f) => f.path) },
      });
      if (mem) {
        memories.push(mem);
        idMap.set(`config:${category}`, mem.id);
      }
    }

    // Dependency memories — group production deps (skip dev deps to avoid noise)
    const prodDeps = signals.dependencies.filter((d) => !d.dev);
    if (prodDeps.length > 0) {
      // Group by source
      const bySource = new Map<string, DependencySignal[]>();
      for (const dep of prodDeps) {
        const list = bySource.get(dep.source) ?? [];
        list.push(dep);
        bySource.set(dep.source, list);
      }
      for (const [source, deps] of bySource) {
        const depNames = deps.slice(0, 20).map((d) => d.name).join(', ');
        const suffix = deps.length > 20 ? ` and ${deps.length - 20} more` : '';
        const mem = createIfNew({
          content: `Key dependencies from ${source}: ${depNames}${suffix}`,
          tier: 'operational',
          importance: 0.4,
          tags: ['project-analysis', 'dependencies'],
          metadata: {
            source: 'project-scanner',
            signal: 'dependencies',
            depSource: source,
            count: deps.length,
          },
        });
        if (mem) {
          memories.push(mem);
          idMap.set(`deps:${source}`, mem.id);
        }
      }
    }

    // Script memories
    if (signals.scripts.length > 0) {
      const bySource = new Map<string, ScriptSignal[]>();
      for (const script of signals.scripts) {
        const list = bySource.get(script.source) ?? [];
        list.push(script);
        bySource.set(script.source, list);
      }
      for (const [source, scripts] of bySource) {
        const scriptList = scripts.map((s) => `${s.name}: ${s.command}`).join('; ');
        const mem = createIfNew({
          content: `Available scripts (${source}): ${scriptList}`,
          tier: 'operational',
          importance: 0.3,
          tags: ['project-analysis', 'scripts'],
          metadata: { source: 'project-scanner', signal: 'scripts', scriptSource: source },
        });
        if (mem) {
          memories.push(mem);
          idMap.set(`scripts:${source}`, mem.id);
        }
      }
    }

    // Create connections between related memories
    this.createConnections(signals, idMap, store);

    return memories;
  }

  private createConnections(
    signals: ProjectSignals,
    idMap: Map<string, string>,
    store: IMemoryStore,
  ): void {
    // Connect frameworks to their languages
    for (const fw of signals.framework) {
      const fwId = idMap.get(`framework:${fw.name}`);
      if (!fwId) continue;

      // Infer language from framework
      const langName = this.frameworkToLanguage(fw.name);
      if (langName) {
        const langId = idMap.get(`language:${langName}`);
        if (langId) {
          store.createConnection({
            sourceId: fwId,
            targetId: langId,
            type: 'supports',
            strength: 0.8,
            metadata: { reason: `${fw.name} framework uses ${langName}` },
          });
        }
      }
    }

    // Connect deps to structure
    const structureId = idMap.get('structure');
    if (structureId) {
      for (const [key, memId] of idMap) {
        if (key.startsWith('deps:')) {
          store.createConnection({
            sourceId: memId,
            targetId: structureId,
            type: 'supports',
            strength: 0.5,
            metadata: { reason: 'Dependencies support project structure' },
          });
        }
      }
    }

    // Connect CI config to scripts
    const ciConfigId = idMap.get('config:ci');
    if (ciConfigId) {
      for (const [key, memId] of idMap) {
        if (key.startsWith('scripts:')) {
          store.createConnection({
            sourceId: ciConfigId,
            targetId: memId,
            type: 'supports',
            strength: 0.6,
            metadata: { reason: 'CI configuration likely uses project scripts' },
          });
        }
      }
    }
  }

  private frameworkToLanguage(framework: string): string | null {
    const map: Record<string, string> = {
      'React': 'TypeScript',
      'Next.js': 'TypeScript',
      'Vue': 'TypeScript',
      'Nuxt': 'TypeScript',
      'Svelte': 'TypeScript',
      'SvelteKit': 'TypeScript',
      'Express': 'TypeScript',
      'Fastify': 'TypeScript',
      'Hono': 'TypeScript',
      'Angular': 'TypeScript',
      'Astro': 'TypeScript',
      'Remix': 'TypeScript',
      'Electron': 'TypeScript',
      'Vite': 'TypeScript',
      'Webpack': 'TypeScript',
      'Tailwind CSS': 'TypeScript',
      'Django': 'Python',
      'Flask': 'Python',
      'Rails': 'Ruby',
    };
    // Fall back to JavaScript if TypeScript not found but it's a JS framework
    return map[framework] ?? null;
  }
}
