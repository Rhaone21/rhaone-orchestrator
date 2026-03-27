/**
 * Rhaone Orchestrator - Session Manager
 * Wrapper for sessions_spawn with metadata tracking and error handling
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import { LearningEngine } from '../learning';
import { MetricsCollector } from '../learning/metrics-collector';
import { PatternAnalyzer } from '../learning/patterns';
import { 
  withErrorHandling, 
  withRetry, 
  withGracefulDegradation,
  withCircuitBreaker,
  errorHandler,
  CIRCUIT_BREAKERS,
  RETRY_CONFIGS,
  handleSessionSpawn,
  recoverSessionSpawn,
  type ErrorContext,
} from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface SessionLineage {
  parentTaskId: string;         // ID dari DecomposedTask (format: task-{issueId}-{hash})
  parentSessionId?: string;     // Session yang trigger decompose (opsional)
  subtaskId: string;            // ID subtask yang di-handle session ini
  subtaskTitle: string;         // Title subtask (untuk display)
  decompositionLevel: number;   // 0 = root/parent, 1 = subtask langsung
  subtaskType: string;          // 'code' | 'test' | 'docs' | 'refactor' | 'config' | 'research'
}

export interface SpawnConfig {
  projectId: string;
  issueId?: string;
  task: string;
  agent?: string;
  model?: string;
  branch?: string;
  workdir?: string;
  worktreePath?: string;
  lineage?: SessionLineage;
}

export type SessionStatus = 'pending' | 'working' | 'waiting_pr' | 'completed' | 'errored' | 'killed' | 'merged';

export interface Session {
  id: string;
  projectId: string;
  issueId: string;
  branch: string;
  status: SessionStatus;
  openclawSessionId?: string;
  pr?: {
    number: number;
    url: string;
    state: string;
  };
  createdAt: string;
  scheduledAt?: string;
  lastActivityAt: string;
  metrics: {
    spawnDuration: number;
    prOpenDuration?: number;
    ciPasses: number;
    ciFailures: number;
  };
  error?: string;
  metadata?: {
    ciRetries?: number;
    lastReview?: {
      id: number;
      author: string;
      state: string;
      body: string;
      submittedAt: string;
    };
    [key: string]: any;
  };
  lineage?: SessionLineage;
}

export interface SessionManagerOptions {
  dataDir?: string;
}

/**
 * Session Manager - handles spawning and tracking Rhaone sessions
 */
export class SessionManager {
  private dataDir: string;
  private sessions: Map<string, Session> = new Map();
  private sessionCache: LRUCache<string, Session>;
  private branchNameCache: LRUCache<string, string>;
  private learning: LearningEngine;
  private metrics: MetricsCollector;
  private patternAnalyzer: PatternAnalyzer;

  constructor(options: SessionManagerOptions = {}) {
    this.dataDir = options.dataDir || join(homedir(), '.rhaone-orchestrator', 'projects');

    // Initialize LRU caches for performance
    this.sessionCache = new LRUCache<string, Session>({
      maxSize: 1000,
      ttlMs: 5 * 60 * 1000, // 5 minutes TTL
    });

    this.branchNameCache = new LRUCache<string, string>({
      maxSize: 500,
      ttlMs: 60 * 60 * 1000, // 1 hour TTL - branch names don't change
    });

    // Initialize learning & metrics tracking
    this.learning = new LearningEngine();
    this.metrics = new MetricsCollector();
    this.patternAnalyzer = new PatternAnalyzer();

    this.loadAllSessions();
  }

  /**
   * Generate a unique session ID from project + issue
   */
  generateSessionId(projectId: string, issueId: string): string {
    const random = randomBytes(4).toString('hex'); // 8 hex chars = 32 bits of entropy
    const cleanIssueId = issueId ? issueId.replace(/[^a-zA-Z0-9]/g, '') : 'unknown';
    return `${projectId}-${cleanIssueId}-${random}`;
  }

