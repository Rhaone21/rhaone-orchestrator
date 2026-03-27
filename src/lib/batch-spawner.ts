/**
 * Rhaone Orchestrator - Batch Spawner
 * Spawn multiple agents for multiple issues in parallel or sequence with error handling
 */

import { EventEmitter } from 'events';
import { SessionManager, SpawnConfig, Session } from './session-manager';
import { withErrorHandling, withGracefulDegradation, Bulkhead } from './error-handler';
import { LRUCache, asyncMemoize } from './performance-optimizer';

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
  dependencies?: string[]; // IDs of other issues this depends on
}

export interface BatchSpawnResult {
  batchId: string;
  total: number;
  spawned: number;
  failed: number;
  pending: number;
  sessions: BatchSessionResult[];
}

export interface BatchSessionResult {
  issueId: string;
  sessionId: string;
  status: 'spawned' | 'pending' | 'failed';
  error?: string;
}

export interface BatchProgressEvent {
  batchId: string;
  type: 'spawned' | 'completed' | 'failed' | 'progress';
  issueId?: string;
  sessionId?: string;
  progress: { current: number; total: number };
  error?: string;
}

/**
 * Batch Spawner - handles spawning multiple agent sessions
 */
export type BatchStatus = 'running' | 'completed' | 'failed';

export interface BatchSpawnStats {
  totalBatches: number;
  activeBatches: number;
  completedBatches: number;
  failedBatches: number;
}

export interface BatchSpawnOptions {
  parallel?: boolean;
  maxConcurrent?: number;
  failFast?: boolean;
}

export class BatchSpawner extends EventEmitter {
  private sessionManager: SessionManager;
  private activeBatches: Map<string, {
    config: BatchSpawnConfig;
    sessions: Map<string, BatchSessionResult>;
    status: 'running' | 'completed' | 'failed';
    startTime: number;
  }> = new Map();
  private bulkhead: Bulkhead;
  private spawnCache: LRUCache<string, BatchSessionResult>;
  private batchIdCache: LRUCache<string, string>;

  constructor(sessionManager: SessionManager, maxConcurrent: number = 10) {
    super();
    this.sessionManager = sessionManager;
    this.bulkhead = new Bulkhead(maxConcurrent);
    
    // Initialize LRU caches for performance
    this.spawnCache = new LRUCache<string, BatchSessionResult>({
      maxSize: 500,
      ttlMs: 60 * 1000, // 1 minute TTL
    });
    
    this.batchIdCache = new LRUCache<string, string>({
      maxSize: 100,
      ttlMs: 24 * 60 * 60 * 1000, // 24 hours - batch IDs are unique
    });
  }

  /**
   * Generate a unique batch ID - with caching
   */
  private generateBatchId(): string {
    const timestamp = Date.now().toString(36);
    const cached = this.batchIdCache.get(timestamp);
    if (cached) return cached;
    
    const id = `batch-${timestamp}-${Math.random().toString(36).slice(2, 6)}`;
    this.batchIdCache.set(timestamp, id);
    return id;
  }

  /**
   * Spawn a batch of agents
   */
  async spawn(config: BatchSpawnConfig): Promise<BatchSpawnResult> {
    const batchId = this.generateBatchId();
    const parallel = config.parallel !== false;
    const maxConcurrent = config.maxConcurrent || 5;
    const failFast = config.failFast !== false;

    console.log(`[BatchSpawner] Starting batch ${batchId}: ${config.issues.length} issues, parallel=${parallel}, maxConcurrent=${maxConcurrent}`);

    const batchState = {
      config,
      sessions: new Map<string, BatchSessionResult>(),
      status: 'running' as const,
      startTime: Date.now(),
    };
    this.activeBatches.set(batchId, batchState);

    let spawned = 0;
    let failed = 0;
    let pending = config.issues.length;

    try {
      if (parallel) {
        // Parallel execution with concurrency limit
        await this.spawnParallel(batchId, config.issues, maxConcurrent, failFast, (result) => {
          if (result.status === 'spawned') {
            spawned++;
            pending--;
          } else if (result.status === 'failed') {
            failed++;
            pending--;
          }
          
          batchState.sessions.set(result.issueId, result);
          
          this.emit('progress', {
            batchId,
            type: result.status === 'spawned' ? 'spawned' : 'failed',
            issueId: result.issueId,
            sessionId: result.sessionId,
            progress: { current: spawned + failed, total: config.issues.length },
            error: result.error,
          } as BatchProgressEvent);
        });
      } else {
        // Sequential execution
        for (const issue of config.issues) {
          const result = await this.spawnSingle(batchId, issue);
          
          if (result.status === 'spawned') {
            spawned++;
          } else {
            failed++;
            if (failFast) {
              console.log(`[BatchSpawner] Batch ${batchId} failed fast on ${issue.issueId}`);
              break;
            }
          }
          
          batchState.sessions.set(issue.issueId, result);
          
          this.emit('progress', {
            batchId,
            type: result.status === 'spawned' ? 'spawned' : 'failed',
            issueId: result.issueId,
            sessionId: result.sessionId,
            progress: { current: spawned + failed, total: config.issues.length },
            error: result.error,
          } as BatchProgressEvent);
        }
      }

      (batchState as { status: 'running' | 'completed' | 'failed' }).status = failed > 0 ? 'failed' : 'completed';

      const result: BatchSpawnResult = {
        batchId,
        total: config.issues.length,
        spawned,
        failed,
        pending,
        sessions: Array.from(batchState.sessions.values()),
      };

      console.log(`[BatchSpawner] Batch ${batchId} completed: ${spawned} spawned, ${failed} failed`);
      this.emit('complete', result);
      
      return result;
    } catch (error) {
      (batchState as { status: 'running' | 'completed' | 'failed' }).status = 'failed';
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      this.emit('error', {
        batchId,
        error: errorMsg,
      });
      
      throw error;
    }
  }

