/**
 * Rhaone Orchestrator - Dependency Resolver
 * Handle task dependencies and determine execution order
 */

import { Subtask } from './task-decomposer';
import { withErrorHandling, withRetry } from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface DependencyNode {
  id: string;
  data: Subtask;
  dependencies: string[];
  dependents: string[];
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed';
  depth?: number;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  roots: string[];
  leaves: string[];
}

export interface ExecutionPlan {
  phases: Phase[];
  totalTasks: number;
  maxParallelism: number;
}

export interface Phase {
  id: number;
  tasks: string[];
  canRunParallel: boolean;
}

/**
 * Dependency Resolver - analyzes and resolves task dependencies
 */
export class DependencyResolver {
  private graph: DependencyGraph;
  private executionCache: Map<string, ExecutionPlan> = new Map();
  private graphCache: LRUCache<string, DependencyGraph>;
  private cycleCache: LRUCache<string, string[] | null>;

  constructor() {
    this.graph = {
      nodes: new Map(),
      roots: [],
      leaves: [],
    };
    // Cache for parsed dependency graphs
    this.graphCache = new LRUCache({ maxSize: 50, ttlMs: 5 * 60 * 1000 });
    // Cache for cycle detection results
    this.cycleCache = new LRUCache({ maxSize: 50, ttlMs: 5 * 60 * 1000 });
  }

  /**
   * Build dependency graph from subtasks with error handling and caching
   */
  async buildGraph(subtasks: Subtask[]): Promise<DependencyGraph> {
    return withErrorHandling(
      async () => this.buildGraphInternal(subtasks),
      {
        operation: 'dependency-resolver.buildGraph',
        retry: {
          maxRetries: 2,
          backoffMs: 100,
          retryableErrors: ['memory', 'timeout'],
        },
      }
    );
  }

  /**
   * Internal method to build dependency graph
   */
  private buildGraphInternal(subtasks: Subtask[]): DependencyGraph {
    // Check cache first
    const cacheKey = this.generateCacheKey(subtasks);
    const cached = this.graphCache.get(cacheKey);
    if (cached) {
      console.log('[DependencyResolver] Using cached graph');
      this.graph = cached;
      return cached;
    }

    const nodes = new Map<string, DependencyNode>();

    for (const subtask of subtasks) {
      nodes.set(subtask.id, {
        id: subtask.id,
        data: subtask,
        dependencies: subtask.dependencies || [],
        dependents: [],
        status: 'pending',
      });
    }

    for (const [id, node] of nodes) {
      for (const depId of node.dependencies) {
        const depNode = nodes.get(depId);
        if (depNode) {
          depNode.dependents.push(id);
        } else {
          console.warn(`[DependencyResolver] Warning: Dependency "${depId}" not found for "${id}"`);
          node.dependencies = node.dependencies.filter(d => d !== depId);
        }
      }
    }

    const roots: string[] = [];
    for (const [id, node] of nodes) {
      if (node.dependencies.length === 0) {
        roots.push(id);
      }
    }

    const leaves: string[] = [];
    for (const [id, node] of nodes) {
      if (node.dependents.length === 0) {
        leaves.push(id);
      }
    }

    this.calculateDepths(nodes, roots);

    this.graph = { nodes, roots, leaves };
    this.graphCache.set(cacheKey, this.graph);
    return this.graph;
  }

  private calculateDepths(nodes: Map<string, DependencyNode>, roots: string[]): void {
    const depths = new Map<string, number>();

    const getDepth = (id: string): number => {
      if (depths.has(id)) return depths.get(id)!;
      const node = nodes.get(id);
      if (!node || node.dependencies.length === 0) {
        depths.set(id, 0);
        return 0;
      }
      const maxDepDepth = Math.max(...node.dependencies.map(d => getDepth(d)));
      const depth = maxDepDepth + 1;
      depths.set(id, depth);
      node.depth = depth;
      return depth;
    };

    for (const id of nodes.keys()) {
      getDepth(id);
    }
  }

  async detectCycles(): Promise<string[] | null> {
    const cacheKey = this.generateGraphCacheKey();
    const cached = this.cycleCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const result = await withErrorHandling(
      async () => this.detectCyclesInternal(),
      { operation: 'dependency-resolver.detectCycles', fallback: () => Promise.resolve(null) }
    );

    this.cycleCache.set(cacheKey, result);
    return result;
  }

