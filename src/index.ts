/**
 * Rhaone Orchestrator - Main Entry Point
 * Phase 1: Basic session management, Git worktrees, Telegram notifications
 * Phase 2: Scheduling, notifications, multi-project support
 * Phase 3: Learning engine with metrics, patterns, and recommendations
 * Phase 4: Batch operations, task decomposition, dependencies, resource management
 */

import { SessionManager, SessionManagerOptions } from './lib/session-manager';
import { GitHubIntegration, GitHubConfig } from './lib/github';
import { OptimizedCIPoller as CIPoller } from './lib/ci-poller';
import { LifecycleManager } from './lib/lifecycle-manager';
import { PRCreator } from './lib/pr-creator';
import { TelegramHandler } from './lib/telegram-handler';
import { exec } from './lib/exec';

// Phase 1 exports
export { SessionManager, sessionManager } from './lib/session-manager';
export type { SessionManagerOptions } from './lib/session-manager';

export { GitWorktreeHandler, gitWorktree } from './lib/git-worktree';
export type { WorktreeConfig } from './lib/git-worktree';

export { TelegramNotifier, telegram } from './lib/telegram-notifier';
export type { TelegramConfig } from './lib/telegram-notifier';

// Config
export { loadConfig, loadGlobalConfig, loadProjectConfig } from './lib/config';
export type { GlobalConfig, ProjectConfig, Config } from './lib/config';

// Phase 2 exports
export { GitHubIntegration } from './lib/github';
export type { 
  GitHubIssue, 
  GitHubPR, 
  GitHubConfig,
  CIStatus, 
  CICheck,
  Review, 
  WorkflowRun 
} from './lib/github';

export type { 
  CIEvent, 
  CIEventType 
} from './lib/ci-poller';

export { LifecycleManager } from './lib/lifecycle-manager';
export type { 
  LifecycleEvent, 
  LifecycleEventType, 
  ReactionConfig 
} from './lib/lifecycle-manager';

export { PRCreator } from './lib/pr-creator';
export type { 
  PRCreationOptions, 
  WorktreeInfo 
} from './lib/pr-creator';

export { TelegramHandler } from './lib/telegram-handler';

// Exec utilities
export { exec } from './lib/exec';
export type { ExecOptions, ExecResult } from './lib/exec';

// Phase 4 - Advanced Features (classes only, not singletons)
export { BatchSpawner } from './lib/batch-spawner';
export { TaskDecomposer } from './lib/task-decomposer';
export { DependencyResolver } from './lib/dependency-resolver';
export { ResourceManager } from './lib/resource-manager';
export { Orchestrator } from './lib/orchestrator';

// Phase 5 - Performance & Error Handling
export { ErrorHandler, errorHandler } from './lib/error-handler';
export { OptimizedCIPoller as CIPoller } from './lib/ci-poller';
export {
  OptimizedCache,
  LRUCache,
  BatchProcessor,
  debounce,
  throttle,
  memoize,
  asyncMemoize,
  createCache,
} from './lib/performance-optimizer';

// Phase 4 - Types and Interfaces
export type { 
  BatchSpawnConfig, 
  BatchIssueConfig, 
  BatchSpawnResult, 
  BatchSessionResult,
  BatchProgressEvent,
  BatchStatus,
  BatchSpawnStats,
} from './lib/batch-spawner';

export type {
  DecomposedTask,
  Subtask,
  TaskDecompositionConfig
} from './lib/task-decomposer';

export type {
  DependencyNode,
  DependencyGraph,
  ExecutionPlan,
  Phase
} from './lib/dependency-resolver';

export type {
  ResourceConfig,
  AgentSlot,
  ResourceUsage,
  ResourceReservation,
} from './lib/resource-manager';

export type {
  OrchestratorConfig,
  OrchestratedTask,
  OrchestratorStatus,
} from './lib/orchestrator';

// Learning Engine (Phase 3)
export { 
  LearningEngine, 
  learningEngine, 
  createLearningEngine,
  LearningStorage,
  PatternAnalyzer,
  RecommendationEngine,
  InsightsGenerator,
  MetricsCollector,
  metricsCollector,
  createMetricsCollector
} from './learning';

