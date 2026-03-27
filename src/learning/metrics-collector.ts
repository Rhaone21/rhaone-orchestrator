/**
 * Metrics Collector
 * Collects and stores session performance metrics
 */

import { SessionMetrics, SessionStatus } from './types';
import { LearningStorage } from './storage';

export interface MetricsCollectorConfig {
  storage: LearningStorage;
  enabled: boolean;
}

export interface SessionStartData {
  sessionId: string;
  projectId: string;
  agentType: string;
  model?: string;
  taskType: string;
  issueId?: string;
}

export interface SessionUpdateData {
  status?: SessionStatus;
  spawnDuration?: number;
  timeToPR?: number;
  timeToMerge?: number;
  ciPasses?: number;
  ciFailures?: number;
  ciRetries?: number;
  linesAdded?: number;
  linesRemoved?: number;
  filesModified?: number;
  reviewRounds?: number;
  success?: boolean;
  failureReason?: string;
}

/**
 * MetricsCollector - Handles collection and storage of session metrics
 */
export class MetricsCollector {
  private storage: LearningStorage;
  private enabled: boolean;
  private activeSessions: Map<string, SessionMetrics> = new Map();

  constructor(config: Partial<MetricsCollectorConfig> = {}) {
    this.storage = config.storage || new LearningStorage();
    this.enabled = config.enabled !== false;
  }

  /**
   * Start tracking a new session
   */
  startSession(data: SessionStartData): SessionMetrics {
    if (!this.enabled) {
      return this.createEmptyMetrics(data.sessionId);
    }

    const metrics: SessionMetrics = {
      sessionId: data.sessionId,
      projectId: data.projectId,
      agentType: data.agentType,
      model: data.model,
      taskType: data.taskType,
      issueId: data.issueId,
      spawnDuration: 0,
      ciPasses: 0,
      ciFailures: 0,
      ciRetries: 0,
      linesAdded: 0,
      linesRemoved: 0,
      filesModified: 0,
      reviewRounds: 0,
      success: false,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.activeSessions.set(data.sessionId, metrics);
    this.storage.addMetric(metrics);

    console.log(`[MetricsCollector] Started tracking session ${data.sessionId}`);
    return metrics;
  }

  /**
   * Update session metrics
   */
  updateSession(sessionId: string, data: SessionUpdateData): SessionMetrics | null {
    if (!this.enabled) return null;

    let metrics: SessionMetrics | null = this.activeSessions.get(sessionId) ?? null;
    
    if (!metrics) {
      // Try to load from storage
      const allMetrics = this.storage.loadMetrics();
      metrics = allMetrics.find(m => m.sessionId === sessionId) ?? null;
      if (!metrics) {
        console.warn(`[MetricsCollector] Session ${sessionId} not found`);
        return null;
      }
      this.activeSessions.set(sessionId, metrics);
    }

    // Update fields
    if (data.status !== undefined) metrics.status = data.status;
    if (data.spawnDuration !== undefined) metrics.spawnDuration = data.spawnDuration;
    if (data.timeToPR !== undefined) metrics.timeToPR = data.timeToPR;
    if (data.timeToMerge !== undefined) metrics.timeToMerge = data.timeToMerge;
    if (data.ciPasses !== undefined) metrics.ciPasses = data.ciPasses;
    if (data.ciFailures !== undefined) metrics.ciFailures = data.ciFailures;
    if (data.ciRetries !== undefined) metrics.ciRetries = data.ciRetries;
    if (data.linesAdded !== undefined) metrics.linesAdded = data.linesAdded;
    if (data.linesRemoved !== undefined) metrics.linesRemoved = data.linesRemoved;
    if (data.filesModified !== undefined) metrics.filesModified = data.filesModified;
    if (data.reviewRounds !== undefined) metrics.reviewRounds = data.reviewRounds;
    if (data.success !== undefined) metrics.success = data.success;
    if (data.failureReason !== undefined) metrics.failureReason = data.failureReason;

    // Save to storage
    this.storage.addMetric(metrics);

    console.log(`[MetricsCollector] Updated session ${sessionId}: ${data.status || 'metrics update'}`);
    return metrics;
  }

  /**
   * Mark session as completed
   */
  completeSession(sessionId: string, success: boolean, failureReason?: string): SessionMetrics | null {
    const metrics = this.updateSession(sessionId, {
      status: success ? 'completed' : 'errored',
      success,
      failureReason,
    });

    if (metrics) {
      metrics.completedAt = new Date().toISOString();
      this.storage.addMetric(metrics);
      this.activeSessions.delete(sessionId);
      console.log(`[MetricsCollector] Completed session ${sessionId}: ${success ? 'SUCCESS' : 'FAILED'}`);
    }

    return metrics;
  }

  /**
   * Record CI event
   */
  recordCIEvent(sessionId: string, passed: boolean, retryCount: number = 0): SessionMetrics | null {
    const metrics = this.activeSessions.get(sessionId);
    if (!metrics) {
      console.warn(`[MetricsCollector] Cannot record CI event - session ${sessionId} not found`);
      return null;
    }

    if (passed) {
      metrics.ciPasses++;
    } else {
      metrics.ciFailures++;
    }
    metrics.ciRetries = retryCount;

    this.storage.addMetric(metrics);
    return metrics;
  }

  /**
   * Record code changes
   */
  recordCodeChanges(
    sessionId: string,
    linesAdded: number,
    linesRemoved: number,
    filesModified: number
  ): SessionMetrics | null {
    return this.updateSession(sessionId, {
      linesAdded,
      linesRemoved,
      filesModified,
    });
  }

  /**
   * Record PR opened
   */
  recordPROpened(sessionId: string, timeToPRMinutes: number): SessionMetrics | null {
    return this.updateSession(sessionId, {
      status: 'pr_open',
      timeToPR: timeToPRMinutes,
    });
  }

  /**
   * Record review received
   */
  recordReview(sessionId: string, round: number): SessionMetrics | null {
    return this.updateSession(sessionId, {
      status: 'reviewing',
      reviewRounds: round,
    });
  }

  /**
   * Get active session metrics
   */
  getActiveSession(sessionId: string): SessionMetrics | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAllActiveSessions(): SessionMetrics[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Load metrics from storage
   */
  loadMetrics(): SessionMetrics[] {
    return this.storage.loadMetrics();
  }

  /**
   * Get metrics for a specific session
   */
  getSessionMetrics(sessionId: string): SessionMetrics | null {
    // Check active sessions first
    const active = this.activeSessions.get(sessionId);
    if (active) return active;

    // Load from storage
    const allMetrics = this.storage.loadMetrics();
    return allMetrics.find(m => m.sessionId === sessionId) || null;
  }

  /**
   * Enable/disable collection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if collector is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Clear all active sessions (use with caution)
   */
  clearActiveSessions(): void {
    this.activeSessions.clear();
  }

  private createEmptyMetrics(sessionId: string): SessionMetrics {
    return {
      sessionId,
      projectId: '',
      agentType: '',
      taskType: '',
      spawnDuration: 0,
      ciPasses: 0,
      ciFailures: 0,
      ciRetries: 0,
      linesAdded: 0,
      linesRemoved: 0,
      filesModified: 0,
      reviewRounds: 0,
      success: false,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }
}

// Export singleton instance
export const metricsCollector = new MetricsCollector();

// Factory function
export function createMetricsCollector(config?: Partial<MetricsCollectorConfig>): MetricsCollector {
  return new MetricsCollector(config);
}
