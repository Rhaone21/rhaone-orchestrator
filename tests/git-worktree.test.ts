import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { GitWorktreeHandler, WorktreeInfo } from '../src/git/worktree';

describe('GitWorktreeHandler', () => {
  let tempDir: string;
  let repoPath: string;
  let worktreeBase: string;
  let handler: GitWorktreeHandler;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhaone-worktree-test-'));
    repoPath = path.join(tempDir, 'repo');
    worktreeBase = path.join(tempDir, 'worktrees');

    // Initialize a git repo
    fs.mkdirSync(repoPath, { recursive: true });
    execSync('git init', { cwd: repoPath });
    execSync('git config user.email "test@test.com"', { cwd: repoPath });
    execSync('git config user.name "Test User"', { cwd: repoPath });

    // Create initial commit on main branch
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repo');
    execSync('git add README.md', { cwd: repoPath });
    execSync('git commit -m "Initial commit"', { cwd: repoPath });

    // Create a bare repo to serve as remote for testing
    const remotePath = path.join(tempDir, 'remote.git');
    execSync(`git init --bare "${remotePath}"`, { cwd: repoPath });
    execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath });
    execSync('git push -u origin master', { cwd: repoPath });

    handler = new GitWorktreeHandler(repoPath, worktreeBase, 'master');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    test('should create a new worktree with new branch', async () => {
      const result = await handler.create('feature-new');

      expect(result.path).toBe(path.join(worktreeBase, 'feature-new'));
      expect(result.branch).toBe('feature-new');
      expect(fs.existsSync(result.path)).toBe(true);
    });

    test('should create a worktree with custom name', async () => {
      const result = await handler.create('feature/custom', 'my-custom-name');

      expect(result.path).toBe(path.join(worktreeBase, 'my-custom-name'));
      expect(fs.existsSync(result.path)).toBe(true);
    });

    test('should throw if worktree already exists', async () => {
      await handler.create('feature-dup');

      await expect(handler.create('feature-dup')).rejects.toThrow('Worktree already exists');
    });
  });

  describe('destroy', () => {
    test('should remove a worktree', async () => {
      const result = await handler.create('feature-destroy');
      expect(fs.existsSync(result.path)).toBe(true);

      await handler.destroy('feature-destroy');
      expect(fs.existsSync(result.path)).toBe(false);
    });

    test('should throw if worktree does not exist', async () => {
      await expect(handler.destroy('non-existent')).rejects.toThrow('Worktree does not exist');
    });

    test('should remove branch after worktree removal', async () => {
      await handler.create('feature-cleanup');
      await handler.destroy('feature-cleanup');

      const listOutput = execSync('git branch', { cwd: repoPath, encoding: 'utf8' });
      expect(listOutput).not.toContain('feature-cleanup');
    });
  });

  describe('list', () => {
    test('should list all worktrees in base path', async () => {
      await handler.create('feature-list-1');
      await handler.create('feature-list-2');

      const worktrees = await handler.list();

      expect(worktrees.length).toBe(2);
      expect(worktrees.map(w => w.branch)).toContain('feature-list-1');
      expect(worktrees.map(w => w.branch)).toContain('feature-list-2');
    });

    test('should return empty array when no worktrees', async () => {
      const worktrees = await handler.list();
      expect(worktrees).toHaveLength(0);
    });
  });

  describe('getWorktreeInfo', () => {
    test('should get worktree info', async () => {
      const created = await handler.create('feature-info');
      const info = await handler.getWorktreeInfo(created.path);

      expect(info.branch).toBe('feature-info');
      expect(info.head).toBeDefined();
    });
  });

  describe('getCurrentBranch', () => {
    test('should get current branch of repo', async () => {
      const branch = await handler.getCurrentBranch();
      expect(branch).toBe('master');
    });
  });
});