export type {
  SessionMetrics,
  AgentMetrics,
  Pattern,
  Recommendation,
  InsightsReport,
  LearningConfig,
  PatternType,
  InsightType,
  RecommendationPriority,
  Insight,
  TaskType,
  ModelPerformance,
  SessionStatus,
  MetricsCollectorConfig,
  SessionStartData,
  SessionUpdateData
} from './learning';

// Phase 6 - Lineage Tracking
export { LineageTracker } from './lib/lineage-tracker';
export type { TaskLineage, LineageTree, LineageNode } from './lib/lineage-tracker';
export type { SessionLineage } from './lib/session-manager';

// Phase 5 - Types
export type {
  ErrorSeverity,
  ErrorCategory,
  ErrorContext,
  RecoveryStrategy,
  ErrorRecord,
  ErrorHandlerConfig,
} from './lib/error-handler';

export type {
  OptimizedCacheOptions,
  CacheOptions,
  PerformanceMetrics,
} from './lib/performance-optimizer';

export type {
  OptimizedCIPollerConfig,
} from './lib/ci-poller';

// Global orchestrator instance for simple usage
let globalOrchestrator: ReturnType<typeof init> | null = null;

/**
 * Initialize the orchestrator with Phase 2 components
 */
export function init(config?: {
  github?: GitHubConfig;
  dataDir?: string;
  pollInterval?: number;
  allowedChatIds?: string[];
}): {
  sessionManager: SessionManager;
  github: GitHubIntegration;
  ciPoller: CIPoller;
  lifecycleManager: LifecycleManager;
  prCreator: PRCreator;
  telegramHandler?: TelegramHandler;
} {
  const sessionManager = new SessionManager({ dataDir: config?.dataDir });
  
  const github = new GitHubIntegration(config?.github || {
    owner: process.env.GITHUB_OWNER || 'owner',
    repo: process.env.GITHUB_REPO || 'repo',
    token: process.env.GITHUB_TOKEN,
  });

  const ciPoller = new CIPoller({
    sessionManager,
    github,
    pollInterval: config?.pollInterval,
  });

  const lifecycleManager = new LifecycleManager({
    sessionManager,
    github,
    ciPoller,
  });

  const prCreator = new PRCreator({
    sessionManager,
    github,
  });

  let telegramHandler: TelegramHandler | undefined;
  
  if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramHandler = new TelegramHandler({
      sessionManager,
      lifecycleManager,
      github,
      ciPoller,
    });
  }

  globalOrchestrator = {
    sessionManager,
    github,
    ciPoller,
    lifecycleManager,
    prCreator,
    telegramHandler,
  };

  return globalOrchestrator;
}

/**
 * Run a task with the orchestrator
 */
export async function runTask(
  issueId: string,
  task: string,
  options?: {
    projectId?: string;
    autoCreatePR?: boolean;
  }
): Promise<{
  sessionId: string;
  branch: string;
  status: string;
}> {
  if (!globalOrchestrator) {
    globalOrchestrator = init();
  }

  const session = await globalOrchestrator.sessionManager.create({
    projectId: options?.projectId || 'default',
    issueId,
    task,
  });

  return {
    sessionId: session.id,
    branch: session.branch,
    status: session.status,
  };
}

/**
 * Cleanup a task/session
 */
export async function cleanupTask(sessionId: string): Promise<boolean> {
  if (!globalOrchestrator) {
    throw new Error('Orchestrator not initialized');
  }

  await globalOrchestrator.sessionManager.complete(sessionId);
  return true;
}

/**
 * Get the current status of the orchestrator
 */
export function status(): {
  initialized: boolean;
  sessions: {
    total: number;
    active: number;
    pending: number;
    completed: number;
  };
  polling: {
    active: boolean;
    sessions: string[];
  };
} {
  if (!globalOrchestrator) {
    return {
      initialized: false,
      sessions: { total: 0, active: 0, pending: 0, completed: 0 },
      polling: { active: false, sessions: [] },
    };
  }

  const sessions = globalOrchestrator.sessionManager.list();
  const pollingStatus = globalOrchestrator.ciPoller.getPollingStatus();

  return {
    initialized: true,
    sessions: {
      total: sessions.length,
      active: sessions.filter(s => s.status === 'working').length,
      pending: sessions.filter(s => s.status === 'pending').length,
      completed: sessions.filter(s => s.status === 'completed').length,
    },
    polling: {
      active: pollingStatus.length > 0,
      sessions: pollingStatus.map(p => p.sessionId),
    },
  };
}