  /**
   * Generate branch name from issue - with memoization
   */
  generateBranchName(issueId: string): string {
    // Check cache first
    const cached = this.branchNameCache.get(issueId);
    if (cached) return cached;

    const clean = issueId
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')  // Normalize multiple dashes to single dash
      .replace(/^-|-$/g, '')  // Remove leading/trailing dashes
      .toLowerCase();
    const branch = `feat/${clean}-auto`;
    
    // Cache the result
    this.branchNameCache.set(issueId, branch);
    return branch;
  }

  /**
   * Get sessions directory for a project
   */
  private getProjectSessionsDir(projectId: string): string {
    const dir = join(this.dataDir, projectId, 'sessions');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Load all session metadata from disk
   */
  private loadAllSessions(): void {
    if (!existsSync(this.dataDir)) return;

    const projects = readdirSync(this.dataDir);
    for (const projectId of projects) {
      const sessionsDir = join(this.dataDir, projectId, 'sessions');
      if (!existsSync(sessionsDir)) continue;

      const files = readdirSync(sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const session: Session = JSON.parse(
            readFileSync(join(sessionsDir, file), 'utf-8')
          );
          this.sessions.set(session.id, session);
        } catch (e) {
          console.error(`[SessionManager] Failed to load session ${file}:`, e);
        }
      }
    }
    console.log(`[SessionManager] Loaded ${this.sessions.size} sessions`);
  }

  /**
   * Save session to disk
   */
  private saveSession(session: Session): void {
    const sessionsDir = this.getProjectSessionsDir(session.projectId);
    const filePath = join(sessionsDir, `${session.id}.json`);
    writeFileSync(filePath, JSON.stringify(session, null, 2));
    
    // Update cache
    this.sessionCache.set(session.id, session);
  }

  /**
   * Create a new session (without spawning)
   */
  async create(config: SpawnConfig): Promise<Session> {
    const sessionId = this.generateSessionId(config.projectId, config.issueId ?? '');
    const branch = config.branch || this.generateBranchName(config.issueId ?? '');
    const now = new Date().toISOString();

    const session: Session = {
      id: sessionId,
      projectId: config.projectId,
      issueId: config.issueId ?? '',
      branch,
      status: 'pending',
      createdAt: now,
      lastActivityAt: now,
      metrics: {
        spawnDuration: 0,
        ciPasses: 0,
        ciFailures: 0,
      },
      ...(config.lineage && { lineage: config.lineage }),
    };

    this.sessions.set(sessionId, session);
    this.saveSession(session);

    console.log(`[SessionManager] Created session ${sessionId} for ${config.issueId}`);
    return session;
  }

  /**
   * Spawn an agent session via OpenClaw sessions_spawn with comprehensive error handling
   */
  async spawn(config: SpawnConfig): Promise<Session> {
    const startTime = Date.now();
    const session = await this.create(config);

    const spawnOperation = async (): Promise<Session> => {
      // Build the task prompt with context
      const fullTask = this.buildTaskPrompt(config);

      // Spawn using OpenClaw's sessions_spawn with retry logic
      const spawnResult = await withRetry(
        async () => {
          return await this.callSessionsSpawn({
            agent: config.agent || 'kimi',
            task: fullTask,
            workdir: config.workdir,
            env: {
              GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
              RHAONE_SESSION_ID: session.id,
              RHAONE_PROJECT_ID: config.projectId,
              RHAONE_ISSUE_ID: config.issueId ?? '',
            },
            model: config.model,
          });
        },
        {
          operationName: 'sessions_spawn',
          ...RETRY_CONFIGS.SESSION_SPAWN,
        }
      )();

      // Update session with OpenClaw session ID
      session.openclawSessionId = spawnResult.sessionId;
      session.status = 'working';
      session.lastActivityAt = new Date().toISOString();
      session.metrics.spawnDuration = Date.now() - startTime;

      this.sessions.set(session.id, session);
      this.saveSession(session);

      // Start metrics tracking
      this.metrics.startSession({
        sessionId: session.id,
        projectId: session.projectId,
        agentType: config.agent ?? 'kimi',
        model: config.model,
        taskType: this.patternAnalyzer.classifyTask(config.task),
        issueId: session.issueId || undefined,
      });
      this.metrics.updateSession(session.id, {
        status: 'working',
        spawnDuration: session.metrics.spawnDuration,
      });

      console.log(`[SessionManager] Spawned session ${session.id} -> ${spawnResult.sessionId}`);
      return session;
    };

    try {
      // Use circuit breaker protection
      const cb = errorHandler.getCircuitBreaker(CIRCUIT_BREAKERS.SESSION_SPAWN);
      return await cb.execute(spawnOperation);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      console.error(`[SessionManager] Spawn failed for ${session.id}:`, err.message);
      
      // Attempt recovery
      const recovered = await recoverSessionSpawn(session.id, async () => {
        await spawnOperation();
      });

      if (!recovered) {
        // Mark session as errored
        session.status = 'errored';
        session.error = `Spawn failed: ${err.message}`;
        session.lastActivityAt = new Date().toISOString();
        this.sessions.set(session.id, session);
        this.saveSession(session);
      }

      return session;
    }
  }