  private detectCyclesInternal(): string[] | null {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[] = [];

    const dfs = (nodeId: string, path: string[]): boolean => {
      visited.add(nodeId);
      recStack.add(nodeId);
      const node = this.graph.nodes.get(nodeId);
      if (!node) return false;

      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          if (dfs(depId, [...path, depId])) return true;
        } else if (recStack.has(depId)) {
          const cycleStart = path.indexOf(depId);
          const cycle = [...path.slice(cycleStart), depId].join(' -> ');
          cycles.push(cycle);
          return true;
        }
      }
      recStack.delete(nodeId);
      return false;
    };

    for (const root of this.graph.roots) {
      if (!visited.has(root)) {
        if (dfs(root, [root])) return cycles;
      }
    }
    return null;
  }

  async generateExecutionPlan(): Promise<ExecutionPlan> {
    const cacheKey = this.generateGraphCacheKey();
    const cached = this.executionCache.get(cacheKey);
    if (cached) {
      console.log('[DependencyResolver] Using cached execution plan');
      return cached;
    }

    return withErrorHandling(
      async () => {
        const plan = this.generateExecutionPlanInternal();
        this.executionCache.set(cacheKey, plan);
        return plan;
      },
      {
        operation: 'dependency-resolver.generateExecutionPlan',
        retry: { maxRetries: 2, backoffMs: 100 },
      }
    );
  }

  private generateExecutionPlanInternal(): ExecutionPlan {
    const phases: Phase[] = [];
    const remaining = new Set(this.graph.nodes.keys());
    const completed = new Set<string>();
    let phaseId = 0;

    while (remaining.size > 0) {
      const ready: string[] = [];
      for (const id of remaining) {
        const node = this.graph.nodes.get(id)!;
        const depsSatisfied = node.dependencies.every(depId => completed.has(depId));
        if (depsSatisfied) ready.push(id);
      }

      if (ready.length === 0 && remaining.size > 0) {
        const cycles = this.detectCyclesInternal();
        throw new Error(`Circular dependency detected: ${cycles?.join(', ')}`);
      }

      ready.sort((a, b) => {
        const nodeA = this.graph.nodes.get(a)!;
        const nodeB = this.graph.nodes.get(b)!;
        return nodeA.data.priority - nodeB.data.priority;
      });

      phases.push({ id: phaseId++, tasks: ready, canRunParallel: ready.length > 1 });

      for (const id of ready) {
        remaining.delete(id);
        completed.add(id);
      }
    }

    const maxParallelism = Math.max(...phases.map(p => p.tasks.length), 1);
    return { phases, totalTasks: this.graph.nodes.size, maxParallelism };
  }

  getReadyTasks(): string[] {
    const ready: string[] = [];
    for (const [id, node] of this.graph.nodes) {
      if (node.status === 'pending') {
        const depsSatisfied = node.dependencies.every(depId => {
          const depNode = this.graph.nodes.get(depId);
          return depNode?.status === 'completed';
        });
        if (depsSatisfied) ready.push(id);
      }
    }


    return ready.sort((a, b) => {
      const nodeA = this.graph.nodes.get(a)!;
      const nodeB = this.graph.nodes.get(b)!;
      return (nodeB.depth || 0) - (nodeA.depth || 0) || nodeA.data.priority - nodeB.data.priority;
    });
  }

  completeTask(taskId: string, success: boolean = true): void {
    const node = this.graph.nodes.get(taskId);
    if (node) {
      node.status = success ? 'completed' : 'failed';
    }
  }

  getPendingTasks(): string[] {
    return Array.from(this.graph.nodes.entries())
      .filter(([_, node]) => node.status === 'pending')
      .map(([id]) => id);
  }

  getFailedTasks(): string[] {
    return Array.from(this.graph.nodes.entries())
      .filter(([_, node]) => node.status === 'failed')
      .map(([id]) => id);
  }

  getBlockedTasks(taskId: string): string[] {
    const node = this.graph.nodes.get(taskId);
    if (!node) return [];

    const blocked: string[] = [];
    const findBlocked = (id: string): void => {
      const n = this.graph.nodes.get(id);
      if (!n) return;
      for (const dependentId of n.dependents) {
        if (!blocked.includes(dependentId)) {
          blocked.push(dependentId);
          findBlocked(dependentId);
        }
      }
    };

    findBlocked(taskId);
    return blocked;
  }

  getCriticalPath(): string[] {
    const path: string[] = [];
    let current: DependencyNode | undefined;

    let maxDepth = -1;
    for (const node of this.graph.nodes.values()) {
      if ((node.depth || 0) > maxDepth) {
        maxDepth = node.depth || 0;
        current = node;
      }
    }

    while (current) {
      path.unshift(current.id);
      let nextDep: DependencyNode | undefined;
      let maxDepDepth = -1;
      for (const depId of current.dependencies) {
        const dep = this.graph.nodes.get(depId);
        if (dep && (dep.depth || 0) > maxDepDepth) {
          maxDepDepth = dep.depth || 0;
          nextDep = dep;
        }
      }
      current = nextDep;
    }

    return path;
  }

  visualize(): string {
    const lines: string[] = ['Dependency Graph:'];
    for (const [id, node] of this.graph.nodes) {
      const deps = node.dependencies.length > 0 
        ? ` (depends on: ${node.dependencies.join(', ')})`
        : ' [ROOT]';
      const statusIcon = node.status === 'completed' ? '✓' : 
                         node.status === 'failed' ? '✗' : 
                         node.status === 'running' ? '▶' : '○';
      lines.push(`  ${statusIcon} ${id}: ${node.data.title}${deps}`);
    }
    return lines.join('\n');
  }

  getGraph(): DependencyGraph {
    return this.graph;
  }

  reset(): void {
    this.graph = { nodes: new Map(), roots: [], leaves: [] };
    this.executionCache.clear();
    this.graphCache.clear();
    this.cycleCache.clear();
  }

  private generateCacheKey(subtasks: Subtask[]): string {
    const ids = subtasks.map(s => s.id).sort().join(',');
    return `graph-${ids}`;
  }

  private generateGraphCacheKey(): string {
    const ids = Array.from(this.graph.nodes.keys()).sort().join(',');
    return `graph-${ids}`;
  }
}

export const dependencyResolver = new DependencyResolver();
