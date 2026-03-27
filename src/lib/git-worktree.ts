/**
 * Rhaone Orchestrator - Git Worktree Handler
 * Create and destroy git worktrees for isolated agent sessions with error handling
 */

import { execFileSync, execFile } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { 
  withRetry, 
  withGracefulDegradation, 
  withCircuitBreaker,
  withTimeout,
  errorHandler,
  CIRCUIT_BREAKERS,
  RETRY_CONFIGS,
  recoverGitWorktree,
} from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface WorktreeConfig {
  repoPath: string;
  branch: string;
  worktreePath?: string;
  baseBranch?: string;
}

export interface Worktree {
  path: string;
  branch: string;
  repo: string;
  createdAt: string;
}

/**
 * Execute git command with error handling
 */
function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string | Buffer };
    const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString();
    throw new Error(`git ${args.join(' ')} failed: ${stderr || err.message || error}`);
  }
}

/**
 * Execute git command asynchronously
 */
function gitAsync(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
      } else {
        resolve((stdout as string).trim());
      }
    });
  });
}

/**
 * Git Worktree Handler
 */
export class GitWorktreeHandler {
  private worktreesBaseDir: string;
  private branchCache: LRUCache<string, boolean>;
  private repoCache: LRUCache<string, boolean>;
  private branchNameCache: LRUCache<string, string>;

  constructor(worktreesBaseDir?: string) {
    this.worktreesBaseDir = worktreesBaseDir || join(homedir(), '.rhaone-orchestrator', 'worktrees');
    if (!existsSync(this.worktreesBaseDir)) {
      mkdirSync(this.worktreesBaseDir, { recursive: true });
    }
    
    // Initialize LRU caches for performance
    this.branchCache = new LRUCache<string, boolean>({
      maxSize: 200,
      ttlMs: 30 * 1000, // 30 seconds - branches can change
    });
    
    this.repoCache = new LRUCache<string, boolean>({
      maxSize: 100,
      ttlMs: 5 * 60 * 1000, // 5 minutes - repo status rarely changes
    });
    
    this.branchNameCache = new LRUCache<string, string>({
      maxSize: 100,
      ttlMs: 60 * 60 * 1000, // 1 hour - branch names are stable
    });
  }

  /**
   * Check if a directory is a git repository - with caching
   */
  isGitRepo(path: string): boolean {
    // Check cache first
    const cached = this.repoCache.get(path);
    if (cached !== undefined) return cached;
    
    try {
      git(path, 'rev-parse', '--git-dir');
      this.repoCache.set(path, true);
      return true;
    } catch {
      this.repoCache.set(path, false);
      return false;
    }
  }

  /**
   * Get the current branch of a repo - with memoization
   */
  getCurrentBranch(repoPath: string): string {
    const cacheKey = `current:${repoPath}`;
    const cached = this.branchNameCache.get(cacheKey);
    if (cached) return cached;
    
    const branch = git(repoPath, 'branch', '--show-current');
    this.branchNameCache.set(cacheKey, branch);
    return branch;
  }

  /**
   * Check if a branch exists - with caching
   */
  branchExists(repoPath: string, branch: string): boolean {
    const cacheKey = `${repoPath}:${branch}`;
    const cached = this.branchCache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    try {
      git(repoPath, 'rev-parse', '--verify', `refs/heads/${branch}`);
      this.branchCache.set(cacheKey, true);
      return true;
    } catch {
      this.branchCache.set(cacheKey, false);
      return false;
    }
  }

  /**
   * Create a new branch for the worktree
   */
  createBranch(repoPath: string, branch: string, baseBranch?: string): void {
    if (this.branchExists(repoPath, branch)) {
      console.log(`[GitWorktree] Branch ${branch} already exists`);
      return;
    }

    const base = baseBranch || 'main';
    console.log(`[GitWorktree] Creating branch ${branch} from ${base}`);
    // Use --no-checkout to avoid checking out the branch in main repo
    // This allows creating a worktree for this branch
    git(repoPath, 'branch', '--no-checkout', branch, base);
  }

