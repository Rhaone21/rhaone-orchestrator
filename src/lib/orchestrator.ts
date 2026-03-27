/**
 * Rhaone Orchestrator - Main Orchestrator
 * Coordinates batch spawning, task decomposition, dependency management, and resource limits
 */

import { EventEmitter } from 'events';
import { SessionManager, SpawnConfig, Session } from './session-manager';
import { BatchSpawner, BatchSpawnConfig, BatchIssueConfig, BatchProgressEvent } from './batch-spawner';
import { TaskDecomposer, DecomposedTask, Subtask, TaskDecompositionConfig } from './task-decomposer';
import { DependencyResolver, ExecutionPlan, Phase } from './dependency-resolver';
import { ResourceManager, ResourceConfig, ResourceUsage } from './resource-manager';
import { withErrorHandling, withRetry, withCircuitBreaker, errorHandler } from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface OrchestratorConfig {
  maxConcurrentAgents: number;
  maxTotalAgents: number;
  defaultTimeoutMs: number;
  defaultParallel: boolean;
  defaultMaxConcurrent: number;
  failFast: boolean;
  maxSubtasks: number;
  includeTests: boolean;
  includeDocs: boolean;
}

export interface OrchestratedTask {
  id: string;
  issueId: string;
  task: string;
  decomposition?: DecomposedTask;
  executionPlan?: ExecutionPlan;
  status: 'pending' | 'decomposing' | 'ready' | 'running' | 'completed' | 'failed';
  currentPhase?: number;
  completedSubtasks: string[];
  sessionIds: string[];
  error?: string;
}

export interface OrchestratorStatus {
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalTasks: number;
  resourceUsage: ResourceUsage;
  queued: number;
}

export interface OrchestratorEvent {
  type: string;
  taskId?: string;
  issueId?: string;
  data?: any;
  timestamp: number;
}

/**
 * Main Orchestrator - coordinates all Phase 4 advanced features
 */
