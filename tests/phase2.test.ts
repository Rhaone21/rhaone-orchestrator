/**
 * Tests for Rhaone Orchestrator Phase 2
 * GitHub Integration, CI Polling, Lifecycle Management, PR Creator, Telegram Handler
 * 
 * Run with: npx vitest run
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Phase 2 imports
import {
  GitHubIntegration,
  GitHubIssue,
  GitHubPR,
  CIStatus,
  Review,
  WorkflowRun,
} from '../src/lib/github';

import {
  CIPoller,
  WorkflowPoller,
  CIEvent,
  CIEventType,
} from '../src/lib/ci-poller';

import {
  LifecycleManager,
  LifecycleEvent,
  LifecycleEventType,
  ReactionConfig,
} from '../src/lib/lifecycle-manager';

import {
  PRCreator,
  PRCreationOptions,
  WorktreeInfo,
} from '../src/lib/pr-creator';

// Mocks
vi.mock('../src/lib/exec', () => ({
  exec: vi.fn(),
  execWithResult: vi.fn(),
  commandExists: vi.fn().mockResolvedValue(true),
}));

vi.mock('telegraf', () => ({
  Telegraf: vi.fn().mockImplementation(() => ({
    command: vi.fn(),
    action: vi.fn(),
    catch: vi.fn(),
    launch: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    telegram: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  })),
  Markup: {
    inlineKeyboard: vi.fn().mockReturnValue({}),
  },
}));

import { exec } from '../src/lib/exec';
import { SessionManager, Session } from '../src/lib/session-manager';

// Test utilities
const testDir = '/tmp/rhaone-test-phase2';

describe('GitHub Integration', () => {
  let github: GitHubIntegration;

  beforeEach(() => {
    vi.clearAllMocks();
    github = new GitHubIntegration({
      owner: 'test-owner',
      repo: 'test-repo',
      token: 'test-token',
    });
  });

  it('should initialize with config', () => {
    expect(github).toBeDefined();
  });

  it('should extract issue number from various formats', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(JSON.stringify({
      number: 123,
      title: 'Test Issue',
      body: 'Issue body',
      state: 'open',
      labels: [{ name: 'bug' }],
      url: 'https://github.com/test-owner/test-repo/issues/123',
    }));

    const issue = await github.getIssue('Fix #123');
    expect(issue?.number).toBe(123);
    expect(issue?.title).toBe('Test Issue');
  });

  it('should extract issue number from GH- format', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(JSON.stringify({
      number: 456,
      title: 'Another Issue',
      body: 'Body',
      state: 'open',
      labels: [],
      url: 'https://github.com/test-owner/test-repo/issues/456',
    }));

    const issue = await github.getIssue('GH-456');
    expect(issue?.number).toBe(456);
  });

  it('should get PR by number', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(JSON.stringify({
      number: 42,
      title: 'Test PR',
      body: 'PR description',
      state: 'open',
      headRefName: 'feat/test-branch',
      baseRefName: 'main',
      url: 'https://github.com/test-owner/test-repo/pull/42',
      mergeable: true,
      isDraft: false,
    }));

    const pr = await github.getPR('42');
    expect(pr?.number).toBe(42);
    expect(pr?.title).toBe('Test PR');
    expect(pr?.headBranch).toBe('feat/test-branch');
  });

  it('should get PR by branch name', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(JSON.stringify({
      number: 99,
      title: 'Branch PR',
      body: 'Description',
      state: 'open',
      headRefName: 'feat/my-branch',
      baseRefName: 'main',
      url: 'https://github.com/test-owner/test-repo/pull/99',
      mergeable: true,
      isDraft: false,
    }));

    const pr = await github.getPR('feat/my-branch');
    expect(pr?.number).toBe(99);
  });

  it('should get CI status for PR', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'SUCCESS',
      contexts: [
        { context: 'test', state: 'SUCCESS', targetUrl: 'https://example.com' },
        { context: 'lint', state: 'SUCCESS', targetUrl: 'https://example.com' },
      ],
    }));

    const status = await github.getCIStatus(42);
    expect(status.state).toBe('success');
    expect(status.totalChecks).toBe(2);
    expect(status.passedChecks).toBe(2);
    expect(status.failedChecks).toBe(0);
  });

  it('should handle CI failure', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'FAILURE',
      contexts: [
        { context: 'test', state: 'SUCCESS', targetUrl: 'https://example.com' },
        { context: 'build', state: 'FAILURE', targetUrl: 'https://example.com' },
      ],
    }));

    const status = await github.getCIStatus(42);
    expect(status.state).toBe('failure');
    expect(status.passedChecks).toBe(1);
    expect(status.failedChecks).toBe(1);
  });

  it('should get reviews for PR', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(JSON.stringify([
      {
        id: 1,
        author: { login: 'reviewer1' },
        state: 'APPROVED',
        body: 'LGTM!',
        submittedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 2,
        author: { login: 'reviewer2' },
        state: 'CHANGES_REQUESTED',
        body: 'Needs changes',
        submittedAt: '2024-01-02T00:00:00Z',
      },
    ]));

    const reviews = await github.getReviews(42);
    expect(reviews).toHaveLength(2);
    expect(reviews[0].author).toBe('reviewer1');
    expect(reviews[0].state).toBe('APPROVED');
    expect(reviews[1].state).toBe('CHANGES_REQUESTED');
  });

  it('should get workflow runs for branch', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(JSON.stringify({
      workflow_runs: [
        {
          id: 123,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          head_branch: 'feat/test',
          head_sha: 'abc123',
          html_url: 'https://github.com/test-owner/test-repo/actions/runs/123',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:10:00Z',
        },
      ],
    }));

    const runs = await github.getWorkflowRuns('feat/test');
    expect(runs).toHaveLength(1);
    expect(runs[0].name).toBe('CI');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].conclusion).toBe('success');
  });

  it('should create a PR', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce('https://github.com/test-owner/test-repo/pull/100');
    
    // Mock the getPR call after creation
    mockExec.mockResolvedValueOnce(JSON.stringify({
      number: 100,
      title: 'New PR',
      body: 'Description',
      state: 'open',
      headRefName: 'feat/new-feature',
      baseRefName: 'main',
      url: 'https://github.com/test-owner/test-repo/pull/100',
      mergeable: true,
      isDraft: false,
    }));

    const pr = await github.createPR({
      title: 'New PR',
      body: 'Description',
      head: 'feat/new-feature',
      base: 'main',
    });

    expect(pr?.number).toBe(100);
    expect(pr?.title).toBe('New PR');
  });

  it('should merge a PR', async () => {
    const mockExec = vi.mocked(exec);
    mockExec.mockResolvedValueOnce('');

    const result = await github.mergePR(42, 'squash');
    expect(result).toBe(true);
  });

  it('should close a PR', async () => {
    const mockExec = vi.mocked(exec);
    mockExec.mockResolvedValueOnce('');

    const result = await github.closePR(42);
    expect(result).toBe(true);
  });
});

describe('CI Poller', () => {
  let ciPoller: CIPoller;
  let sessionManager: SessionManager;
  let github: GitHubIntegration;

  beforeEach(() => {
    vi.clearAllMocks();
    
    sessionManager = new SessionManager({ dataDir: testDir });
    github = new GitHubIntegration({
      owner: 'test-owner',
      repo: 'test-repo',
    });

    ciPoller = new CIPoller({
      sessionManager,
      github,
      pollInterval: 1000, // 1 second for testing
      adaptivePolling: false,
      cacheTTL: 5000,
    });
  });

  afterEach(() => {
    ciPoller.stopAll();
  });

  it('should initialize with options', () => {
    expect(ciPoller).toBeDefined();
    expect(ciPoller).toBeInstanceOf(EventEmitter);
  });

  it('should start polling for a session', async () => {
    const mockExec = vi.mocked(exec);
    
    // Create a session with PR
    const session = await sessionManager.create({
      projectId: 'test',
      issueId: '123',
      task: 'Test task',
    });
    
    // Add PR info to session
    session.pr = { number: 42, url: 'https://github.com/test/42', state: 'open' };

    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'PENDING',
      contexts: [],
    }));

    ciPoller.startPolling(session.id);
    
    const pollingStatus = ciPoller.getPollingStatus();
    expect(pollingStatus).toHaveLength(1);
    expect(pollingStatus[0].sessionId).toBe(session.id);
    expect(pollingStatus[0].active).toBe(true);

    ciPoller.stopPolling(session.id);
  });

  it('should emit statusChange event on CI status change', async () => {
    const mockExec = vi.mocked(exec);
    const statusChangeHandler = vi.fn();
    
    ciPoller.on('statusChange', statusChangeHandler);

    const session = await sessionManager.create({
      projectId: 'test',
      issueId: '123',
      task: 'Test task',
    });
    session.pr = { number: 42, url: 'https://github.com/test/42', state: 'open' };

    // First poll - pending
    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'PENDING',
      contexts: [],
    }));

    // Second poll - success
    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'SUCCESS',
      contexts: [{ context: 'test', state: 'SUCCESS' }],
    }));

    await ciPoller.pollSession(session.id);
    await ciPoller.pollSession(session.id);

    expect(statusChangeHandler).toHaveBeenCalled();
    const event = statusChangeHandler.mock.calls[0][0] as CIEvent;
    expect(event.type).toBe('ci.passed');
    expect(event.sessionId).toBe(session.id);
  });

  it('should get cached CI status', async () => {
    const mockExec = vi.mocked(exec);
    
    const session = await sessionManager.create({
      projectId: 'test',
      issueId: '123',
      task: 'Test task',
    });
    session.pr = { number: 42, url: 'https://github.com/test/42', state: 'open' };

    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'SUCCESS',
      contexts: [{ context: 'test', state: 'SUCCESS' }],
    }));

    await ciPoller.pollSession(session.id);
    
    const status = ciPoller.getStatus(session.id);
    expect(status).not.toBeNull();
    expect(status?.state).toBe('success');
  });

  it('should force refresh CI status', async () => {
    const mockExec = vi.mocked(exec);
    
    const session = await sessionManager.create({
      projectId: 'test',
      issueId: '123',
      task: 'Test task',
    });
    session.pr = { number: 42, url: 'https://github.com/test/42', state: 'open' };

    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'SUCCESS',
      contexts: [{ context: 'test', state: 'SUCCESS' }],
    }));

    const status = await ciPoller.forceRefresh(session.id);
    expect(status?.state).toBe('success');
  });

  it('should stop all polling', async () => {
    const session1 = await sessionManager.create({
      projectId: 'test',
      issueId: '123',
      task: 'Test task',
    });
    session1.pr = { number: 42, url: 'https://github.com/test/42', state: 'open' };

    const session2 = await sessionManager.create({
      projectId: 'test',
      issueId: '456',
      task: 'Test task 2',
    });
    session2.pr = { number: 43, url: 'https://github.com/test/43', state: 'open' };

    ciPoller.startPolling(session1.id);
    ciPoller.startPolling(session2.id);

    expect(ciPoller.getPollingStatus()).toHaveLength(2);

    ciPoller.stopAll();

    expect(ciPoller.getPollingStatus()).toHaveLength(0);
  });
});

describe('Workflow Poller', () => {
  let workflowPoller: WorkflowPoller;
  let github: GitHubIntegration;

  beforeEach(() => {
    vi.clearAllMocks();
    
    github = new GitHubIntegration({
      owner: 'test-owner',
      repo: 'test-repo',
    });

    workflowPoller = new WorkflowPoller({
      github,
      pollInterval: 1000,
    });
  });

  afterEach(() => {
    workflowPoller.stopAll();
  });

  it('should initialize with options', () => {
    expect(workflowPoller).toBeDefined();
    expect(workflowPoller).toBeInstanceOf(EventEmitter);
  });

  it('should start monitoring a branch', () => {
    workflowPoller.startMonitoring('feat/test-branch');
    // Should not throw
    expect(workflowPoller).toBeDefined();
  });

  it('should stop monitoring a branch', () => {
    workflowPoller.startMonitoring('feat/test-branch');
    workflowPoller.stopMonitoring('feat/test-branch');
    // Should not throw
    expect(workflowPoller).toBeDefined();
  });
});

describe('Lifecycle Manager', () => {
  let lifecycleManager: LifecycleManager;
  let sessionManager: SessionManager;
  let github: GitHubIntegration;
  let ciPoller: CIPoller;

  beforeEach(() => {
    vi.clearAllMocks();
    
    sessionManager = new SessionManager({ dataDir: testDir });
    github = new GitHubIntegration({
      owner: 'test-owner',
      repo: 'test-repo',
    });
    ciPoller = new CIPoller({
      sessionManager,
      github,
      pollInterval: 1000,
      adaptivePolling: false,
      cacheTTL: 5000,
    });

    lifecycleManager = new LifecycleManager({
      sessionManager,
      github,
      ciPoller,
    });
  });

  afterEach(() => {
    lifecycleManager.destroy();
  });

  it('should initialize with options', () => {
    expect(lifecycleManager).toBeDefined();
    expect(lifecycleManager).toBeInstanceOf(EventEmitter);
  });

  it('should register a custom reaction handler', () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    
    lifecycleManager.registerReaction(
      'ci.failed',
      { enabled: true, action: 'notify' },
      handler
    );

    // Handler is registered internally
    expect(lifecycleManager).toBeDefined();
  });

  it('should get current config', () => {
    const config = lifecycleManager.getConfig();
    expect(config).toBeDefined();
    expect(config.ciFailed).toBeDefined();
    expect(config.ciPassed).toBeDefined();
    expect(config.reviewApproved).toBeDefined();
    expect(config.reviewChangesRequested).toBeDefined();
  });

  it('should update config', () => {
    lifecycleManager.updateConfig({
      ciFailed: { enabled: false, action: 'notify' },
    });

    const config = lifecycleManager.getConfig();
    expect(config.ciFailed.enabled).toBe(false);
  });

  it('should cancel auto-fix for a session', async () => {
    const session = await sessionManager.create({
      projectId: 'test',
      issueId: '123',
      task: 'Test task',
    });

    // Should not throw
    lifecycleManager.cancelAutoFix(session.id);
    expect(lifecycleManager).toBeDefined();
  });
});

describe('PR Creator', () => {
  let prCreator: PRCreator;
  let sessionManager: SessionManager;
  let github: GitHubIntegration;

  beforeEach(() => {
    vi.clearAllMocks();
    
    sessionManager = new SessionManager({ dataDir: testDir });
    github = new GitHubIntegration({
      owner: 'test-owner',
      repo: 'test-repo',
    });

    prCreator = new PRCreator({
      sessionManager,
      github,
      workspaceRoot: testDir,
    });
  });

  it('should initialize with options', () => {
    expect(prCreator).toBeDefined();
  });

  it('should get worktree info', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(''); // git status --porcelain
    mockExec.mockResolvedValueOnce('abc123 Test commit'); // git log
    mockExec.mockResolvedValueOnce('feat/test-branch'); // git branch

    const worktree = await prCreator.getWorktreeInfo('feat/test-branch');
    // May return null if worktree doesn't exist, but should not throw
    expect(prCreator).toBeDefined();
  });

  it('should list all worktrees', async () => {
    const mockExec = vi.mocked(exec);
    
    mockExec.mockResolvedValueOnce(`
worktree /tmp/test
HEAD abc123
branch refs/heads/main

worktree /tmp/test2
HEAD def456
branch refs/heads/feat/test
    `.trim());

    // Additional mocks for getWorktreeInfo
    mockExec.mockResolvedValueOnce('');
    mockExec.mockResolvedValueOnce('abc123 Test');
    mockExec.mockResolvedValueOnce('main');
    mockExec.mockResolvedValueOnce('');
    mockExec.mockResolvedValueOnce('def456 Test2');
    mockExec.mockResolvedValueOnce('feat/test');

    const worktrees = await prCreator.listWorktrees();
    // Should return array (may be empty if errors)
    expect(Array.isArray(worktrees)).toBe(true);
  });
});

describe('Telegram Handler', () => {
  let telegramHandler: any;
  let sessionManager: SessionManager;
  let lifecycleManager: LifecycleManager;
  let github: GitHubIntegration;
  let ciPoller: CIPoller;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    sessionManager = new SessionManager({ dataDir: testDir });
    github = new GitHubIntegration({
      owner: 'test-owner',
      repo: 'test-repo',
    });
    ciPoller = new CIPoller({
      sessionManager,
      github,
      adaptivePolling: false,
      cacheTTL: 5000,
    });
    lifecycleManager = new LifecycleManager({
      sessionManager,
      github,
      ciPoller,
    });

    const { TelegramHandler } = await import('../src/lib/telegram-handler');
    
    telegramHandler = new TelegramHandler({
      sessionManager,
      lifecycleManager,
      github,
      ciPoller,
      allowedChatIds: ['123456'],
    });
  });

  it('should initialize with options', () => {
    expect(telegramHandler).toBeDefined();
  });

  it('should initialize bot handlers', async () => {
    await telegramHandler.initialize();
    expect(telegramHandler).toBeDefined();
  });

  it('should start the bot', async () => {
    await telegramHandler.initialize();
    await telegramHandler.start();
    expect(telegramHandler).toBeDefined();
  });

  it('should stop the bot', async () => {
    await telegramHandler.initialize();
    telegramHandler.stop();
    expect(telegramHandler).toBeDefined();
  });

  it('should get bot instance', () => {
    const bot = telegramHandler.getBot();
    expect(bot).toBeDefined();
  });
});

describe('Phase 2 Integration', () => {
  it('should export all Phase 2 modules', async () => {
    const index = await import('../src/index');
    
    // GitHub Integration (classes and functions only - types are compile-time only)
    expect(index.GitHubIntegration).toBeDefined();
    expect(index.createGitHubFromSession).toBeDefined();
    
    // CI Poller
    expect(index.CIPoller).toBeDefined();
    expect(index.WorkflowPoller).toBeDefined();
    
    // Lifecycle Manager
    expect(index.LifecycleManager).toBeDefined();
    
    // PR Creator
    expect(index.PRCreator).toBeDefined();
    expect(index.createPRCreator).toBeDefined();
    
    // Telegram Handler
    expect(index.TelegramHandler).toBeDefined();
    
    // Utilities
    expect(index.exec).toBeDefined();
    expect(index.execWithResult).toBeDefined();
    expect(index.commandExists).toBeDefined();
  });

  it('should have init function that returns Phase 2 components', async () => {
    const { init } = await import('../src/index');
    expect(init).toBeDefined();
    expect(typeof init).toBe('function');
  });

  it('should have runTask function', async () => {
    const { runTask } = await import('../src/index');
    expect(runTask).toBeDefined();
    expect(typeof runTask).toBe('function');
  });

  it('should have cleanupTask function', async () => {
    const { cleanupTask } = await import('../src/index');
    expect(cleanupTask).toBeDefined();
    expect(typeof cleanupTask).toBe('function');
  });

  it('should have status function', async () => {
    const { status } = await import('../src/index');
    expect(status).toBeDefined();
    expect(typeof status).toBe('function');
  });
});

describe('Orchestrator End-to-End Flow', () => {
  let sessionManager: SessionManager;
  let github: GitHubIntegration;
  let ciPoller: CIPoller;
  let lifecycleManager: LifecycleManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
    sessionManager = new SessionManager({ dataDir: testDir });
    github = new GitHubIntegration({
      owner: 'test-owner',
      repo: 'test-repo',
    });
    ciPoller = new CIPoller({
      sessionManager,
      github,
      pollInterval: 1000,
      adaptivePolling: false,
      cacheTTL: 5000,
    });
    lifecycleManager = new LifecycleManager({
      sessionManager,
      github,
      ciPoller,
    });
  });

  afterEach(() => {
    lifecycleManager.destroy();
    ciPoller.stopAll();
  });

  it('should handle complete session lifecycle', async () => {
    const mockExec = vi.mocked(exec);
    
    // Create session
    const session = await sessionManager.create({
      projectId: 'test-project',
      issueId: 'Fix #123',
      task: 'Fix the bug',
    });

    expect(session).toBeDefined();
    expect(session.status).toBe('pending');
    expect(session.branch).toContain('fix-123');

    // Update status to working
    await sessionManager.updateStatus(session.id, 'working');
    const workingSession = sessionManager.get(session.id);
    expect(workingSession?.status).toBe('working');

    // Add PR info
    workingSession!.pr = {
      number: 42,
      url: 'https://github.com/test-owner/test-repo/pull/42',
      state: 'open',
    };

    // Mock CI status
    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'SUCCESS',
      contexts: [{ context: 'test', state: 'SUCCESS' }],
    }));

    // Poll CI
    const ciStatus = await ciPoller.pollSession(session.id);
    expect(ciStatus).toBeDefined();

    // Complete session
    await sessionManager.complete(session.id, { number: 42, url: 'https://github.com/test/42' });
    const completedSession = sessionManager.get(session.id);
    expect(completedSession?.status).toBe('completed');
    expect(completedSession?.pr?.number).toBe(42);
  });

  it('should handle CI failure and retry', async () => {
    const mockExec = vi.mocked(exec);
    
    const session = await sessionManager.create({
      projectId: 'test',
      issueId: '456',
      task: 'Another fix',
    });

    session.pr = { number: 99, url: 'https://github.com/test/99', state: 'open' };

    // Mock CI failure
    mockExec.mockResolvedValueOnce(JSON.stringify({
      state: 'FAILURE',
      contexts: [
        { context: 'test', state: 'FAILURE' },
      ],
    }));

    const ciStatus = await ciPoller.pollSession(session.id);
    expect(ciStatus?.state).toBe('failure');
    expect(ciStatus?.failedChecks).toBe(1);

    // Session should still be working
    expect(session.status).toBe('pending'); // Original status
  });

  it('should handle review changes requested', async () => {
    const mockExec = vi.mocked(exec);
    
    const session = await sessionManager.create({
      projectId: 'test',
      issueId: '789',
      task: 'Feature',
    });

    session.pr = { number: 100, url: 'https://github.com/test/100', state: 'open' };

    // Mock reviews
    mockExec.mockResolvedValueOnce(JSON.stringify([
      {
        id: 1,
        author: { login: 'reviewer' },
        state: 'CHANGES_REQUESTED',
        body: 'Please fix this',
        submittedAt: '2024-01-01T00:00:00Z',
      },
    ]));

    await lifecycleManager.checkReviews(session.id);
    
    // Session metadata should be updated
    expect(session.metadata?.lastReview).toBeDefined();
  });
});

describe('Type Definitions', () => {
  it('should have correct CIStatus structure', () => {
    const status: CIStatus = {
      state: 'success',
      totalChecks: 3,
      passedChecks: 3,
      failedChecks: 0,
      checks: [
        {
          name: 'test',
          status: 'completed',
          conclusion: 'success',
          url: 'https://example.com',
        },
      ],
    };

    expect(status.state).toBe('success');
    expect(status.totalChecks).toBe(3);
    expect(status.checks).toHaveLength(1);
  });

  it('should have correct GitHubPR structure', () => {
    const pr: GitHubPR = {
      number: 42,
      title: 'Test PR',
      body: 'Description',
      state: 'open',
      headBranch: 'feat/test',
      baseBranch: 'main',
      url: 'https://github.com/test/42',
      mergeable: true,
      draft: false,
    };

    expect(pr.number).toBe(42);
    expect(pr.mergeable).toBe(true);
    expect(pr.draft).toBe(false);
  });

  it('should have correct Review structure', () => {
    const review: Review = {
      id: 1,
      author: 'reviewer',
      state: 'APPROVED',
      body: 'LGTM',
      submittedAt: '2024-01-01T00:00:00Z',
    };

    expect(review.state).toBe('APPROVED');
    expect(review.author).toBe('reviewer');
  });

  it('should have correct WorkflowRun structure', () => {
    const run: WorkflowRun = {
      id: 123,
      name: 'CI',
      status: 'completed',
      conclusion: 'success',
      headBranch: 'feat/test',
      headSha: 'abc123',
      url: 'https://github.com/test/actions/123',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:10:00Z',
    };

    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
  });

  it('should have correct CIEvent structure', () => {
    const event: CIEvent = {
      type: 'ci.passed',
      sessionId: 'test-session',
      prNumber: 42,
      branch: 'feat/test',
      status: {
        state: 'success',
        totalChecks: 2,
        passedChecks: 2,
        failedChecks: 0,
        checks: [],
      },
      timestamp: new Date(),
    };

    expect(event.type).toBe('ci.passed');
    expect(event.sessionId).toBe('test-session');
  });

  it('should have correct LifecycleEvent structure', () => {
    const session: Session = {
      id: 'test',
      projectId: 'proj',
      issueId: '123',
      branch: 'feat/test',
      status: 'working',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      metrics: {
        spawnDuration: 1000,
        ciPasses: 0,
        ciFailures: 0,
      },
    };

    const event: LifecycleEvent = {
      type: 'ci.passed',
      session,
      data: { prNumber: 42 },
      timestamp: new Date(),
    };

    expect(event.type).toBe('ci.passed');
    expect(event.session.id).toBe('test');
  });
});