  /**
   * Create a new git worktree with comprehensive error handling
   */
  async create(config: WorktreeConfig): Promise<Worktree> {
    const { repoPath, branch, worktreePath } = config;

    const createOperation = async (): Promise<Worktree> => {
      // Validate repo
      if (!this.isGitRepo(repoPath)) {
        throw new Error(`Not a git repository: ${repoPath}`);
      }

      // Determine worktree path
      const targetPath = worktreePath || join(this.worktreesBaseDir, branch.replace(/\//g, '-'));

      // Check if worktree already exists
      if (existsSync(targetPath)) {
        console.log(`[GitWorktree] Worktree already exists at ${targetPath}`);
        return {
          path: targetPath,
          branch,
          repo: repoPath,
          createdAt: new Date().toISOString(),
        };
      }

      // Create branch if it doesn't exist
      this.createBranch(repoPath, branch);

      // Create parent directory
      const parentDir = dirname(targetPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      // Create worktree with retry and timeout
      console.log(`[GitWorktree] Creating worktree at ${targetPath} for branch ${branch}`);
      
      await withTimeout(
        () => withRetry(
          async () => {
            git(repoPath, 'worktree', 'add', targetPath, branch);
          },
          {
            operationName: 'git-worktree-add',
            ...RETRY_CONFIGS.GIT_WORKTREE,
          }
        )(),
        30000, // 30 second timeout
        { operationName: 'git-worktree-add' }
      );

      console.log(`[GitWorktree] Created worktree: ${targetPath}`);

      return {
        path: targetPath,
        branch,
        repo: repoPath,
        createdAt: new Date().toISOString(),
      };
    };

    try {
      // Use circuit breaker protection
      const cb = errorHandler.getCircuitBreaker(CIRCUIT_BREAKERS.GIT_WORKTREE);
      return await cb.execute(createOperation);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[GitWorktree] Create failed for ${branch}:`, err.message);

      // Attempt recovery
      const targetPath = worktreePath || join(this.worktreesBaseDir, branch.replace(/\//g, '-'));
      const recovered = await recoverGitWorktree(branch, targetPath, async () => {
        await createOperation();
      });

      if (recovered) {
        return {
          path: targetPath,
          branch,
          repo: repoPath,
          createdAt: new Date().toISOString(),
        };
      }

      throw error;
    }
  }

  /**
   * Destroy a git worktree
   */
  async destroy(worktreePath: string, repoPath: string, force = false): Promise<void> {
    if (!existsSync(worktreePath)) {
      console.log(`[GitWorktree] Worktree does not exist at ${worktreePath}`);
      return;
    }

    console.log(`[GitWorktree] Removing worktree at ${worktreePath}`);

    try {
      // Remove worktree from git
      const removeArgs: string[] = ['worktree', 'remove', worktreePath, ...(force ? ['--force'] : [])];
      git(repoPath, ...removeArgs);
    } catch (error) {
      console.error(`[GitWorktree] Failed to remove worktree: ${error}`);
      throw error;
    }
  }

  /**
   * Destroy a git worktree with comprehensive error handling
   */
  async destroyWithRetry(worktreePath: string, repoPath: string, force = false): Promise<void> {
    const destroyOperation = async () => {
      if (!existsSync(worktreePath)) {
        console.log(`[GitWorktree] Worktree does not exist at ${worktreePath}`);
        return;
      }

      console.log(`[GitWorktree] Removing worktree at ${worktreePath}`);

      // Remove worktree from git with retry and timeout
      const removeArgs: string[] = ['worktree', 'remove', worktreePath, ...(force ? ['--force'] : [])];
      await withTimeout(
        () => withRetry(
          async () => {
            git(repoPath, ...removeArgs);
          },
          {
            operationName: 'git-worktree-remove',
            ...RETRY_CONFIGS.GIT_WORKTREE,
          }
        )(),
        15000, // 15 second timeout
        { operationName: 'git-worktree-remove' }
      );
    };

    try {
      // Use circuit breaker protection
      const cb = errorHandler.getCircuitBreaker(CIRCUIT_BREAKERS.GIT_WORKTREE);
      return await cb.execute(destroyOperation);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[GitWorktree] Destroy failed for ${worktreePath}:`, err.message);

      // Attempt recovery
      const recovered = await recoverGitWorktree('', worktreePath, async () => {
        return await destroyOperation();
      });

      if (!recovered) {
        // Log but don't throw - destruction is best effort
        console.warn(`[GitWorktree] Could not destroy worktree ${worktreePath}, may need manual cleanup`);
      }
    }
  }

  /**
   * List all worktrees for a repository
   */
  list(repoPath: string): Worktree[] {
    try {
      const output = git(repoPath, 'worktree', 'list', '--json');
      const data = JSON.parse(output);
      
      return (data.worktrees || []).map((wt: { path: string; branch: string }) => ({
        path: wt.path,
        branch: wt.branch,
        repo: repoPath,
        createdAt: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get the default branch of a repository - with memoization
   */
  getDefaultBranch(repoPath: string): string {
    const cacheKey = `default:${repoPath}`;
    const cached = this.branchNameCache.get(cacheKey);
    if (cached) return cached;
    
    let result: string;
    try {
      // Try main first
      if (this.branchExists(repoPath, 'main')) result = 'main';
      // Try master
      else if (this.branchExists(repoPath, 'master')) result = 'master';
      // Try to get from remote HEAD
      else {
        const head = git(repoPath, 'symbolic-ref', 'refs/remotes/origin/HEAD');
        result = head.replace('refs/remotes/origin/', '');
      }
    } catch {
      result = 'main';
    }
    
    this.branchNameCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get status of a worktree - with memoization for expensive calculations
   */
  getStatus(worktreePath: string): { clean: boolean; ahead: number; behind: number } {
    // Use memoization for status calculations
    return this.getStatusMemoized(worktreePath);
  }
  
  /**
   * Memoized status calculation
   */
  private getStatusMemoized = memoize(
    (worktreePath: string): { clean: boolean; ahead: number; behind: number } => {
      try {
        const output = git(worktreePath, 'status', '--porcelain');
        const clean = output.trim() === '';

        // Get ahead/behind
        const revParse = git(worktreePath, 'rev-list', '--left-right', '--count', '@{upstream}...@')
          .split('\n');
        const ahead = parseInt(revParse[0] || '0', 10);
        const behind = parseInt(revParse[1] || '0', 10);

        return { clean, ahead, behind };
      } catch {
        return { clean: true, ahead: 0, behind: 0 };
      }
    },
    {
      maxSize: 100,
      ttlMs: 5000, // 5 second TTL for status
    }
  );

  /**
   * Fetch latest changes for a worktree with error handling
   */
  async fetch(worktreePath: string): Promise<void> {
    console.log(`[GitWorktree] Fetching updates for ${worktreePath}`);
    
    return withGracefulDegradation(
      async () => {
        await withTimeout(
          () => gitAsync(worktreePath, 'fetch', '--all'),
          60000, // 60 second timeout for fetch
          { operationName: 'git-fetch' }
        );
      },
      undefined,
      { 
        operationName: `git-fetch(${worktreePath})`,
        logError: true,
      }
    );
  }
}

export const gitWorktree = new GitWorktreeHandler();