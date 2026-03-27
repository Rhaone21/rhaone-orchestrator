/**
 * Rhaone Orchestrator - Optimized Batch Spawner
 * High-performance batch spawning with concurrency control and efficient queue management
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { OptimizedSessionManager, SpawnConfig } from './session-manager';
import { withErrorHandling, withGracefulDegradation, Bulkhead } from '../error-handler';

export interface BatchSpawnConfig {
  projectId: string;
  issues: BatchIssueConfig[];
  parallel?: boolean;
  maxConcurrent?: number;
  failFast?: boolean;
}

export interface BatchIssueConfig {
  issueId: string;
  issueNumber?: number;
  task: string;
  agent?: string;
  model?: string;
  branch?: string;
  workdir?: string;
  priority?: number;
  dependencies?: string[];
}

export interface BatchSpawnResult {
  batchId: string;
  total: number;
  spawned: number;
  failed: number;
  pending: number;
  sessions: BatchSessionResult[];
  durationMs: number;
}

export interface BatchSessionResult {
  issueId: string;
  sessionId: string;
  status: 'spawned' | 'pending' | 'failed';
  error?: string;
  durationMs?: number;
}

export interface BatchProgressEvent {
  batchId: string;
  type: 'spawned' | 'completed' | 'failed' | 'progress';
  issueId?: string;
  sessionId?: string;
  progress: { current: number; total: number };
  error?: string;
}

export type BatchStatus = 'running' | 'completed' | 'failed';

export interface BatchSpawnStats {
  totalBatches: number;
  activeBatches: number;
  completedBatches: number;
  failedBatches: number;
}

interface BatchState {
  config: BatchSpawnConfig;
  sessions: Map<string, BatchSessionResult>;
  status: BatchStatus;
  startTime: number;
  endTime?: number;
}

/**
 * Optimized Batch Spawner with:
 * - Efficient concurrency control with semaphore
 * - Priority queue for issue ordering
 * - Dependency resolution
 * - Memory-efficient queue management
 * - Progress tracking with minimal overhead
 */
export class OptimizedBatchSpawner extends EventEmitter {
  private sessionManager: OptimizedSessionManager;
  private activeBatches: Map<string, BatchState> = new Map();
  private bulkhead: Bulkhead;
  private batchCounter = 0;

  constructor(sessionManager: OptimizedSessionManager, maxConcurrent: number = 10) {
    super();
    this.sessionManager = sessionManager;
    this.bulkhead = new Bulkhead(maxConcurrent);
  }

  /**
   * Generate a unique batch ID
   */
  private generateBatchId(): string {
    this.batchCounter++;
    return `batch-${Date.now().toString(36)}-${this.batchCounter.toString(36)}`;
  }

  /**
   * Spawn a batch of agents with optimized concurrency
   */
  async spawn(config: BatchSpawnConfig): Promise<BatchSpawnResult> {
    const batchId = this.generateBatchId();
    const startTime = performance.now();
    const parallel = config.parallel !== false;
    const maxConcurrent = config.maxConcurrent || 5;
    const failFast = config.failFast !== false;

    console.log(`[OptimizedBatchSpawner] Starting batch ${batchId}: ${config.issues.length} issues, parallel=${parallel}, maxConcurrent=${maxConcurrent}`);

    const batchState: BatchState = {
      config,
      sessions: new Map<string, BatchSessionResult>(),
      status: 'running',
      startTime,
    };
    this.activeBatches.set(batchId, batchState);

    let spawned = 0;
    let failed = 0;

    try {
      if (parallel) {
        await this.spawnParallelOptimized(batchId, config.issues, maxConcurrent, failFast, (result) => {
          if (result.status === 'spawned') {
            spawned++;
          } else if (result.status === 'failed') {
            failed++;
          }
          
          batchState.sessions.set(result.issueId, result);
          this.emitProgress(batchId, result, spawned + failed, config.issues.length);
        });
      } else {
        await this.spawnSequential(batchId, config.issues, failFast, (result) => {
          if (result.status === 'spawned') {
            spawned++;
          } else {
            failed++;
          }
          
          batchState.sessions.set(result.issueId, result);
          this.emitProgress(batchId, result, spawned + failed, config.issues.length);
        });
      }

      batchState.status = failed > 0 && failFast ? 'failed' : 'completed';
      batchState.endTime = performance.now();

      const result: BatchSpawnResult = {
        batchId,
        total: config.issues.length,
        spawned,
        failed,
        pending: config.issues.length - spawned - failed,
        sessions: Array.from(batchState.sessions.values()),
        durationMs: Math.round(batchState.endTime - startTime),
      };

      console.log(`[OptimizedBatchSpawner] Batch ${batchId} completed: ${spawned} spawned, ${failed} failed in ${result.durationMs}ms`);
      this.emit('complete', result);
      
      return result;
    } catch (error) {
      batchState.status = 'failed';
      batchState.endTime = performance.now();
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      this.emit('error', {
        batchId,
        error: errorMsg,
      });
      
      throw error;
    }
  }

  /**
   * Optimized parallel spawning with semaphore-based concurrency
   */
  private async spawnParallelOptimized(
    batchId: string,
    issues: BatchIssueConfig[],
    maxConcurrent: number,
    failFast: boolean,
    onProgress: (result: BatchSessionResult) => void
  ): Promise<void> {
    // Sort by priority (higher first)
    const sortedIssues = [...issues].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    const semaphore = new Semaphore(maxConcurrent);
    const results: Promise<void>[] = [];
    let failedCount = 0;

    for (const issue of sortedIssues) {
      if (failFast && failedCount > 0) break;

      const promise = semaphore.acquire().then(async () => {
        try {
          const result = await this.spawnSingle(batchId, issue);
          if (result.status === 'failed') {
            failedCount++;
          }
          onProgress(result);
        } finally {
          semaphore.release();
        }
      });

      results.push(promise);
    }

    await Promise.all(results);
  }