  /**
   * Build the task prompt for the agent
   */
  private buildTaskPrompt(config: SpawnConfig): string {
    return `# Task: ${config.issueId}

## Project: ${config.projectId}

## Issue: ${config.issueId}

## Your Task:
${config.task}

## Branch
Create and work on branch: \`${config.branch || this.generateBranchName(config.issueId ?? '')}\`

## Guidelines
1. Make focused, minimal changes to fix the issue
2. Write or update tests as needed
3. When ready, create a PR with description
4. Keep PR small and focused

## Session ID (for tracking)
${config.projectId}-session-${this.generateSessionId(config.projectId, config.issueId ?? '')}
`;
  }

  /**
   * Call sessions_spawn - this is the OpenClaw integration point
   * Wrapped with comprehensive error handling
   */
  private async callSessionsSpawn(params: {
    agent: string;
    task: string;
    workdir?: string;
    env?: Record<string, string>;
    model?: string;
  }): Promise<{ sessionId: string; success: boolean }> {
    // In production, this calls the actual sessions_spawn tool
    // For now, simulate the call structure
    console.log(`[SessionManager] Would spawn: agent=${params.agent}, model=${params.model || 'default'}`);
    
    // Simulate potential failures for testing
    if (Math.random() < 0.01) { // 1% failure rate for testing
      throw new Error('Simulated spawn failure: timeout');
    }
    
    // Return simulated result - in production this would be the actual tool call
    return {
      sessionId: `agent:${params.agent}:session:${Date.now()}`,
      success: true,
    };
  }

  /**
   * Get session by ID - with LRU cache
   */
  get(sessionId: string): Session | null {
    // Check LRU cache first
    const cached = this.sessionCache.get(sessionId);
    if (cached) return cached;
    
    // Fall back to main storage
    const session = this.sessions.get(sessionId);
    if (session) {
      // Populate cache
      this.sessionCache.set(sessionId, session);
    }
    return session || null;
  }

  /**
   * List sessions, optionally filtered by project
   */
  list(projectId?: string): Session[] {
    const all = Array.from(this.sessions.values());
    if (!projectId) return all;
    return all.filter(s => s.projectId === projectId);
  }

  /**
   * Get active sessions (working, waiting_pr, pending)
   */
  listActive(projectId?: string): Session[] {
    return this.list(projectId).filter(s => 
      ['pending', 'working', 'waiting_pr'].includes(s.status)
    );
  }

  /**
   * Update session status
   */
  async updateStatus(sessionId: string, status: Session['status'], extra?: Partial<Session>): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = status;
    session.lastActivityAt = new Date().toISOString();
    if (extra) {
      Object.assign(session, extra);
    }

    this.sessions.set(sessionId, session);
    this.saveSession(session);

