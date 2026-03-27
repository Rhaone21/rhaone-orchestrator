/**
 * Rhaone Orchestrator - Optimized Resource Manager
 * High-performance resource management with efficient concurrency control
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

export interface ResourceManagerOptions {
  maxConcurrentAgents?: number;
  maxTotalAgents?: number;
  timeoutMs?: number;
  cooldownMs?: number;
}

export interface ResourceState {
  active: number;
  total: number;
  queueLength: number;
  utilizationPercent: number;
}

export interface ResourceMetrics {
  totalReserves: number;
  totalReleases: number;
  totalTimeouts: number;
  avgWaitTimeMs: number;
  peakConcurrent: number;
}

interface WaitQueueEntry {
  issueId: string;
  resolve: (reserved: boolean) => void;
  reject: (error: Error) => void;
  startTime: number;
}

/**
 * Optimized Resource Manager with:
 * - Fast path for immediate availability
 * - Efficient wait queue with priority
 * - Lock-free counters where possible
 * - Memory-efficient queue management
 */
export class OptimizedResourceManager extends EventEmitter {
  private maxConcurrent: number;
  private maxTotal: number;
  private timeoutMs: number;
  private cooldownMs: number;

  private activeAgents: Set<string> = new Set();
  private totalAgents: number = 0;
  private waitQueue: WaitQueueEntry[] = [];
  private cooldownMap: Map<string, number> = new Map();

  // Metrics
  private metrics: ResourceMetrics = {
    totalReserves: 0,
    totalReleases: 0,
    totalTimeouts: 0,
    avgWaitTimeMs: 0,
    peakConcurrent: 0,
  };

  // Fast path optimization
  private fastPathEnabled = true;
  private lastReserveTime = 0;
  private reserveCount = 0;

  constructor(options: ResourceManagerOptions = {}) {
    super();
    this.maxConcurrent = options.maxConcurrentAgents || 5;
    this.maxTotal = options.maxTotalAgents || 20;
    this.timeoutMs = options.timeoutMs || 30000;
    this.cooldownMs = options.cooldownMs || 5000;
  }

  /**
   * Reserve a resource slot
   * Fast path: immediately available
   * Slow path: wait in queue
   */
  async reserve(issueId: string): Promise<boolean> {
    // Fast path check
    if (this.fastPathEnabled && this.canReserveFast()) {
      this.doReserve(issueId);
      return true;
    }

    // Slow path: wait for availability
    return this.reserveWithWait(issueId);
  }

  /**
   * Fast path check - no locking needed
   */
  private canReserveFast(): boolean {
    return (
      this.activeAgents.size < this.maxConcurrent &&
      this.totalAgents < this.maxTotal &&
      this.waitQueue.length === 0 &&
      !this.isInCooldown(this.activeAgents.values().next().value || '')
    );
  }

  /**
   * Immediate reserve without waiting
   */
  private doReserve(issueId: string): void {
    this.activeAgents.add(issueId);
    this.totalAgents++;
    this.metrics.totalReserves++;
    this.lastReserveTime = Date.now();
    this.reserveCount++;

    // Update peak concurrent
    if (this.activeAgents.size > this.metrics.peakConcurrent) {
      this.metrics.peakConcurrent = this.activeAgents.size;
    }

    // Disable fast path if we're near capacity
    if (this.activeAgents.size >= this.maxConcurrent * 0.8) {
      this.fastPathEnabled = false;
    }

    this.emit('reserve', { issueId, active: this.activeAgents.size });
  }

