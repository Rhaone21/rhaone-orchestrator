/**
 * Rhaone Orchestrator - Optimized Main Orchestrator
 */

import { EventEmitter } from 'events';
import { OptimizedSessionManager, SpawnConfig, Session } from './session-manager';
import { OptimizedBatchSpawner, BatchSpawnConfig } from './batch-spawner';
import { OptimizedResourceManager, ResourceManagerOptions, ResourceState, ResourceMetrics } from './resource-manager';

export interface OrchestratorConfig {
  maxConcurrentAgents: number;
  maxTotalAgents: number;
  defaultTimeoutMs: number;
  defaultParallel: boolean;
  defaultMaxConcurrent: number;
  failFast: boolean;
}

export interface OrchestratedTask {
  id: string;
  issueId: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  sessionIds: string[];
  error?: string;
  startTime?: number;
  endTime?: number;
}

export interface OrchestratorStatus {
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalTasks: number;
  resourceUsage: ResourceState;
}

export class OptimizedOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private sessionManager: OptimizedSessionManager;
  private batchSpawner: OptimizedBatchSpawner;
  private resourceManager: OptimizedResourceManager;
  
  private tasks: Map<string, OrchestratedTask> = new Map();
  private cleanupTimer?: NodeJS.Timeout;
  private isDestroyed = false;

  constructor(sessionManager: OptimizedSessionManager, config?: Partial<OrchestratorConfig>) {
    super();
    
    this.sessionManager = sessionManager;
    this.config = {
      maxConcurrentAgents: config?.maxConcurrentAgents || 5,
      maxTotalAgents: config?.maxTotalAgents || 20,
      defaultTimeoutMs: config?.defaultTimeoutMs || 30 * 60 * 1000,
      defaultParallel: config?.defaultParallel ?? true,
      defaultMaxConcurrent: config?.defaultMaxConcurrent || 5,
      failFast: config?.failFast ?? true,
    };

    this.batchSpawner = new OptimizedBatchSpawner(sessionManager);
    this.resourceManager = new OptimizedResourceManager({
      maxConcurrentAgents: this.config.maxConcurrentAgents,
      maxTotalAgents: this.config.maxTotalAgents,
      timeoutMs: this.config.defaultTimeoutMs,
    });

    this.cleanupTimer = setInterval(() => this.cleanupCompletedTasks(), 60000);
  }

  private cleanupCompletedTasks(maxAgeMs: number = 60 * 60 * 1000): void {
    const now = performance.now();
    
    for (const [taskId, task] of this.tasks) {
      if ((task.status === 'completed' || task.status === 'failed') && task.endTime) {
        if (now - task.endTime > maxAgeMs) {
          this.tasks.delete(taskId);
        }
      }
    }
  }

  async orchestrateTask(
    issueId: string, 
    task: string
  ): Promise<OrchestratedTask> {
    const startTime = performance.now();
    const taskId = `orch-${issueId}-${Date.now().toString(36)}`;
    
    const orchestratedTask: OrchestratedTask = {
      id: taskId,
      issueId,
      task,
      status: 'pending',
      sessionIds: [],
      startTime,
    };
    
    this.tasks.set(taskId, orchestratedTask);

    try {
      orchestratedTask.status = 'running';
      
      const reserved = await this.resourceManager.reserve(issueId);
      if (!reserved) {
        throw new Error(`Failed to reserve resources for ${issueId}`);
      }

      try {
        const spawnConfig: SpawnConfig = {
          projectId: issueId.split('-')[0] || 'unknown',
          issueId: issueId,
          task: task,
        };

        const session = await this.sessionManager.spawn(spawnConfig);
        orchestratedTask.sessionIds.push(session.id);
      } finally {
        await this.resourceManager.release(issueId);
      }

      orchestratedTask.status = 'completed';
      orchestratedTask.endTime = performance.now();
      this.emit('taskCompleted', orchestratedTask);
      
      return orchestratedTask;
    } catch (error) {
      orchestratedTask.status = 'failed';
      orchestratedTask.endTime = performance.now();
      orchestratedTask.error = error instanceof Error ? error.message : String(error);
      this.emit('taskFailed', orchestratedTask);
      
      throw error;
    }
  }

  async spawnBatch(config: BatchSpawnConfig): Promise<any> {
    return this.batchSpawner.spawn(config);
  }

  getResourceStatus(): ResourceState {
    return this.resourceManager.getState();
  }

  getResourceMetrics(): ResourceMetrics {
    return this.resourceManager.getMetrics();
  }

  getStatus(): OrchestratorStatus {
    let activeTasks = 0;
    let completedTasks = 0;
    let failedTasks = 0;

    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        activeTasks++;
      } else if (task.status === 'completed') {
        completedTasks++;
      } else if (task.status === 'failed') {
        failedTasks++;
      }
    }

    return {
      activeTasks,
      completedTasks,
      failedTasks,
      totalTasks: this.tasks.size,
      resourceUsage: this.resourceManager.getState(),
    };
  }

  getTask(taskId: string): OrchestratedTask | undefined {
    return this.tasks.get(taskId);
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    await this.resourceManager.release(task.issueId);
    
    task.status = 'failed';
    task.error = 'Cancelled by user';
    task.endTime = performance.now();
    
    this.emit('taskCancelled', task);
  }

  updateResourceConfig(config: Partial<ResourceManagerOptions>): void {
    this.config.maxConcurrentAgents = config.maxConcurrentAgents || this.config.maxConcurrentAgents;
    this.config.maxTotalAgents = config.maxTotalAgents || this.config.maxTotalAgents;
  }

  cleanup(): number {
    return this.resourceManager.cleanupCooldowns();
  }

  async destroy(): Promise<void> {
    this.isDestroyed = true;
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    const cancelPromises: Promise<void>[] = [];
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'running') {
        cancelPromises.push(this.cancelTask(taskId).catch(() => {}));
      }
    }
    await Promise.all(cancelPromises);

    this.batchSpawner.destroy();
    this.resourceManager.destroy();
    
    this.tasks.clear();
    this.removeAllListeners();
  }
}
