import { ConfigLoader, RhaoneConfig } from '../config';

export interface SessionMetadata {
  id: string;
  projectId: string;
  issueId?: string;
  branch: string;
  status: SessionStatus;
  openclawSessionId?: string;
  worktreePath?: string;
  pr?: {
    number: number;
    url: string;
    state: string;
  };
  createdAt: string;
  lastActivityAt: string;
  metrics: SessionMetrics;
}

export type SessionStatus = 'pending' | 'spawning' | 'working' | 'pr_open' | 'ci_running' | 'reviewing' | 'completed' | 'errored' | 'killed';

export interface SessionMetrics {
  spawnDuration: number;
  prOpenDuration?: number;
  ciPasses: number;
  ciFailures: number;
}

export interface SpawnConfig {
  projectId: string;
  issueId?: string;
  branch: string;
  task: string;
  worktreePath: string;
  agent?: string;
  model?: string;
  runtime?: 'subagent' | 'acp';
}

export interface SessionListFilter {
  projectId?: string;
  status?: SessionStatus;
}

export class SessionManager {
  private sessions: Map<string, SessionMetadata>;
  private configLoader: ConfigLoader;

  constructor(configLoader?: ConfigLoader) {
    this.configLoader = configLoader || new ConfigLoader();
    this.sessions = new Map();
  }

  async spawn(config: SpawnConfig): Promise<SessionMetadata> {
    const sessionId = this.generateSessionId(config.projectId);
    const startTime = Date.now();
    
    const session: SessionMetadata = {
      id: sessionId,
      projectId: config.projectId,
      issueId: config.issueId,
      branch: config.branch,
      status: 'spawning',
      worktreePath: config.worktreePath,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      metrics: {
        spawnDuration: 0,
        ciPasses: 0,
        ciFailures: 0,
      },
    };

    this.sessions.set(sessionId, session);

    try {
      // Use dynamic import to avoid TypeScript issues with OpenClaw tools
      const { sessions_spawn } = await import('@anthropic-ai/claude-code' as any);
      
      const spawnResult = await sessions_spawn({
        agent: config.agent || this.configLoader.get().defaults.agent,
        model: config.model || this.configLoader.get().defaults.model,
        runtime: config.runtime || 'subagent',
        task: config.task,
        cwd: config.worktreePath,
        env: {
          RHONE_SESSION_ID: sessionId,
          RHONE_PROJECT_ID: config.projectId,
          GITHUB_TOKEN: this.configLoader.getGithubToken() || '',
        },
      });

      session.openclawSessionId = spawnResult.sessionId;
      session.status = 'working';
      session.metrics.spawnDuration = Date.now() - startTime;
      session.lastActivityAt = new Date().toISOString();
      
      this.sessions.set(sessionId, session);
      
      return session;
    } catch (error) {
      session.status = 'errored';
      session.lastActivityAt = new Date().toISOString();
      this.sessions.set(sessionId, session);
      throw error;
    }
  }

  list(filter?: SessionListFilter): SessionMetadata[] {
    let sessions = Array.from(this.sessions.values());
    
    if (filter) {
      if (filter.projectId) {
        sessions = sessions.filter(s => s.projectId === filter.projectId);
      }
      if (filter.status) {
        sessions = sessions.filter(s => s.status === filter.status);
      }
    }
    
    return sessions.sort((a, b) => 
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
  }

  get(sessionId: string): SessionMetadata | null {
    return this.sessions.get(sessionId) || null;
  }

  async kill(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.openclawSessionId) {
      const { subagents } = await import('@anthropic-ai/claude-code' as any);
      await subagents.kill(session.openclawSessionId);
    }

    session.status = 'killed';
    session.lastActivityAt = new Date().toISOString();
    this.sessions.set(sessionId, session);
  }

  async send(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.openclawSessionId) {
      throw new Error(`Session ${sessionId} has no OpenClaw session`);
    }

    const { sessions_send } = await import('@anthropic-ai/claude-code' as any);
    await sessions_send({
      sessionKey: session.openclawSessionId,
      message,
    });

    session.lastActivityAt = new Date().toISOString();
    this.sessions.set(sessionId, session);
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.lastActivityAt = new Date().toISOString();
      this.sessions.set(sessionId, session);
    }
  }

  updatePR(sessionId: string, pr: { number: number; url: string; state: string }): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pr = pr;
      session.lastActivityAt = new Date().toISOString();
      this.sessions.set(sessionId, session);
    }
  }

  private generateSessionId(projectId: string): string {
    const timestamp = Date.now().toString(36).slice(-6);
    return `${projectId}-${timestamp}`;
  }
}

export const sessionManager = new SessionManager();