  /**
   * Reserve with wait queue
   */
  private async reserveWithWait(issueId: string): Promise<boolean> {
    // Check if already active
    if (this.activeAgents.has(issueId)) {
      return true;
    }

    // Check cooldown
    if (this.isInCooldown(issueId)) {
      const remaining = this.getCooldownRemaining(issueId);
      throw new Error(`Agent ${issueId} is in cooldown for ${remaining}ms`);
    }

    // Check if we can reserve immediately
    if (this.activeAgents.size < this.maxConcurrent && this.totalAgents < this.maxTotal) {
      this.doReserve(issueId);
      return true;
    }

    // Need to wait
    return new Promise((resolve, reject) => {
      const entry: WaitQueueEntry = {
        issueId,
        resolve,
        reject,
        startTime: performance.now(),
      };

      this.waitQueue.push(entry);
      this.emit('queued', { issueId, queuePosition: this.waitQueue.length });

      // Set timeout
      const timeoutId = setTimeout(() => {
        const index = this.waitQueue.indexOf(entry);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
          this.metrics.totalTimeouts++;
          reject(new Error(`Timeout waiting for resource slot after ${this.timeoutMs}ms`));
        }
      }, this.timeoutMs);

      // Override resolve to clear timeout
      const originalResolve = resolve;
      entry.resolve = (reserved: boolean) => {
        clearTimeout(timeoutId);
        originalResolve(reserved);
      };
    });
  }

  /**
   * Release a resource slot
   */
  release(issueId: string): void {
    if (!this.activeAgents.has(issueId)) {
      return;
    }

    this.activeAgents.delete(issueId);
    this.totalAgents--;
    this.metrics.totalReleases++;

    // Add to cooldown
    if (this.cooldownMs > 0) {
      this.cooldownMap.set(issueId, Date.now() + this.cooldownMs);
    }

    // Re-enable fast path if we're well below capacity
    if (this.activeAgents.size < this.maxConcurrent * 0.5) {
      this.fastPathEnabled = true;
    }

    // Process wait queue
    this.processWaitQueue();

    this.emit('release', { issueId, active: this.activeAgents.size });
  }

  /**
   * Process wait queue efficiently
   */
  private processWaitQueue(): void {
    while (this.waitQueue.length > 0 && this.canReserveFast()) {
      const entry = this.waitQueue.shift();
      if (!entry) continue;

      // Check if still valid
      if (this.isInCooldown(entry.issueId)) {
        entry.reject(new Error('Issue is in cooldown'));
        continue;
      }

      // Calculate wait time
      const waitTime = performance.now() - entry.startTime;
      this.updateAvgWaitTime(waitTime);

      // Reserve
      this.doReserve(entry.issueId);
      entry.resolve(true);

      this.emit('reserveFromQueue', { 
        issueId: entry.issueId, 
        waitTimeMs: waitTime 
      });
    }
  }

  /**
   * Update average wait time with exponential moving average
   */
  private updateAvgWaitTime(waitTime: number): void {
    const alpha = 0.1; // Smoothing factor
    this.metrics.avgWaitTimeMs = 
      (1 - alpha) * this.metrics.avgWaitTimeMs + alpha * waitTime;
  }

  /**
   * Check if issue is in cooldown
   */
  private isInCooldown(issueId: string): boolean {
    const cooldownEnd = this.cooldownMap.get(issueId);
    if (!cooldownEnd) return false;
    
    if (Date.now() >= cooldownEnd) {
      this.cooldownMap.delete(issueId);
      return false;
    }
    
    return true;
  }

  /**
   * Get remaining cooldown time
   */
  private getCooldownRemaining(issueId: string): number {
    const cooldownEnd = this.cooldownMap.get(issueId);
    if (!cooldownEnd) return 0;
    return Math.max(0, cooldownEnd - Date.now());
  }

  /**
   * Get current resource state
   */
  getState(): ResourceState {
    return {
      active: this.activeAgents.size,
      total: this.totalAgents,
      queueLength: this.waitQueue.length,
      utilizationPercent: (this.activeAgents.size / this.maxConcurrent) * 100,
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): ResourceMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if a specific issue is active
   */
  isActive(issueId: string): boolean {
    return this.activeAgents.has(issueId);
  }

  /**
   * Get active issue IDs
   */
  getActiveIssues(): string[] {
    return Array.from(this.activeAgents);
  }

  /**
   * Get queue position for an issue
   */
  getQueuePosition(issueId: string): number {
    return this.waitQueue.findIndex(e => e.issueId === issueId);
  }

  /**
   * Force release all resources
   */
  forceReleaseAll(): void {
    const issues = Array.from(this.activeAgents);
    for (const issueId of issues) {
      this.release(issueId);
    }
  }

  /**
   * Cleanup expired cooldowns
   */
  cleanupCooldowns(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [issueId, cooldownEnd] of this.cooldownMap) {
      if (now >= cooldownEnd) {
        this.cooldownMap.delete(issueId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Destroy the resource manager
   */
  destroy(): void {
    // Reject all waiting entries
    for (const entry of this.waitQueue) {
      entry.reject(new Error('Resource manager destroyed'));
    }
    this.waitQueue = [];

    this.activeAgents.clear();
    this.cooldownMap.clear();
    this.removeAllListeners();
  }
}

export const optimizedResourceManager = new OptimizedResourceManager();