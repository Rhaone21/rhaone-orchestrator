/**
 * Rhaone Orchestrator - GitHub Integration
 * PR/CI monitoring via gh CLI with error handling and retry logic
 */

import { exec } from './exec';
import { 
  withRetry, 
  withErrorHandling, 
  withGracefulDegradation,
  errorHandler 
} from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';
import { Session } from './session-manager';

// Cache for API responses
const apiCache = new LRUCache<string, any>({ maxSize: 100, ttlMs: 60 * 1000 });

// Memoized issue number extractor
const memoizedExtractIssueNumber = memoize(
  (issueRef: string) => {
    const match = issueRef.match(/(?:GH-?|#)?(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  },
  { maxSize: 50 }
);

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  headBranch: string;
  baseBranch: string;
  url: string;
  mergeable: boolean;
  draft: boolean;
}

export interface CIStatus {
  state: 'pending' | 'success' | 'failure' | 'cancelled' | 'error';
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  checks: CICheck[];
}

export interface CICheck {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | null;
  url: string;
}

export interface Review {
  id: number;
  author: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING';
  body: string;
  submittedAt: string;
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  token?: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  headBranch: string;
  headSha: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export class GitHubIntegration {
  private owner: string;
  private repo: string;
  private token?: string;
  private circuitBreakerId: string;
  private cache: LRUCache<string, any>;

  constructor(config: GitHubConfig) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.token = config.token || process.env.GITHUB_TOKEN;
    this.circuitBreakerId = `github-${this.owner}-${this.repo}`;
    
    // Initialize instance cache
    this.cache = new LRUCache({ maxSize: 50, ttlMs: 30 * 1000 });
    
    errorHandler.getCircuitBreaker(this.circuitBreakerId, {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      successThreshold: 2,
    });
  }

  private async runGh(args: string[]): Promise<string> {
    const env: Record<string, string> = this.token ? { GITHUB_TOKEN: this.token } : {};
    const command = ['gh', ...args, '--repo', `${this.owner}/${this.repo}`].join(' ');
    
    return withErrorHandling(
      async () => {
        return await exec({
          command,
          env,
          timeout: 30,
          retry: true,
          maxRetries: 2,
        });
      },
      {
        operation: `gh ${args[0]} ${args[1] || ''}`,
        useCircuitBreaker: this.circuitBreakerId,
        retry: {
          maxRetries: 3,
          backoffMs: 2000,
          backoffMultiplier: 2,
          maxBackoffMs: 30000,
          retryableErrors: ['rate limit', 'timeout', '500', '502', '503', '504', 'ECONNRESET'],
        },
      }
    );
  }

  private async runGhJson<T>(args: string[], jsonFields: string[]): Promise<T> {
    const output = await this.runGh([...args, '--json', jsonFields.join(',')]);
    return JSON.parse(output) as T;
  }

  private extractIssueNumber(issueRef: string): number | null {
    return memoizedExtractIssueNumber(issueRef);
  }

  private mapStatusState(state: string): CIStatus['state'] {
    switch (state.toUpperCase()) {
      case 'SUCCESS': return 'success';
      case 'FAILURE': return 'failure';
      case 'PENDING': return 'pending';
      case 'CANCELLED': return 'cancelled';
      default: return 'error';
    }
  }

  async getIssue(issueRef: string, useCache = true): Promise<GitHubIssue | null> {
    const issueNum = this.extractIssueNumber(issueRef);
    if (!issueNum) return null;

    // Check cache
    const cacheKey = `issue-${issueNum}`;
    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        console.log(`[GitHub] Cache hit for issue #${issueNum}`);
        return cached as GitHubIssue;
      }
    }

    return withGracefulDegradation(
      async () => {
        const data = await this.runGhJson<{
          number: number;
          title: string;
          body: string;
          state: string;
          labels: { name: string }[];
          url: string;
        }>(['issue', 'view', issueNum.toString()], ['number', 'title', 'body', 'state', 'labels', 'url']);

        const result = {
          number: data.number,
          title: data.title,
          body: data.body,
          state: data.state as 'open' | 'closed',
          labels: data.labels.map(l => l.name),
          url: data.url,
        };

        // Cache result
        if (useCache) {
          this.cache.set(cacheKey, result);
        }

        return result;
      },
      null,
      { operationName: `getIssue(${issueRef})`, logError: true }
    );
  }

  async getPR(branchOrNumber: string, useCache = true): Promise<GitHubPR | null> {
    const prNum = parseInt(branchOrNumber);
    const cacheKey = `pr-${isNaN(prNum) ? branchOrNumber : prNum}`;
    
    // Check cache
    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        console.log(`[GitHub] Cache hit for PR ${branchOrNumber}`);
        return cached as GitHubPR;
      }
    }
    
    return withGracefulDegradation(
      async () => {
        const data = await this.runGhJson<{
          number: number;
          title: string;
          body: string;
          state: string;
          headRefName: string;
          baseRefName: string;
          url: string;
          mergeable: boolean;
          isDraft: boolean;
        }>(['pr', 'view', isNaN(prNum) ? branchOrNumber : prNum.toString()], ['number', 'title', 'body', 'state', 'headRefName', 'baseRefName', 'url', 'mergeable', 'isDraft']);

        const result = {
          number: data.number,
          title: data.title,
          body: data.body,
          state: data.state as 'open' | 'closed' | 'merged',
          headBranch: data.headRefName,
          baseBranch: data.baseRefName,
          url: data.url,
          mergeable: data.mergeable,
          draft: data.isDraft,
        };

        // Cache result
        if (useCache) {
          this.cache.set(cacheKey, result);
        }

        return result;
      },
      null,
      { operationName: `getPR(${branchOrNumber})`, logError: true }
    );
  }

  async getCIStatus(prNumber: number, useCache = false): Promise<CIStatus> {
    const cacheKey = `ci-${prNumber}`;
    
    // Check cache (CI status changes frequently, so cache is optional)
    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        console.log(`[GitHub] Cache hit for CI status #${prNumber}`);
        return cached as CIStatus;
      }
    }

    return withGracefulDegradation(
      async () => {
        const statusData = await this.runGhJson<{
          state: string;
          contexts: {
            context: string;
            state: string;
            targetUrl?: string;
          }[];
        }>(['pr', 'checks', prNumber.toString()], ['state', 'contexts']);

        const checks: CICheck[] = statusData.contexts.map(c => ({
          name: c.context,
          status: c.state === 'COMPLETED' ? 'completed' : 
                  c.state === 'IN_PROGRESS' ? 'in_progress' : 'queued',
          conclusion: c.state === 'SUCCESS' ? 'success' :
                      c.state === 'FAILURE' ? 'failure' :
                      c.state === 'SKIPPED' ? 'skipped' : null,
          url: c.targetUrl || '',
        }));

        const passedChecks = checks.filter(c => c.conclusion === 'success').length;
        const failedChecks = checks.filter(c => c.conclusion === 'failure').length;

        const result = {
          state: this.mapStatusState(statusData.state),
          totalChecks: checks.length,
          passedChecks,
          failedChecks,
          checks,
        };

        // Cache result (only if explicitly requested)
        if (useCache) {
          this.cache.set(cacheKey, result);
        }

        return result;
      },
      {
        state: 'error',
        totalChecks: 0,
        passedChecks: 0,
        failedChecks: 0,
        checks: [],
      },
      { operationName: `getCIStatus(${prNumber})`, logError: true }
    );
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[GitHub] Cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size(),
      maxSize: this.cache.getMaxSize(),
    };
  }

  async getWorkflowRuns(branch: string, limit = 5): Promise<WorkflowRun[]> {
    return withGracefulDegradation(
      async () => {
        const data = await this.runGhJson<{
          workflow_runs: {
            id: number;
            name: string;
            status: string;
            conclusion: string | null;
            head_branch: string;
            head_sha: string;
            url: string;
            created_at: string;
            updated_at: string;
          }[];
        }>(['run', 'list', '--branch', branch, '-L', limit.toString()], ['id', 'name', 'status', 'conclusion', 'headBranch', 'headSha', 'url', 'createdAt', 'updatedAt']);

        return data.workflow_runs.map(run => ({
          id: run.id,
          name: run.name,
          status: run.status as WorkflowRun['status'],
          conclusion: run.conclusion as WorkflowRun['conclusion'],
          headBranch: run.head_branch,
          headSha: run.head_sha,
          url: run.url,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
        }));
      },
      [],
      { operationName: `getWorkflowRuns(${branch})` }
    );
  }

  /**
   * Get all reviews for a PR
   */
  async getReviews(prNumber: number): Promise<Review[]> {
    return withGracefulDegradation(
      async () => {
        const data = await this.runGhJson<{
          id: number;
          author: { login: string };
          state: string;
          body: string;
          submittedAt: string;
        }[]>(['pr', 'view', prNumber.toString(), '--json', 'reviews', '-q', '.reviews'], ['reviews']);

        return data.map((r) => ({
          id: r.id,
          author: r.author?.login || 'unknown',
          state: r.state as Review['state'],
          body: r.body,
          submittedAt: r.submittedAt,
        }));
      },
      [],
      { operationName: `getReviews(${prNumber})` }
    );
  }
}
