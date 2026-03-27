import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionManager, Session, SessionStatus, SpawnConfig } from '../src/lib/session-manager';
import { loadConfig } from '../src/lib/config';

// Track spawn call count to generate unique IDs
let spawnCallCount = 0;

// Mock the OpenClaw tools
vi.mock('@anthropic-ai/claude-code', () => ({
  sessions_spawn: vi.fn().mockImplementation(() => {
    spawnCallCount++;
    return Promise.resolve({ sessionId: `mock-session-${spawnCallCount}` });
  }),
  subagents: {
    kill: vi.fn().mockResolvedValue(undefined),
  },
  sessions_send: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/exec', () => ({
  exec: vi.fn().mockResolvedValue('mock-exec-result'),
}));

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ dataDir: '/tmp/test-sessions' });
  });
  
  afterEach(() => {
    // Clean up any created sessions
    manager.list().forEach(s => {
      try {
        manager.kill(s.id);
      } catch {
        // Ignore errors during cleanup
      }
    });
  });

  describe('spawn', () => {
    test('should create a new session', async () => {
      const config: SpawnConfig = {
        projectId: 'test-project',
        issueId: '123',
        branch: 'feature-test',
        task: 'Implement feature',
        worktreePath: '/tmp/worktrees/feature-test',
      };

      const session = await manager.spawn(config);

      expect(session.id).toBeDefined();
      expect(session.id).toContain('test-project');
      expect(session.projectId).toBe('test-project');
      expect(session.issueId).toBe('123');
      expect(session.branch).toBe('feature-test');
      expect(session.status).toBe('working');
      // openclawSessionId is set by the mock spawner
      expect(session.openclawSessionId).toBeDefined();
      expect(session.metrics.spawnDuration).toBeGreaterThanOrEqual(0);
    });

    test('should generate unique session IDs', async () => {
      const config: SpawnConfig = {
        projectId: 'test-project',
        issueId: 'issue-1',
        branch: 'feature-1',
        task: 'Task 1',
        worktreePath: '/tmp/wt1',
      };

      const session1 = await manager.spawn(config);

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      config.issueId = 'issue-2';
      config.branch = 'feature-2';
      config.worktreePath = '/tmp/wt2';
      const session2 = await manager.spawn(config);

      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe('list', () => {
    test('should list all sessions', async () => {
      await manager.spawn({
        projectId: 'project-1',
        issueId: 'issue-1',
        branch: 'feature-1',
        task: 'Task 1',
        worktreePath: '/tmp/wt1',
      });

      await manager.spawn({
        projectId: 'project-2',
        issueId: 'issue-2',
        branch: 'feature-2',
        task: 'Task 2',
        worktreePath: '/tmp/wt2',
      });

      const sessions = manager.list();
      expect(sessions).toHaveLength(2);
    });

    test('should filter sessions by projectId', async () => {
      await manager.spawn({
        projectId: 'project-1',
        issueId: 'issue-1',
        branch: 'feature-1',
        task: 'Task 1',
        worktreePath: '/tmp/wt1',
      });

      await manager.spawn({
        projectId: 'project-1',
        issueId: 'issue-2',
        branch: 'feature-2',
        task: 'Task 2',
        worktreePath: '/tmp/wt2',
      });

      await manager.spawn({
        projectId: 'project-2',
        issueId: 'issue-3',
        branch: 'feature-3',
        task: 'Task 3',
        worktreePath: '/tmp/wt3',
      });

      const sessions = manager.list('project-1');
      expect(sessions).toHaveLength(2);
      expect(sessions.every(s => s.projectId === 'project-1')).toBe(true);
    });

    test('should filter sessions by status', async () => {
      const session1 = await manager.spawn({
        projectId: 'project-1',
        issueId: 'issue-1',
        branch: 'feature-1',
        task: 'Task 1',
        worktreePath: '/tmp/wt1',
      });

      await manager.updateStatus(session1.id, 'completed');

      const session2 = await manager.spawn({
        projectId: 'project-2',
        issueId: 'issue-2',
        branch: 'feature-2',
        task: 'Task 2',
        worktreePath: '/tmp/wt2',
      });

      const completedSessions = manager.list().filter(s => s.status === 'completed');
      expect(completedSessions).toHaveLength(1);
      expect(completedSessions[0].id).toBe(session1.id);

      const workingSessions = manager.list().filter(s => s.status === 'working');
      expect(workingSessions).toHaveLength(1);
      expect(workingSessions[0].id).toBe(session2.id);
    });
  });

  describe('get', () => {
    test('should get session by ID', async () => {
      const created = await manager.spawn({
        projectId: 'project-1',
        branch: 'feature-1',
        task: 'Task 1',
        worktreePath: '/tmp/wt1',
      });

      const session = manager.get(created.id);
      expect(session).toBeDefined();
      expect(session?.id).toBe(created.id);
    });

    test('should return null for non-existent session', () => {
      const session = manager.get('non-existent');
      expect(session).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update session status', async () => {
      const session = await manager.spawn({
        projectId: 'project-1',
        branch: 'feature-1',
        task: 'Task 1',
        worktreePath: '/tmp/wt1',
      });

      manager.updateStatus(session.id, 'waiting_pr');

      const updated = manager.get(session.id);
      expect(updated?.status).toBe('waiting_pr');
    });
  });

  describe('complete', () => {
    test('should complete session with PR info', async () => {
      const session = await manager.spawn({
        projectId: 'project-1',
        branch: 'feature-1',
        task: 'Task 1',
        worktreePath: '/tmp/wt1',
      });

      await manager.complete(session.id, {
        number: 42,
        url: 'https://github.com/test/repo/pull/42',
      });

      const updated = manager.get(session.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.pr?.number).toBe(42);
      expect(updated?.pr?.url).toBe('https://github.com/test/repo/pull/42');
    });
  });

  describe('kill', () => {
    test('should kill a session', async () => {
      const session = await manager.spawn({
        projectId: 'project-1',
        branch: 'feature-1',
        task: 'Task 1',
        worktreePath: '/tmp/wt1',
      });

      await manager.kill(session.id);

      const killed = manager.get(session.id);
      expect(killed?.status).toBe('killed');
    });

    test('should throw for non-existent session', async () => {
      await expect(manager.kill('non-existent')).rejects.toThrow('Session non-existent not found');
    });
  });
});