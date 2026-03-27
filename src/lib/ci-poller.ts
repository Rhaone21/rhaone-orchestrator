/**
 * Rhaone Orchestrator - Optimized CI Status Poller
 * Performance-optimized polling with caching and intelligent backoff
 */

import { EventEmitter } from 'events';
import { GitHubIntegration, CIStatus, WorkflowRun } from './github';
import { Session, SessionManager } from './session-manager';
import { OptimizedCache, debounce } from './performance-optimizer';
import { ErrorHandler, ErrorContext } from './error-handler';

export type CIEventType =
  | 'ci.pending'
  | 'ci.running'
  | 'ci.passed'
  | 'ci.failed'
  | 'ci.cancelled'
  | 'ci.error';

export interface CIEvent {
  type: CIEventType;
  sessionId: string;
  prNumber?: number;
  branch: string;
  status: CIStatus;
  workflowRun?: WorkflowRun;
  timestamp: Date;
}

export interface OptimizedCIPollerConfig {
  sessionManager: SessionManager;
  github: GitHubIntegration;
  pollInterval?: number;
  cacheTTL?: number;
  adaptivePolling?: boolean;
  minPollInterval?: number;
  maxPollInterval?: number;
  errorHandler?: ErrorHandler;
}

/**
 * Optimized CI Poller - with caching, adaptive polling, and error recovery
 */
export class OptimizedCIPoller extends EventEmitter {
  private sessionManager: SessionManager;
  private github: GitHubIntegration;
  private errorHandler: ErrorHandler;
  private basePollInterval: number;
  private cache: OptimizedCache<CIStatus>;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private pollIntervals: Map<string, number> = new Map();
  private lastStatus: Map<string, CIStatus> = new Map();
  private consecutiveErrors: Map<string, number> = new Map();
  private adaptivePolling: boolean;
  private minPollInterval: number;
  private maxPollInterval: number;
  private isRunning = false;

  constructor(config: OptimizedCIPollerConfig) {
    super();
    this.sessionManager = config.sessionManager;
    this.github = config.github;
    this.errorHandler = config.errorHandler || new ErrorHandler();
    this.basePollInterval = config.pollInterval || 30000;
    this.adaptivePolling = config.adaptivePolling ?? true;
    this.minPollInterval = config.minPollInterval || 10000;  // 10s minimum
    this.maxPollInterval = config.maxPollInterval || 300000; // 5m maximum

    // Initialize cache with 30 second TTL
    this.cache = new OptimizedCache<CIStatus>({
      defaultTTL: config.cacheTTL || 30000,
      maxSize: 1000,
    });
  }

  /**
   * Start polling for a specific session
   */
  startPolling(sessionId: string): void {
    if (this.pollTimers.has(sessionId)) {
      console.log(`[CIPoller] Already polling session ${sessionId}`);
      return;
    }

    const session = this.sessionManager.get(sessionId);
    if (!session || !session.pr?.number) {
      console.log(`[CIPoller] Session ${sessionId} has no PR, skipping poll`);
      return;
    }

    console.log(`[CIPoller] Starting CI polling for session ${sessionId}`);

    // Initial poll
    this.pollSession(sessionId);

    // Set up adaptive polling
    this.setupPolling(sessionId);

    this.isRunning = true;
  }

  /**
   * Setup polling with adaptive interval
   */
  private setupPolling(sessionId: string): void {
    const interval = this.calculatePollInterval(sessionId);
    this.pollIntervals.set(sessionId, interval);

    const timer = setInterval(() => {
      this.pollSession(sessionId);
    }, interval);

    this.pollTimers.set(sessionId, timer);
  }

  /**
   * Calculate adaptive poll interval based on CI state
   */
  private calculatePollInterval(sessionId: string): number {
    if (!this.adaptivePolling) {
      return this.basePollInterval;
    }

    const session = this.sessionManager.get(sessionId);
    if (!session) return this.basePollInterval;

    const lastStatus = this.lastStatus.get(sessionId);
    const errors = this.consecutiveErrors.get(sessionId) || 0;

    // Increase interval on errors
    if (errors > 0) {
      const backoff = Math.min(Math.pow(2, errors) * 1000, this.maxPollInterval);
      return Math.max(backoff, this.minPollInterval);
    }

    // Adjust based on CI state
    if (!lastStatus) {
      return this.minPollInterval; // Poll faster initially
    }

    switch (lastStatus.state) {
      case 'pending':
        // CI hasn't started yet - poll slower
        return Math.min(this.basePollInterval * 2, this.maxPollInterval);
      case 'success':
      case 'failure':
      case 'cancelled':
        // CI completed - can poll slower
        return this.maxPollInterval;
      default:
        // CI running - poll at base interval
        return this.basePollInterval;
    }
  }

  /**
   * Update poll interval dynamically
   */
  private updatePollInterval(sessionId: string): void {
    const currentTimer = this.pollTimers.get(sessionId);
    if (!currentTimer) return;

    const newInterval = this.calculatePollInterval(sessionId);
    const currentInterval = this.pollIntervals.get(sessionId);

    if (newInterval !== currentInterval) {
      // Clear and restart with new interval
      clearInterval(currentTimer);
      this.pollIntervals.set(sessionId, newInterval);

      const timer = setInterval(() => {
        this.pollSession(sessionId);
      }, newInterval);

      this.pollTimers.set(sessionId, timer);
      console.log(`[CIPoller] Updated poll interval for ${sessionId}: ${newInterval}ms`);
    }
  }

