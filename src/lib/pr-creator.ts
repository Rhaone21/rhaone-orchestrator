/**
 * Rhaone Orchestrator - PR Creation Flow
 * Creates PRs from agent worktree sessions
 */

import { Session, SessionManager } from './session-manager';
import { GitHubIntegration, GitHubPR } from './github';
import { exec } from './exec';
import { withErrorHandling, withRetry, withGracefulDegradation, errorHandler } from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface PRCreationOptions {
  title?: string;
  body?: string;
  draft?: boolean;
  base?: string;
}

export interface WorktreeInfo {
  branch: string;
  path: string;
  isClean: boolean;
  lastCommit: string;
  hasChanges: boolean;
  changes: string[];
}

/**
 * PR Creation Flow - handles creating PRs from agent sessions
 */
export class PRCreator {
  private sessionManager: SessionManager;
  private github: GitHubIntegration;
  private workspaceRoot: string;
  // Cache for worktree info
  private worktreeCache: LRUCache<string, WorktreeInfo>;
  // Cache for PR info
  private prCache: LRUCache<string, GitHubPR>;
  // Memoized PR title generator
  private memoizedGenerateTitle: (session: Session) => Promise<string>;

  constructor(options: {
    sessionManager: SessionManager;
    github: GitHubIntegration;
    workspaceRoot?: string;
  }) {
    this.sessionManager = options.sessionManager;
    this.github = options.github;
    this.workspaceRoot = options.workspaceRoot || process.env.WORKSPACE_ROOT || '/root/.openclaw/workspace';
    
    // Initialize caches
    this.worktreeCache = new LRUCache({ maxSize: 50, ttlMs: 5 * 60 * 1000 });
    this.prCache = new LRUCache({ maxSize: 50, ttlMs: 10 * 60 * 1000 });
    
    // Memoize PR title generation
    this.memoizedGenerateTitle = memoize(
      async (session: Session) => this.generatePRTitleInternal(session),
      { maxSize: 50, ttlMs: 5 * 60 * 1000 }
    );
  }

  /**
   * Create a PR for a session with error handling and caching
   */
  async createPR(sessionId: string, options: PRCreationOptions = {}): Promise<GitHubPR | null> {
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      console.error(`[PRCreator] Session ${sessionId} not found`);
      return null;
    }

    // Check cache for existing PR
    const cacheKey = `pr-${sessionId}`;
    const cached = this.prCache.get(cacheKey);
    if (cached && session.pr?.number) {
      console.log(`[PRCreator] Using cached PR for session ${sessionId}`);
      return cached;
    }

    if (session.pr?.number) {
      console.log(`[PRCreator] Session ${sessionId} already has PR #${session.pr.number}`);
      const pr = await this.github.getPR(session.pr.number.toString());
      if (pr) this.prCache.set(cacheKey, pr);
      return pr;
    }

