/**
 * Rhaone Orchestrator - Optimized Session Manager
 * High-performance session management with WAL pattern, caching, and async I/O
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { writeFile, readFile, access, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export interface SpawnConfig {
  projectId: string;
  issueId: string;
  task: string;
  agent?: string;
  model?: string;
  branch?: string;
  workdir?: string;
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
  lastActivityAt: string;
  metrics: {
    spawnDuration: number;
    prOpenDuration?: number;
    ciPasses: number;
    ciFailures: number;
  };
  error?: string;
  metadata?: Record<string, any>;
}

export interface SessionManagerOptions {
  dataDir?: string;
  walFlushIntervalMs?: number;
  walMaxBufferSize?: number;
}

interface WALEntry {
  type: 'create' | 'update' | 'delete';
  sessionId: string;
  data?: Partial<Session>;
  timestamp: number;
}

export class OptimizedSessionManager extends EventEmitter {
  private dataDir: string;
  private sessions: Map<string, Session> = new Map();
  private walBuffer: WALEntry[] = [];
  private walFlushInterval: NodeJS.Timeout | null = null;
  private walFlushThreshold: number;
  private walFlushIntervalMs: number;
  private branchNameCache: Map<string, string> = new Map();
  private sessionIdCache: Map<string, string> = new Map();
  private initialized = false;
  private loadingPromise: Promise<void> | null = null;
  private pendingFlush: Promise<void> | null = null;

  constructor(options: SessionManagerOptions = {}) {
    super();
    this.dataDir = options.dataDir || join(homedir(), '.rhaone-orchestrator', 'projects');
    this.walFlushThreshold = options.walMaxBufferSize || 100;
    this.walFlushIntervalMs = options.walFlushIntervalMs || 5000;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this.doInitialize();
    return this.loadingPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      await this.loadAllSessions();
      this.startWALFlush();
      this.initialized = true;
      console.log(`[OptimizedSessionManager] Initialized with ${this.sessions.size} sessions`);
    } catch (error) {
      console.error('[OptimizedSessionManager] Initialization failed:', error);
      throw error;
    }
  }

  generateSessionId(projectId: string, issueId: string): string {
    const cacheKey = `${projectId}:${issueId}`;
    const cached = this.sessionIdCache.get(cacheKey);
    if (cached) return cached;

    const timestamp = Date.now().toString(36).slice(-4);
    const id = `${projectId}-${issueId.replace(/[^a-zA-Z0-9]/g, '')}-${timestamp}`;
    this.sessionIdCache.set(cacheKey, id);
    return id;
  }

  generateBranchName(issueId: string): string {
    const cached = this.branchNameCache.get(issueId);
    if (cached) return cached;

    const clean = issueId
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 50);
    
    const branch = `feat/${clean}-auto`;
    this.branchNameCache.set(issueId, branch);
    return branch;
  }

  private getProjectSessionsDir(projectId: string): string {
    return join(this.dataDir, projectId, 'sessions');
  }

  private async loadAllSessions(): Promise<void> {
    try {
      await access(this.dataDir);
    } catch {
      return;
    }

    const projects = await this.listDirectories(this.dataDir);
    const loadPromises = projects.map(p => this.loadProjectSessions(p));
    await Promise.all(loadPromises);
  }

  private async listDirectories(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      return [];
    }
  }

  private async loadProjectSessions(projectId: string): Promise<void> {
    const sessionsDir = this.getProjectSessionsDir(projectId);
    
    try {
      await access(sessionsDir);
    } catch {
      return;
    }

    const files = await readdir(sessionsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const chunkSize = 50;
    for (let i = 0; i < jsonFiles.length; i += chunkSize) {
      const chunk = jsonFiles.slice(i, i + chunkSize);
      await Promise.all(chunk.map(f => this.loadSessionFile(join(sessionsDir, f))));
    }
  }

  private async loadSessionFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const session: Session = JSON.parse(content);
      this.sessions.set(session.id, session);
    } catch (e) {
      console.error(`[OptimizedSessionManager] Failed to load ${filePath}:`, e);
    }
  }

  private addToWAL(entry: WALEntry): void {
    this.walBuffer.push(entry);
    
    if (this.walBuffer.length >= this.walFlushThreshold) {
      this.flushWAL();
    }
  }

  private startWALFlush(): void {
    if (this.walFlushInterval) return;
    
    this.walFlushInterval = setInterval(() => {
      this.flushWAL().catch(err => {
        console.error('[OptimizedSessionManager] WAL flush error:', err);
      });
    }, this.walFlushIntervalMs);
  }

  private stopWALFlush(): void {
    if (this.walFlushInterval) {
      clearInterval(this.walFlushInterval);
      this.walFlushInterval = null;
    }
  }

  private async flushWAL(): Promise<void> {
    if (this.walBuffer.length === 0) return;
    if (this.pendingFlush) return this.pendingFlush;

    this.pendingFlush = this.doFlushWAL();
    return this.pendingFlush;
  }

  private async doFlushWAL(): Promise<void> {
    try {
      const batch = this.walBuffer.splice(0, this.walBuffer.length);
      
      const byProject = new Map<string, WALEntry[]>();
      for (const entry of batch) {
        const session = this.sessions.get(entry.sessionId);
        if (!session) continue;
        
        const projectId = session.projectId;
        if (!byProject.has(projectId)) {
          byProject.set(projectId, []);
        }
        byProject.get(projectId)!.push(entry);
      }

      const flushPromises: Promise<void>[] = [];
      for (const [projectId, entries] of byProject) {
        flushPromises.push(this.flushProjectWAL(projectId, entries));
      }

      await Promise.all(flushPromises);
    } finally {
      this.pendingFlush = null;
    }
  }

  private async flushProjectWAL(projectId: string, entries: WALEntry[]): Promise<void> {
    const sessionsDir = this.getProjectSessionsDir(projectId);
    
    try {
      await mkdir(sessionsDir, { recursive: true });
    } catch {
      // Directory might already exist
    }

    const writePromises = entries.map(async (entry) => {
      const session = this.sessions.get(entry.sessionId);
      if (!session) return;

      const filePath = join(sessionsDir, `${entry.sessionId}.json`);
      
      if (entry.type === 'delete') {
        try {
          await unlink(filePath);
        } catch {
          // File might not exist
        }
      } else {
        await writeFile(filePath, JSON.stringify(session, null, 2));
      }
    });

    await Promise.all(writePromises);
  }

  async create(config: SpawnConfig): Promise<Session> {
    await this.initialize();
    
    const sessionId = this.generateSessionId(config.projectId, config.issueId);
    const now = new Date().toISOString();
    
    const session: Session = {
      id: sessionId,
      projectId: config.projectId,
      issueId: config.issueId,
      branch: config.branch || this.generateBranchName(config.issueId),
      status: 'pending',
      createdAt: now,
      lastActivityAt: now,
      metrics: {
        spawnDuration: 0,
        ciPasses: 0,
        ciFailures: 0,
      },
    };

    this.sessions.set(sessionId, session);

    this.addToWAL({
      type: 'create',
      sessionId,
      data: session,
      timestamp: Date.now(),
    });

    this.emit('sessionCreated', session);
    return session;
  }

  async spawn(config: SpawnConfig): Promise<Session> {
    const startTime = performance.now();
    const session = await this.create(config);

    try {
      const fullTask = this.buildTaskPrompt(config);

      const spawnResult = await this.callSessionsSpawn({
        agent: config.agent || 'kimi',
        task: fullTask,
        workdir: config.workdir,
        env: {
          GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
          RHAONE_SESSION_ID: session.id,
          RHAONE_PROJECT_ID: config.projectId,
          RHAONE_ISSUE_ID: config.issueId,
        },
        model: config.model,
      });

      const updates: Partial<Session> = {
        openclawSessionId: spawnResult.sessionId,
        status: 'working',
        lastActivityAt: new Date().toISOString(),
        metrics: {
          ...session.metrics,
          spawnDuration: performance.now() - startTime,
        },
      };

      Object.assign(session, updates);
      this.addToWAL({
        type: 'update',
        sessionId: session.id,
        data: updates,
        timestamp: Date.now(),
      });

      this.emit('sessionSpawned', session);
      return session;
    } catch (error) {
      const updates: Partial<Session> = {
        status: 'errored',
        error: error instanceof Error ? error.message : String(error),
        lastActivityAt: new Date().toISOString(),
      };

      Object.assign(session, updates);
      this.addToWAL({
        type: 'update',
        sessionId: session.id,
        data: updates,
        timestamp: Date.now(),
      });

      this.emit('sessionError', session, error);
      throw error;
    }
  }

  private buildTaskPrompt(config: SpawnConfig): string {
    return `# Task: ${config.issueId}\n\n## Project: ${config.projectId}\n\n## Issue: ${config.issueId}\n\n## Your Task:\n${config.task}\n\n## Branch\nCreate and work on branch: \`${config.branch || this.generateBranchName(config.issueId)}\`\n\n## Guidelines\n1. Make focused, minimal changes to fix the issue\n2. Write or update tests as needed\n3. When ready, create a PR with description\n4. Keep PR small and focused\n`;
  }

  private async callSessionsSpawn(params: {
    agent: string;
    task: string;
    workdir?: string;
    env?: Record<string, string>;
    model?: string;
  }): Promise<{ sessionId: string; success: boolean }> {
    return {
      sessionId: `agent:${params.agent}:session:${Date.now()}`,
      success: true,
    };
  }

  get(sessionId: string): Session | null {
    return this.sessions.get(sessionId) || null;
  }

  list(projectId?: string): Session[] {
    const all = Array.from(this.sessions.values());
    if (!projectId) return all;
    return all.filter(s => s.projectId === projectId);
  }

  listActive(projectId?: string): Session[] {
    return this.list(projectId).filter(s => 
      ['pending', 'working', 'waiting_pr'].includes(s.status)
    );
  }

  async updateStatus(
    sessionId: string, 
    status: Session['status'], 
    extra?: Partial<Session>
  ): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const updates: Partial<Session> = {
      status,
      lastActivityAt: new Date().toISOString(),
      ...extra,
    };

    Object.assign(session, updates);
    this.addToWAL({
      type: 'update',
      sessionId,
      data: updates,
      timestamp: Date.now(),
    });

    this.emit('sessionUpdated', session);
    return session;
  }

  async send(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.openclawSessionId) {
      throw new Error(`Session ${sessionId} not found or not running`);
    }
    console.log(`[SessionManager] Would send to ${session.openclawSessionId}: ${message}`);
  }

  async scheduleSession(config: SpawnConfig, scheduledAt: Date): Promise<string> {
    const sessionId = `scheduled-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const session: Session = {
      id: sessionId,
      projectId: config.projectId,
      issueId: config.issueId,
      branch: config.branch || this.generateBranchName(config.issueId),
      status: 'pending',
      createdAt: now,
      lastActivityAt: now,
      metrics: {
        spawnDuration: 0,
        ciPasses: 0,
        ciFailures: 0,
      },
      metadata: {
        scheduledAt: scheduledAt.toISOString(),
      },
    };

    this.sessions.set(sessionId, session);

    this.addToWAL({
      type: 'create',
      sessionId,
      data: session,
      timestamp: Date.now(),
    });

    return sessionId;
  }

  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updates: Partial<Session> = {
      status: 'killed',
      lastActivityAt: new Date().toISOString(),
    };

    Object.assign(session, updates);
    this.addToWAL({
      type: 'update',
      sessionId,
      data: updates,
      timestamp: Date.now(),
    });

    this.emit('sessionKilled', session);
  }

  async complete(sessionId: string, prInfo?: { number: number; url: string }): Promise<Session | null> {
    return this.updateStatus(sessionId, 'completed', {
      pr: prInfo ? { number: prInfo.number, url: prInfo.url, state: 'open' } : undefined,
    });
  }

  async delete(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);

    this.addToWAL({
      type: 'delete',
      sessionId,
      timestamp: Date.now(),
    });

    this.emit('sessionDeleted', sessionId);
    return true;
  }

  async flush(): Promise<void> {
    await this.flushWAL();
  }

  async destroy(): Promise<void> {
    this.stopWALFlush();
    await this.flushWAL();
    this.sessions.clear();
    this.branchNameCache.clear();
    this.sessionIdCache.clear();
    this.removeAllListeners();
  }
}

export const optimizedSessionManager = new OptimizedSessionManager();