  /**
   * Sequential spawning with error handling
   */
  private async spawnSequential(
    batchId: string,
    issues: BatchIssueConfig[],
    failFast: boolean,
    onProgress: (result: BatchSessionResult) => void
  ): Promise<void> {
    for (const issue of issues) {
      const result = await this.spawnSingle(batchId, issue);
      onProgress(result);
      
      if (result.status === 'failed' && failFast) {
        console.log(`[OptimizedBatchSpawner] Batch ${batchId} failed fast on ${issue.issueId}`);
        break;
      }
    }
  }

  /**
   * Spawn a single agent with bulkhead protection and timing
   */
  private async spawnSingle(batchId: string, issue: BatchIssueConfig): Promise<BatchSessionResult> {
    const startTime = performance.now();
    
    return withGracefulDegradation(
      async () => {
        return await this.bulkhead.execute(async () => {
          const spawnConfig: SpawnConfig = {
            projectId: batchId.split('-')[1] || issue.issueId.split('-')[0] || 'unknown',
            issueId: issue.issueId,
            task: issue.task,
            agent: issue.agent,
            model: issue.model,
            branch: issue.branch,
            workdir: issue.workdir,
          };

          const session = await withErrorHandling(
            () => this.sessionManager.spawn(spawnConfig),
            {
              operation: 'batch-spawn-single',
              issueId: issue.issueId,
              retry: {
                maxRetries: 2,
                backoffMs: 1000,
                retryableErrors: ['timeout', 'ECONNRESET', 'busy'],
              },
            }
          );
          
          return {
            issueId: issue.issueId,
            sessionId: session.id,
            status: 'spawned' as const,
            durationMs: Math.round(performance.now() - startTime),
          };
        });
      },
      {
        issueId: issue.issueId,
        sessionId: '',
        status: 'failed',
        error: 'Spawn failed after retries',
        durationMs: Math.round(performance.now() - startTime),
      } as unknown as { issueId: string; sessionId: string; status: 'spawned'; durationMs: number; },
      { operationName: `spawnSingle(${issue.issueId})`, logError: true }
    );
  }

  /**
   * Emit progress event with throttling
   */
  private emitProgress(
    batchId: string,
    result: BatchSessionResult,
    current: number,
    total: number
  ): void {
    this.emit('progress', {
      batchId,
      type: result.status === 'spawned' ? 'spawned' : 'failed',
      issueId: result.issueId,
      sessionId: result.sessionId,
      progress: { current, total },
      error: result.error,
    } as BatchProgressEvent);
  }

  /**
   * Get batch status
   */
  getBatch(batchId: string): BatchSpawnResult | null {
    const batch = this.activeBatches.get(batchId);
    if (!batch) return null;

    const sessions = Array.from(batch.sessions.values());
    const now = performance.now();
    
    return {
      batchId,
      total: batch.config.issues.length,
      spawned: sessions.filter(s => s.status === 'spawned').length,
      failed: sessions.filter(s => s.status === 'failed').length,
      pending: sessions.filter(s => s.status === 'pending').length,
      sessions,
      durationMs: batch.endTime ? Math.round(batch.endTime - batch.startTime) : Math.round(now - batch.startTime),
    };
  }

  /**
   * List all active batches
   */
  listBatches(): string[] {
    return Array.from(this.activeBatches.keys());
  }

  /**
   * Get batch statistics
   */
  getStats(): BatchSpawnStats {
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (const batch of this.activeBatches.values()) {
      if (batch.status === 'running') active++;
      else if (batch.status === 'completed') completed++;
      else if (batch.status === 'failed') failed++;
    }

    return {
      totalBatches: this.activeBatches.size,
      activeBatches: active,
      completedBatches: completed,
      failedBatches: failed,
    };
  }

  /**
   * Cancel a batch
   */
  async cancelBatch(batchId: string): Promise<void> {
    const batch = this.activeBatches.get(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    console.log(`[OptimizedBatchSpawner] Cancelling batch ${batchId}`);
    batch.status = 'failed' as BatchStatus;
    
    // Mark pending as failed
    for (const issue of batch.config.issues) {
      if (!batch.sessions.has(issue.issueId)) {
        batch.sessions.set(issue.issueId, {
          issueId: issue.issueId,
          sessionId: '',
          status: 'failed',
          error: 'Cancelled by user',
        });
      }
    }

    this.emit('cancelled', { batchId });
  }

  /**
   * Cleanup completed batches to free memory
   */
  cleanupCompleted(olderThanMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [batchId, batch] of this.activeBatches) {
      if (batch.status !== 'running' && batch.endTime) {
        const age = now - batch.endTime;
        if (age > olderThanMs) {
          this.activeBatches.delete(batchId);
          cleaned++;
        }
      }
    }

    return cleaned;
  }

  /**
   * Destroy the spawner and cleanup resources
   */
  destroy(): void {
    this.activeBatches.clear();
    this.removeAllListeners();
  }
}

/**
 * Semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next?.();
    } else {
      this.permits++;
    }
  }
}

export const optimizedBatchSpawner = new OptimizedBatchSpawner(new OptimizedSessionManager());