  /**
   * Stop polling for a specific session
   */
  stopPolling(sessionId: string): void {
    const timer = this.pollTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(sessionId);
      this.pollIntervals.delete(sessionId);
      this.consecutiveErrors.delete(sessionId);
      console.log(`[CIPoller] Stopped polling for session ${sessionId}`);
    }
  }

  /**
   * Stop all polling
   */
  stopAll(): void {
    for (const [sessionId] of this.pollTimers) {
      this.stopPolling(sessionId);
    }
    this.isRunning = false;
    this.cache.clear();
  }

  /**
   * Poll CI status for a session
   */
  async pollSession(sessionId: string): Promise<CIStatus | null> {
    const session = this.sessionManager.get(sessionId);
    if (!session || !session.pr?.number) {
      return null;
    }

    const cacheKey = `ci:${session.pr.number}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.emit('cached', { sessionId, status: cached });
      return cached;
    }

    try {
      const status = await this.errorHandler.handle(
        () => this.github.getCIStatus(session.pr!.number),
        { operation: 'pollCI', sessionId, issueId: session.issueId }
      );

      // Reset error count on success
      this.consecutiveErrors.set(sessionId, 0);

      // Cache the result
      this.cache.set(cacheKey, status);

      // Check for status changes
      const previousStatus = this.lastStatus.get(sessionId);
      if (previousStatus && previousStatus.state !== status.state) {
        const event = this.createEvent(sessionId, session, status);
        this.emit('statusChange', event);
      }

      this.lastStatus.set(sessionId, status);

      // Update polling interval based on new state
      if (this.adaptivePolling) {
        this.updatePollInterval(sessionId);
      }

      return status;
    } catch (error) {
      // Increment error count
      const errors = (this.consecutiveErrors.get(sessionId) || 0) + 1;
      this.consecutiveErrors.set(sessionId, errors);

      console.error(`[CIPoller] Failed to poll CI for session ${sessionId}:`, error);

      // Update interval on error
      if (this.adaptivePolling) {
        this.updatePollInterval(sessionId);
      }

      return null;
    }
  }

  /**
   * Poll all active sessions with PRs
   */
  async pollAll(): Promise<void> {
    const sessions = this.sessionManager.list().filter(
      s => s.status === 'working' && s.pr?.number
    );

    // Batch poll with concurrency limit
    const batchSize = 5;
    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);
      await Promise.all(
        batch.map(s => this.pollSession(s.id).catch(err => {
          console.error(`[CIPoller] Batch poll failed for ${s.id}:`, err);
        }))
      );
    }
  }

  /**
   * Get current CI status for a session (cached)
   */
  getStatus(sessionId: string): CIStatus | null {
    const session = this.sessionManager.get(sessionId);
    if (!session?.pr?.number) return null;

    const cacheKey = `ci:${session.pr.number}`;
    return this.cache.get(cacheKey) || this.lastStatus.get(sessionId) || null;
  }

  /**
   * Force refresh CI status (bypasses cache)
   */
  async forceRefresh(sessionId: string): Promise<CIStatus | null> {
    const session = this.sessionManager.get(sessionId);
    if (!session?.pr?.number) return null;

    const cacheKey = `ci:${session.pr.number}`;
    this.cache.delete(cacheKey);

    return this.pollSession(sessionId);
  }

  /**
   * Get polling status
   */
  getPollingStatus(): { sessionId: string; active: boolean; interval: number }[] {
    return Array.from(this.pollTimers.keys()).map(id => ({
      sessionId: id,
      active: true,
      interval: this.pollIntervals.get(id) || this.basePollInterval,
    }));
  }

  /**
   * Get performance metrics
   */
  getMetrics(): {
    activePolls: number;
    cacheMetrics: ReturnType<OptimizedCache<CIStatus>['getMetrics']>;
    errorCounts: Record<string, number>;
  } {
    const errorCounts: Record<string, number> = {};
    for (const [sessionId, count] of this.consecutiveErrors) {
      errorCounts[sessionId] = count;
    }

    return {
      activePolls: this.pollTimers.size,
      cacheMetrics: this.cache.getMetrics(),
      errorCounts,
    };
  }

  private createEvent(
    sessionId: string,
    session: Session,
    status: CIStatus
  ): CIEvent {
    let type: CIEventType;

    switch (status.state) {
      case 'success':
        type = 'ci.passed';
        break;
      case 'failure':
        type = 'ci.failed';
        break;
      case 'cancelled':
        type = 'ci.cancelled';
        break;
      case 'error':
        type = 'ci.error';
        break;
      case 'pending':
      default:
        const previous = this.lastStatus.get(sessionId);
        if (previous?.state === 'pending') {
          type = 'ci.running';
        } else {
          type = 'ci.pending';
        }
        break;
    }

    return {
      type,
      sessionId,
      prNumber: session.pr?.number,
      branch: session.branch,
      status,
      timestamp: new Date(),
    };
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.stopAll();
    this.cache.destroy();
    this.removeAllListeners();
  }
}
