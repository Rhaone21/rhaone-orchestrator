/**
 * Tests for Rhaone Orchestrator Phase 1
 * Run with: npx vitest run
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  loadConfig, 
  loadGlobalConfig, 
  loadProjectConfig, 
  GlobalConfig,
  ProjectConfig 
} from '../src/lib/config';
import { SessionManager, Session } from '../src/lib/session-manager';
import { GitWorktreeHandler } from '../src/lib/git-worktree';
import { TelegramNotifier } from '../src/lib/telegram-notifier';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// Test utilities
const testDir = join(homedir(), '.rhaone-orchestrator', 'test');

function setupTestDir() {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
}

function cleanupTestDir() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

describe('Config Loader', () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should return default config when no file exists', () => {
    const config = loadGlobalConfig('/nonexistent/path.yaml');
    expect(config.defaults.agent).toBe('kimi');
    expect(config.defaults.model).toBe('MiniMax-Coding');
    expect(config.learning.enabled).toBe(true);
  });

  it('should load config from file', () => {
    const configPath = join(testDir, 'config.yaml');
    writeFileSync(configPath, `
defaults:
  agent: custom-agent
  model: custom-model
telegram:
  chatId: "12345"
`);
    
    const config = loadGlobalConfig(configPath);
    expect(config.defaults.agent).toBe('custom-agent');
    expect(config.defaults.model).toBe('custom-model');
    expect(config.telegram.chatId).toBe('12345');
  });

  it('should merge config with defaults', () => {
    const configPath = join(testDir, 'config2.yaml');
    writeFileSync(configPath, `
defaults:
  agent: new-agent
`);
    
    const config = loadGlobalConfig(configPath);
    expect(config.defaults.agent).toBe('new-agent');
    expect(config.defaults.model).toBe('MiniMax-Coding'); // default
    expect(config.learning.enabled).toBe(true); // default
  });

  it('should handle null values', () => {
    const configPath = join(testDir, 'config3.yaml');
    writeFileSync(configPath, `
defaults:
  agent: null
`);
    
    const config = loadGlobalConfig(configPath);
    expect(config.defaults.agent).toBe(null);
  });

  it('should load project config', () => {
    const projectDir = join(testDir, 'project');
    mkdirSync(projectDir, { recursive: true });
    
    const configPath = join(projectDir, 'config.yaml');
    writeFileSync(configPath, `
project:
  name: test-project
  repo: owner/test
  path: /path/to/project
agents:
  kimi:
    permissions: full
`);
    
    const config = loadProjectConfig(projectDir);
    expect(config?.project.name).toBe('test-project');
    expect(config?.agents.kimi.permissions).toBe('full');
  });

  it('should return null for missing project config', () => {
    const config = loadProjectConfig('/nonexistent/project');
    expect(config).toBeNull();
  });
});

describe('Session Manager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    setupTestDir();
    manager = new SessionManager({ dataDir: testDir });
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should create a new session', async () => {
    const session = await manager.create({
      projectId: 'test-project',
      issueId: '123',
      task: 'Fix a bug',
    });

    expect(session.id).toContain('test-project');
    expect(session.projectId).toBe('test-project');
    expect(session.issueId).toBe('123');
    expect(session.status).toBe('pending');
    expect(session.branch).toContain('feat');
  });

  it('should generate unique session IDs', async () => {
    const session1 = await manager.create({
      projectId: 'test',
      issueId: 'issue-1',
      task: 'Task 1',
    });

    // Wait a bit to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));

    const session2 = await manager.create({
      projectId: 'test',
      issueId: 'issue-2',
      task: 'Task 2',
    });

    expect(session1.id).not.toBe(session2.id);
  });

  it('should generate branch names from issue IDs', () => {
    const branch1 = manager.generateBranchName('Fix #123');
    const branch2 = manager.generateBranchName('feat: add support for X');

    expect(branch1).toBe('feat/fix-123-auto');
    expect(branch2).toBe('feat/feat-add-support-for-x-auto');
  });

  it('should list sessions', async () => {
    await manager.create({
      projectId: 'proj1',
      issueId: '1',
      task: 'Task 1',
    });

    await manager.create({
      projectId: 'proj1',
      issueId: '2',
      task: 'Task 2',
    });

    const sessions = manager.list('proj1');
    expect(sessions.length).toBe(2);
  });

  it('should get session by ID', async () => {
    const created = await manager.create({
      projectId: 'test',
      issueId: 'issue-1',
      task: 'Task',
    });

    const retrieved = manager.get(created.id);
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.issueId).toBe('issue-1');
  });

  it('should update session status', async () => {
    const session = await manager.create({
      projectId: 'test',
      issueId: '1',
      task: 'Task',
    });

    await manager.updateStatus(session.id, 'working');
    
    const updated = manager.get(session.id);
    expect(updated?.status).toBe('working');
  });

  it('should list active sessions', async () => {
    const s1 = await manager.create({ projectId: 'test', issueId: '1', task: 't' });
    const s2 = await manager.create({ projectId: 'test', issueId: '2', task: 't' });
    
    await manager.updateStatus(s1.id, 'working');
    await manager.updateStatus(s2.id, 'completed'); // Mark s2 as completed
    
    const active = manager.listActive('test');
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(s1.id);
  });

  it('should kill a session', async () => {
    const session = await manager.create({
      projectId: 'test',
      issueId: '1',
      task: 'Task',
    });

    await manager.kill(session.id);
    
    const killed = manager.get(session.id);
    expect(killed?.status).toBe('killed');
  });
});

describe('Git Worktree Handler', () => {
  let handler: GitWorktreeHandler;
  const testWorktreeDir = join(testDir, 'worktrees');

  beforeEach(() => {
    setupTestDir();
    handler = new GitWorktreeHandler(testWorktreeDir);
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should initialize with default directory', () => {
    const h = new GitWorktreeHandler();
    expect(h).toBeDefined();
  });

  it('should detect non-git directories', () => {
    const testPath = join(testDir, 'not-a-repo');
    mkdirSync(testPath, { recursive: true });
    
    expect(handler.isGitRepo(testPath)).toBe(false);
  });

  it('should throw for operations on non-git directories', async () => {
    const testPath = join(testDir, 'not-a-repo');
    mkdirSync(testPath, { recursive: true });
    
    await expect(handler.create({
      repoPath: testPath,
      branch: 'test-branch',
    })).rejects.toThrow('Not a git repository');
  });
});

describe('Telegram Notifier', () => {
  let notifier: TelegramNotifier;

  beforeEach(() => {
    setupTestDir();
    notifier = new TelegramNotifier({ botToken: 'test-token', chatId: '123' });
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should report as configured with token and chatId', () => {
    expect(notifier.isConfigured()).toBe(true);
  });

  it('should report as unconfigured without token', () => {
    const n = new TelegramNotifier({ botToken: undefined, chatId: '123' });
    expect(n.isConfigured()).toBe(false);
  });

  it('should report as unconfigured without chatId', () => {
    const n = new TelegramNotifier({ botToken: 'token', chatId: undefined });
    expect(n.isConfigured()).toBe(false);
  });

  it('should configure via setToken', () => {
    const n = new TelegramNotifier();
    n.configure({ botToken: 'new-token', chatId: '456' });
    expect(n.isConfigured()).toBe(true);
  });

  it('should set default level', () => {
    notifier.setDefaultLevel('warning');
    // The level is stored internally, just check it doesn't throw
    expect(notifier).toBeDefined();
  });
});

describe('Integration', () => {
  it('should export all modules', async () => {
    const { loadConfig, SessionManager, GitWorktreeHandler, TelegramNotifier } = await import('../src/index');
    
    expect(loadConfig).toBeDefined();
    expect(SessionManager).toBeDefined();
    expect(GitWorktreeHandler).toBeDefined();
    expect(TelegramNotifier).toBeDefined();
  });
});