    // Sync status to metrics tracker
    const statusMap: Record<string, string> = {
      working: 'working',
      waiting_pr: 'pr_open',
      completed: 'completed',
      errored: 'errored',
      killed: 'killed',
    };
    const metricsStatus = statusMap[status] as any;
    if (metricsStatus) {
      this.metrics.updateSession(sessionId, { status: metricsStatus });
    }

    console.log(`[SessionManager] Updated session ${sessionId} status to ${status}`);
    return session;
  }

  /**
   * Send message to a running session with error handling
   */
  async send(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.openclawSessionId) {
      throw new Error(`Session ${sessionId} not found or not running`);
    }

    return withRetry(
      async () => {
        console.log(`[SessionManager] Sending to ${session.openclawSessionId}: ${message}`);
        // In production: await sessions_send({ sessionKey: session.openclawSessionId, message });
      },
      {
        operationName: 'session-send',
        maxRetries: 2,
        backoffMs: 500,
        retryableErrors: ['timeout', 'ECONNRESET'],
      }
    )();
  }

  /**
   * List all sessions (optional filter by status)
   */
  async listSessions(filter?: { status?: Session['status'] }): Promise<Session[]> {
    const sessions = Array.from(this.sessions.values());
    
    if (filter?.status) {
      return sessions.filter(s => s.status === filter.status);
    }
    
    return sessions;
  }

  /**
   * Create a new session (alias for spawn)
   */
  async createSession(config: SpawnConfig): Promise<Session> {
    return this.spawn(config);
  }

  /**
   * Schedule a session for future execution with error handling
   */
  async scheduleSession(config: SpawnConfig, scheduledAt: Date): Promise<string> {
    return withGracefulDegradation(
      async () => {
        const sessionId = `scheduled-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const session: Session = {
          id: sessionId,
          projectId: config.projectId,
          issueId: config.issueId ?? '',
          branch: config.branch || this.generateBranchName(config.issueId ?? ''),
          status: 'pending',
          createdAt: new Date().toISOString(),
          scheduledAt: scheduledAt.toISOString(),
          lastActivityAt: new Date().toISOString(),
          openclawSessionId: undefined,
          metadata: {},
          metrics: {
            spawnDuration: 0,
            ciPasses: 0,
            ciFailures: 0,
          },
        };
        
        this.sessions.set(sessionId, session);
        this.saveSession(session);
        
        // In production: would use a scheduler to trigger spawn at scheduledAt
        console.log(`[SessionManager] Scheduled session ${sessionId} for ${scheduledAt.toISOString()}`);
        
        return sessionId;
      },
      '', // Fallback returns empty string
      { operationName: 'schedule-session' }
    );
  }

  /**
   * Kill a session
   */
  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = 'killed';
    session.lastActivityAt = new Date().toISOString();
    this.sessions.set(sessionId, session);
    this.saveSession(session);

    // Record killed session into learning engine
    const finalMetrics = this.metrics.completeSession(sessionId, false, 'killed');
    if (finalMetrics) {
      this.learning.recordSession(finalMetrics);
    }

    console.log(`[SessionManager] Killed session ${sessionId}`);
    // In production: would terminate the OpenClaw session
  }

  /**
   * Mark session as completed
   */
  /**
   * Get agent performance insights for the last N days
   */
  getInsights(days = 7) {
    return this.learning.getInsightsReport(days);
  }

  /**
   * Get recommendation for a task
   */
  getRecommendation(taskDescription: string) {
    const taskType = this.patternAnalyzer.classifyTask(taskDescription);
    return this.learning.getRecommendation(taskType);
  }

  async complete(sessionId: string, prInfo?: { number: number; url: string }): Promise<Session | null> {
    const result = await this.updateStatus(sessionId, 'completed', {
      pr: prInfo ? { number: prInfo.number, url: prInfo.url, state: 'open' } : undefined,
    });

    // Record into learning engine
    const finalMetrics = this.metrics.completeSession(sessionId, true);
    if (finalMetrics) {
      this.learning.recordSession(finalMetrics);
    }

    return result;
  }
}

export const sessionManager = new SessionManager();