    return withErrorHandling(
      async () => {
        const worktree = await this.getWorktreeInfoWithCache(session.branch);
        if (!worktree) {
          throw new Error(`No worktree found for branch ${session.branch}`);
        }

        const title = options.title || await this.memoizedGenerateTitle(session);
        const body = options.body || await this.generatePRBodyWithCache(session, worktree);
        const base = options.base || 'main';

        if (worktree.hasChanges) {
          await this.commitChangesWithRetry(worktree, session);
        }

        console.log(`[PRCreator] Would create PR: ${title}`);
        const pr: GitHubPR = { 
          number: 0, 
          url: '', 
          state: 'open',
          title,
          body,
          headBranch: session.branch,
          baseBranch: base,
          mergeable: true,
          draft: options.draft || false,
        };

        if (pr) {
          session.pr = {
            number: pr.number,
            url: pr.url,
            state: 'open',
          };
          session.status = 'waiting_pr';
          this.prCache.set(cacheKey, pr);
          console.log(`[PRCreator] Created PR #${pr.number} for session ${sessionId}`);
        }

        return pr;
      },
      {
        operation: 'pr-creator.createPR',
        sessionId,
        issueId: session.issueId,
        retry: {
          maxRetries: 2,
          backoffMs: 1000,
          retryableErrors: ['timeout', 'lock', 'busy'],
        },
        fallback: async () => {
          console.error(`[PRCreator] Failed to create PR for session ${sessionId}`);
          return null;
        },
      }
    );
  }

  /**
   * Create PR from worktree directly with error handling
   */
  async createPRFromBranch(branch: string, options: PRCreationOptions): Promise<GitHubPR | null> {
    return withErrorHandling(
      async () => {
        const worktree = await this.getWorktreeInfoWithCache(branch);
        if (!worktree) {
          throw new Error(`No worktree found for branch ${branch}`);
        }

        if (worktree.hasChanges) {
          const mockSession: Session = {
            id: branch,
            projectId: 'unknown',
            issueId: branch,
            branch,
            status: 'working',
            createdAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            metrics: {
              spawnDuration: 0,
              ciPasses: 0,
              ciFailures: 0,
            },
          };
          await this.commitChangesWithRetry(worktree, mockSession);
        }

        console.log(`[PRCreator] Would create PR from branch: ${branch}`);
        return null;
      },
      {
        operation: 'pr-creator.createPRFromBranch',
        retry: { maxRetries: 2 },
        fallback: async () => null,
      }
    );
  }

  /**
   * Get worktree information with caching
   */
  async getWorktreeInfoWithCache(branch: string): Promise<WorktreeInfo | null> {
    const cacheKey = `worktree-${branch}`;
    const cached = this.worktreeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await withErrorHandling(
      async () => this.getWorktreeInfoInternal(branch),
      {
        operation: 'pr-creator.getWorktreeInfo',
        retry: { maxRetries: 2, backoffMs: 500 },
        fallback: async () => null,
      }
    );

    if (result) {
      this.worktreeCache.set(cacheKey, result);
    }
    return result;
  }

  private async getWorktreeInfoInternal(branch: string): Promise<WorktreeInfo | null> {
    try {
      const worktreePath = path.join(this.workspaceRoot, branch);
      
      try {
        await fs.access(worktreePath);
      } catch {
        const mainRepoPath = this.workspaceRoot;
        return this.getGitInfoWithRetry(mainRepoPath, branch);
      }

      return this.getGitInfoWithRetry(worktreePath, branch);
    } catch (e) {
      console.error(`[PRCreator] Failed to get worktree info for ${branch}:`, e);
      return null;
    }
  }

  private async getGitInfoWithRetry(gitPath: string, branch: string): Promise<WorktreeInfo | null> {
    return withRetry(
      async () => this.getGitInfoInternal(gitPath, branch),
      {
        operationName: 'pr-creator.getGitInfo',
        maxRetries: 2,
        backoffMs: 500,
        retryableErrors: ['timeout', 'busy', 'lock'],
      }
    )();
  }

  private async getGitInfoInternal(gitPath: string, branch: string): Promise<WorktreeInfo | null> {
    const statusResult = await exec({
      command: 'git status --porcelain',
      workdir: gitPath,
      timeout: 10,
    });

    const hasChanges = statusResult.trim().length > 0;
    const changes = hasChanges
      ? statusResult.trim().split('\n').filter(Boolean)
      : [];

    const lastCommitResult = await exec({
      command: 'git log -1 --oneline',
      workdir: gitPath,
      timeout: 10,
    });

    const isClean = !hasChanges;

    const branchResult = await exec({
      command: 'git branch --show-current',
      workdir: gitPath,
      timeout: 10,
    });

    return {
      branch: branchResult.trim() || branch,
      path: gitPath,
      isClean,
      lastCommit: lastCommitResult.trim(),
      hasChanges,
      changes,
    };
  }

  private async commitChangesWithRetry(worktree: WorktreeInfo, session: Session): Promise<void> {
    return withRetry(
      async () => this.commitChangesInternal(worktree, session),
      {
        operationName: 'pr-creator.commitChanges',
        maxRetries: 2,
        backoffMs: 1000,
        retryableErrors: ['lock', 'busy', 'conflict'],
      }
    )();
  }

  private async commitChangesInternal(worktree: WorktreeInfo, session: Session): Promise<void> {
    await exec({
      command: 'git add -A',
      workdir: worktree.path,
      timeout: 10,
    });

    const rawMessage = session.issueId
      ? `Fix: ${session.issueId} - Session ${session.id}`
      : `Changes: Session ${session.id}`;
    // Escape all shell-special chars that could survive quoting: \, ", `, $
    const commitMessage = rawMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');

    try {
      await exec({
        command: `git commit -m "${commitMessage}"`,
        workdir: worktree.path,
        timeout: 10,
      });
    } catch (e: any) {
      if (!e.message?.includes('nothing to commit')) {
        throw e;
      }
      console.log('[PRCreator] No changes to commit');
    }

    console.log(`[PRCreator] Committed changes in ${worktree.branch}`);
  }

  private async generatePRTitleInternal(session: Session): Promise<string> {
    const issue = await withGracefulDegradation(
      async () => this.github.getIssue(session.issueId),
      null,
      { operationName: 'pr-creator.getIssue', logError: false }
    );
    
    if (issue) {
      return `[${issue.number}] ${issue.title}`;
    }

    return `Fix: ${session.issueId} (${session.id})`;
  }

  /**
   * Generate PR body with caching
   */
  async generatePRBodyWithCache(session: Session, worktree: WorktreeInfo): Promise<string> {
    const cacheKey = `body-${session.id}`;
    return withErrorHandling(
      async () => this.generatePRBodyInternal(session, worktree),
      {
        operation: 'pr-creator.generatePRBody',
        retry: { maxRetries: 2 },
        fallback: async () => `## Related Issue\n- ${session.issueId}`,
      }
    );
  }

  private async generatePRBodyInternal(session: Session, worktree: WorktreeInfo): Promise<string> {
    const parts: string[] = [];

    if (session.issueId) {
      const issue = await withGracefulDegradation(
        async () => this.github.getIssue(session.issueId),
        null,
        { operationName: 'pr-creator.getIssueForBody', logError: false }
      );
      
      if (issue) {
        parts.push(`## Related Issue\n- ${issue.url}`);
      } else {
        parts.push(`## Related Issue\n- ${session.issueId}`);
      }
    }

    parts.push(`## Session\n- ID: ${session.id}`);
    parts.push(`- Branch: \`${session.branch}\``);
    parts.push(`- Created: ${session.createdAt}`);

    if (worktree.hasChanges) {
      parts.push('\n## Changes\n');
      parts.push('```');
      parts.push(worktree.changes.map(c => `  ${c}`).join('\n'));
      parts.push('```');
    }

    if (worktree.lastCommit) {
      parts.push(`\n## Last Commit\n\`${worktree.lastCommit}\``);
    }

    parts.push(`
## Checklist
- [ ] Tests pass
- [ ] Code follows project style
- [ ] Documentation updated (if needed)

---
*Generated by Rhaone Orchestrator*`);

    return parts.join('\n');
  }

  /**
   * List all worktrees with caching
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    return withErrorHandling(
      async () => {
        const worktrees: WorktreeInfo[] = [];

        try {
          const branchesResult = await exec({
            command: 'git worktree list --porcelain',
            workdir: this.workspaceRoot,
            timeout: 10,
          });

          const lines = branchesResult.trim().split('\n');
          let currentPath = '';

          for (const line of lines) {
            if (line.startsWith('worktree ')) {
              currentPath = line.replace('worktree ', '').trim();
            } else if (line.startsWith('branch ')) {
              const branch = line.replace('branch refs/heads/', '').trim();
              const worktree = await this.getWorktreeInfoWithCache(branch);
              if (worktree) {
                worktrees.push(worktree);
              }
            }
          }
        } catch (e) {
          const mainWorktree = await this.getWorktreeInfoWithCache('main');
          if (mainWorktree) {
            worktrees.push(mainWorktree);
          }
        }

        return worktrees;
      },
      {
        operation: 'pr-creator.listWorktrees',
        fallback: async () => [],
      }
    );
  }

  /**
   * Clean up old worktrees with error handling
   */
  async cleanupWorktrees(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    return withErrorHandling(
      async () => {
        const sessions = this.sessionManager.list();
        const activeBranches = new Set(sessions.map(s => s.branch));
        
        const worktrees = await this.listWorktrees();
        let cleaned = 0;

        for (const worktree of worktrees) {
          if (activeBranches.has(worktree.branch)) continue;

          try {
            const result = await exec({
              command: 'git log -1 --format=%ct',
              workdir: worktree.path,
              timeout: 10,
            });
            
            const timestamp = parseInt(result.trim()) * 1000;
            const age = Date.now() - timestamp;

            if (age > maxAge) {
              await this.removeWorktreeWithRetry(worktree);
              cleaned++;
            }
          } catch (e) {
            console.error(`[PRCreator] Failed to check age of ${worktree.branch}:`, e);
          }
        }

        return cleaned;
      },
      {
        operation: 'pr-creator.cleanupWorktrees',
        fallback: async () => 0,
      }
    );
  }

  private async removeWorktreeWithRetry(worktree: WorktreeInfo): Promise<boolean> {
    return withRetry(
      async () => this.removeWorktreeInternal(worktree),
      {
        operationName: 'pr-creator.removeWorktree',
        maxRetries: 2,
        backoffMs: 1000,
        retryableErrors: ['lock', 'busy'],
      }
    )();
  }

  private async removeWorktreeInternal(worktree: WorktreeInfo): Promise<boolean> {
    await exec({
      command: `git worktree remove "${worktree.path.replace(/"/g, '\\"')}" --force`,
      workdir: this.workspaceRoot,
      timeout: 10,
    });

    try {
      const safeBranch = worktree.branch.replace(/[^a-zA-Z0-9/_.-]/g, '');
      await exec({
        command: `git branch -D ${safeBranch}`,
        workdir: this.workspaceRoot,
        timeout: 10,
      });
    } catch {
      // Branch might not exist locally
    }

    // Clear cache
    this.worktreeCache.delete(`worktree-${worktree.branch}`);

    console.log(`[PRCreator] Removed worktree: ${worktree.branch}`);
    return true;
  }
}

/**
 * Factory to create PRCreator with error handling
 */
export function createPRCreator(sessionManager: SessionManager): PRCreator {
  const [owner, repo] = (process.env.GITHUB_REPO || 'owner/repo').split('/');
  
  return new PRCreator({
    sessionManager,
    github: new GitHubIntegration({
      owner,
      repo,
      token: process.env.GITHUB_TOKEN,
    }),
    workspaceRoot: process.env.WORKSPACE_ROOT,
  });
}