  /**
   * Spawn multiple issues in parallel with concurrency control
   */
  private async spawnParallel(
    batchId: string,
    issues: BatchIssueConfig[],
    maxConcurrent: number,
    failFast: boolean,
    onProgress: (result: BatchSessionResult) => void
  ): Promise<void> {
    const queue = [...issues];
    const active: Promise<void>[] = [];
    let failedCount = 0;

    const processNext = async (): Promise<void> => {
      while (queue.length > 0 && active.length < maxConcurrent) {
        if (failFast && failedCount > 0) break;
        
        const issue = queue.shift();
        if (!issue) break;

        const promise = this.spawnSingle(batchId, issue)
          .then(result => {
            if (result.status === 'failed') {
              failedCount++;
            }
            onProgress(result);
          })
          .catch(error => {
            failedCount++;
            onProgress({
              issueId: issue.issueId,
              sessionId: '',
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
          });
        
        active.push(promise);
      }

      if (active.length > 0) {
        await Promise.race(active);
        const completed = active.filter(p => {
          // Check if promise settled (simple approximation)
          return (p as any).status === 'fulfilled' || (p as any).status === 'rejected';
        });
        
        // Remove completed promises
        for (const p of completed) {
          const idx = active.indexOf(p);
          if (idx > -1) active.splice(idx, 1);
        }

        // Continue processing
        if (queue.length > 0 || active.length > 0) {
          await processNext();
        }
      }
    };

    // Start initial batch
    const initial = Math.min(maxConcurrent, queue.length);
    for (let i = 0; i < initial; i++) {
      const issue = queue.shift();
      if (issue) {
        const p = this.spawnSingle(batchId, issue)
          .then(result => {
            if (result.status === 'failed') failedCount++;
            onProgress(result);
          })
          .catch(error => {
            failedCount++;
            onProgress({
              issueId: issue.issueId,
              sessionId: '',
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
          });
        active.push(p);
      }
    }

    // Wait for all to complete
    await Promise.allSettled(active);
  }

  /**
   * Spawn a single agent for one issue with bulkhead protection and caching
   */
  private async spawnSingle(batchId: string, issue: BatchIssueConfig): Promise<BatchSessionResult> {
    const cacheKey = `${batchId}:${issue.issueId}`;
    
    // Check cache first
    const cached = this.spawnCache.get(cacheKey);
    if (cached) {
      console.log(`[BatchSpawner] Cache hit for ${issue.issueId}`);
      return cached;
    }
    
    const result = await withGracefulDegradation(
      async () => {
        // Use bulkhead to limit concurrent spawns
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
          };
        });
      },
      {
        issueId: issue.issueId,
        sessionId: '',
        status: 'failed',
        error: 'Spawn failed after retries',
      } as unknown as { issueId: string; sessionId: string; status: 'spawned'; },
      { operationName: `spawnSingle(${issue.issueId})`, logError: true }
    );
    
    // Cache successful results
    if (result && result.status === 'spawned') {
      this.spawnCache.set(cacheKey, result);
    }
    
    return result;
  }

  /**
   * Get batch status
   */
  getBatch(batchId: string): BatchSpawnResult | null {
    const batch = this.activeBatches.get(batchId);
    if (!batch) return null;

    const sessions = Array.from(batch.sessions.values());
    return {
      batchId,
      total: batch.config.issues.length,
      spawned: sessions.filter(s => s.status === 'spawned').length,
      failed: sessions.filter(s => s.status === 'failed').length,
      pending: sessions.filter(s => s.status === 'pending').length,
      sessions,
    };
  }

  /**
   * List all active batches
   */
  listBatches(): string[] {
    return Array.from(this.activeBatches.keys());
  }

  /**
   * Cancel a batch (marks all pending as failed)
   */
  async cancelBatch(batchId: string): Promise<void> {
    const batch = this.activeBatches.get(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    console.log(`[BatchSpawner] Cancelling batch ${batchId}`);
    batch.status = 'failed';
    
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
}