export class Orchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private sessionManager: SessionManager;
  private batchSpawner: BatchSpawner;
  private taskDecomposer: TaskDecomposer;
  private dependencyResolver: DependencyResolver;
  private resourceManager: ResourceManager;
  
  private tasks: Map<string, OrchestratedTask> = new Map();
  private eventHistory: OrchestratorEvent[] = [];
  private maxEventHistory: number = 100;
  // Cache for task decompositions
  private decompositionCache: LRUCache<string, DecomposedTask>;
  // Memoized status calculations
  private memoizedGetStatus: () => OrchestratorStatus;

  constructor(sessionManager: SessionManager, config?: Partial<OrchestratorConfig>) {
    super();
    
    this.sessionManager = sessionManager;
    this.config = {
      maxConcurrentAgents: config?.maxConcurrentAgents || 5,
      maxTotalAgents: config?.maxTotalAgents || 20,
      defaultTimeoutMs: config?.defaultTimeoutMs || 30 * 60 * 1000,
      defaultParallel: config?.defaultParallel ?? true,
      defaultMaxConcurrent: config?.defaultMaxConcurrent || 5,
      failFast: config?.failFast ?? true,
      maxSubtasks: config?.maxSubtasks || 10,
      includeTests: config?.includeTests ?? true,
      includeDocs: config?.includeDocs ?? false,
    };

    this.batchSpawner = new BatchSpawner(sessionManager);
    this.taskDecomposer = new TaskDecomposer({
      maxSubtasks: this.config.maxSubtasks,
      includeTests: this.config.includeTests,
      includeDocs: this.config.includeDocs,
    });
    this.dependencyResolver = new DependencyResolver();
    this.resourceManager = new ResourceManager({
      maxConcurrentAgents: this.config.maxConcurrentAgents,
      maxTotalAgents: this.config.maxTotalAgents,
      timeoutMs: this.config.defaultTimeoutMs,
    });

    // Initialize caches
    this.decompositionCache = new LRUCache({ maxSize: 50, ttlMs: 10 * 60 * 1000 });
    
    // Memoize status calculation
    this.memoizedGetStatus = memoize(
      () => this.calculateStatus(),
      { maxSize: 1, ttlMs: 1000 } // 1 second TTL for status
    );

    this.setupEventListeners();
    console.log('[Orchestrator] Phase 4 initialized with error handling and caching');
  }

  private setupEventListeners(): void {
    this.batchSpawner.on('progress', (event: BatchProgressEvent) => {
      this.emit('batchProgress', event);
    });

    this.batchSpawner.on('complete', (result) => {
      this.emit('batchComplete', result);
    });

    this.resourceManager.on('reserved', (data) => {
      this.emit('resourceReserved', data);
    });

    this.resourceManager.on('released', (data) => {
      this.emit('resourceReleased', data);
    });
  }

  private logEvent(type: string, data?: any): void {
    const event: OrchestratorEvent = {
      type,
      data,
      timestamp: Date.now(),
    };
    this.eventHistory.push(event);
    
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory.shift();
    }
  }

  async orchestrateTask(issueId: string, task: string, options?: {
    decompose?: boolean;
    execute?: boolean;
    parallel?: boolean;
    maxConcurrent?: number;
  }): Promise<OrchestratedTask> {
    const taskId = `orch-${issueId}-${Date.now().toString(36)}`;
    
    const orchestratedTask: OrchestratedTask = {
      id: taskId,
      issueId,
      task,
      status: 'pending',
      completedSubtasks: [],
      sessionIds: [],
    };
    
    this.tasks.set(taskId, orchestratedTask);
    this.logEvent('taskCreated', { taskId, issueId });

    return withErrorHandling(
      async () => {
        // Phase 1: Decompose
        if (options?.decompose !== false) {
          orchestratedTask.status = 'decomposing';
          this.logEvent('taskDecomposing', { taskId });
          
          orchestratedTask.decomposition = await this.decomposeWithCache(task, issueId);
          orchestratedTask.executionPlan = await this.dependencyResolver.generateExecutionPlan();
          
          console.log(`[Orchestrator] Decomposed "${issueId}" into ${orchestratedTask.decomposition.subtasks.length} subtasks`);
        }

        // Phase 2: Execute
        if (options?.execute !== false) {
          orchestratedTask.status = 'ready';
          this.logEvent('taskReady', { taskId });
          
          await this.executeOrchestratedTask(orchestratedTask, options);
        }

        orchestratedTask.status = 'completed';
        this.logEvent('taskCompleted', { taskId });
        this.emit('taskCompleted', orchestratedTask);
        
        return orchestratedTask;
      },
      {
        operation: 'orchestrator.orchestrateTask',
        issueId,
        metadata: { taskId },
        retry: {
          maxRetries: 2,
          backoffMs: 1000,
          retryableErrors: ['timeout', 'rate limit', 'network'],
        },
        fallback: async () => {
          orchestratedTask.status = 'failed';
          orchestratedTask.error = 'Orchestration failed after retries';
          this.logEvent('taskFailed', { taskId, error: orchestratedTask.error });
          this.emit('taskFailed', orchestratedTask);
          return orchestratedTask;
        },
      }
    );
  }

  private async decomposeWithCache(task: string, issueId?: string): Promise<DecomposedTask> {
    const cacheKey = `${issueId || task.slice(0, 50)}`;
    const cached = this.decompositionCache.get(cacheKey);
    if (cached) {
      console.log(`[Orchestrator] Using cached decomposition for ${issueId}`);
      return cached;
    }

    const result = await withRetry(
      async () => this.taskDecomposer.decompose(task, issueId),
      {
        operationName: 'orchestrator.decompose',
        maxRetries: 2,
        backoffMs: 500,
      }
    )();

    this.decompositionCache.set(cacheKey, result);
    return result;
  }

  private async executeOrchestratedTask(
    task: OrchestratedTask,
    options?: { parallel?: boolean; maxConcurrent?: number }
  ): Promise<void> {
    if (!task.executionPlan || task.executionPlan.phases.length === 0) {
      await this.executeSingleTask(task);
      return;
    }

    const parallel = options?.parallel ?? this.config.defaultParallel;
    const maxConcurrent = options?.maxConcurrent ?? this.config.defaultMaxConcurrent;

    console.log(`[Orchestrator] Executing task ${task.id} in ${task.executionPlan.phases.length} phases`);

    for (const phase of task.executionPlan.phases) {
      task.currentPhase = phase.id;
      console.log(`[Orchestrator] Phase ${phase.id}: ${phase.tasks.length} tasks (parallel: ${phase.canRunParallel && parallel})`);

      if (phase.canRunParallel && parallel) {
        await this.executePhaseParallel(task, phase, maxConcurrent);
      } else {
        await this.executePhaseSequential(task, phase);
      }
    }
  }

  private async executePhaseParallel(
    task: OrchestratedTask,
    phase: Phase,
    maxConcurrent: number
  ): Promise<void> {
    const queue = [...phase.tasks];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (queue.length > 0 && active.length < maxConcurrent) {
        const subtaskId = queue.shift()!;
        const p = this.executeSubtask(task, subtaskId).then(() => {});
        active.push(p);
      }

      if (active.length > 0) {
        await Promise.race(active);
        
        const completed: Promise<void>[] = [];
        for (const p of active) {
          try {
            await Promise.race([p, Promise.resolve()]);
            completed.push(p);
          } catch {}
        }
        
        for (const c of completed) {
          const idx = active.indexOf(c);
          if (idx > -1) active.splice(idx, 1);
        }
      }
    }
  }

  private async executePhaseSequential(
    task: OrchestratedTask,
    phase: Phase
  ): Promise<void> {
    for (const subtaskId of phase.tasks) {
      await this.executeSubtask(task, subtaskId);
    }
  }

  private async executeSubtask(task: OrchestratedTask, subtaskId: string): Promise<void> {
    const decomposition = task.decomposition;
    if (!decomposition) return;

    const subtask = decomposition.subtasks.find(s => s.id === subtaskId);
    if (!subtask) {
      console.warn(`[Orchestrator] Subtask ${subtaskId} not found`);
      return;
    }

    console.log(`[Orchestrator] Executing subtask ${subtaskId}: ${subtask.title}`);

    const reserved = await this.resourceManager.reserve(task.issueId);
    if (!reserved) {
      throw new Error(`Failed to reserve resources for ${task.issueId}`);
    }

    try {
      const spawnConfig: SpawnConfig = {
        projectId: task.issueId.split('-')[0] || 'unknown',
        issueId: `${task.issueId}-${subtaskId}`,
        task: `${subtask.title}\n\n${subtask.description}`,
      };

      const session = await this.sessionManager.spawn(spawnConfig);
      task.sessionIds.push(session.id);
      task.completedSubtasks.push(subtaskId);
      this.dependencyResolver.completeTask(subtaskId, true);

      console.log(`[Orchestrator] Completed subtask ${subtaskId}`);
    } catch (error) {
      this.dependencyResolver.completeTask(subtaskId, false);
      throw error;
    } finally {
      await this.resourceManager.release(task.issueId);
    }
  }

  private async executeSingleTask(task: OrchestratedTask): Promise<void> {
    const reserved = await this.resourceManager.reserve(task.issueId);
    if (!reserved) {
      throw new Error(`Failed to reserve resources for ${task.issueId}`);
    }

    try {
      task.status = 'running';
      this.logEvent('taskRunning', { taskId: task.id });

      const spawnConfig: SpawnConfig = {
        projectId: task.issueId.split('-')[0] || 'unknown',
        issueId: task.issueId,
        task: task.task,
      };

      const session = await this.sessionManager.spawn(spawnConfig);
      task.sessionIds.push(session.id);

      console.log(`[Orchestrator] Spawned session ${session.id} for ${task.issueId}`);
    } finally {
      await this.resourceManager.release(task.issueId);
    }
  }

  async spawnBatch(config: BatchSpawnConfig): Promise<any> {
    return withErrorHandling(
      async () => this.batchSpawner.spawn(config),
      {
        operation: 'orchestrator.spawnBatch',
        retry: { maxRetries: 2, backoffMs: 1000 },
      }
    );
  }

  decomposeTask(task: string, issueId?: string, config?: TaskDecompositionConfig): DecomposedTask {
    const decomposer = config 
      ? new TaskDecomposer(config) 
      : this.taskDecomposer;
    return decomposer.decompose(task, issueId);
  }

  async resolveDependencies(subtasks: Subtask[]): Promise<{ graph: any; plan: ExecutionPlan }> {
    const graph = await this.dependencyResolver.buildGraph(subtasks);
    const cycles = await this.dependencyResolver.detectCycles();
    
    if (cycles) {
      throw new Error(`Circular dependencies detected: ${cycles.join(', ')}`);
    }
    
    const plan = await this.dependencyResolver.generateExecutionPlan();
    return { graph, plan };
  }

  getResourceStatus(): ResourceUsage {
    return this.resourceManager.getUsage();
  }

  getStatus(): OrchestratorStatus {
    return this.memoizedGetStatus();
  }

  private calculateStatus(): OrchestratorStatus {
    const allTasks = Array.from(this.tasks.values());
    
    return {
      activeTasks: allTasks.filter(t => t.status === 'running' || t.status === 'ready').length,
      completedTasks: allTasks.filter(t => t.status === 'completed').length,
      failedTasks: allTasks.filter(t => t.status === 'failed').length,
      totalTasks: this.tasks.size,
      resourceUsage: this.resourceManager.getUsage(),
      queued: this.batchSpawner.listBatches().length,
    };
  }

  getTask(taskId: string): OrchestratedTask | undefined {
    return this.tasks.get(taskId);
  }

  getTaskByIssue(issueId: string): OrchestratedTask | undefined {
    return Array.from(this.tasks.values()).find(t => t.issueId === issueId);
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    await this.resourceManager.release(task.issueId);
    
    task.status = 'failed';
    task.error = 'Cancelled by user';
    
    this.logEvent('taskCancelled', { taskId });
    this.emit('taskCancelled', task);
  }

  getEventHistory(limit?: number): OrchestratorEvent[] {
    return limit 
      ? this.eventHistory.slice(-limit) 
      : [...this.eventHistory];
  }

  updateResourceConfig(config: Partial<ResourceConfig>): void {
    this.resourceManager.updateConfig(config);
    this.config.maxConcurrentAgents = config.maxConcurrentAgents || this.config.maxConcurrentAgents;
    this.config.maxTotalAgents = config.maxTotalAgents || this.config.maxTotalAgents;
  }

  getHealth(): {
    healthy: boolean;
    resourceHealth: ReturnType<ResourceManager['getHealth']>;
    tasks: OrchestratorStatus;
  } {
    const resourceHealth = this.resourceManager.getHealth();
    
    return {
      healthy: resourceHealth.healthy,
      resourceHealth,
      tasks: this.getStatus(),
    };
  }

  cleanup(): number {
    return this.resourceManager.cleanupStuckSlots();
  }
}
