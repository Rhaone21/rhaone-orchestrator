/**
 * Rhaone Orchestrator - Recovery Strategies
 * Pre-defined recovery strategies for common failure scenarios
 */

import { recoveryStrategies, errorHandler } from './error-handler';
import type { RecoveryStrategy } from './error-handler';

// ==================== Recovery Action Types ====================

export interface RecoveryAction {
  name: string;
  description: string;
  execute: () => Promise<boolean>;
  priority: number; // Lower = higher priority
  maxAttempts: number;
}

export interface RecoveryPlan {
  actions: RecoveryAction[];
  fallback?: () => Promise<void>;
  onComplete?: (success: boolean) => void;
}

// ==================== Session Recovery Strategies ====================

/**
 * Recovery strategy for session spawn failures
 */
export async function recoverSessionSpawn(
  sessionId: string,
  retryFn: () => Promise<void>
): Promise<boolean> {
  const strategies: RecoveryAction[] = [
    {
      name: 'retry-with-delay',
      description: 'Retry session spawn with exponential backoff',
      execute: async () => {
        await new Promise(r => setTimeout(r, 2000));
        try {
          await retryFn();
          return true;
        } catch {
          return false;
        }
      },
      priority: 1,
      maxAttempts: 2,
    },
    {
      name: 'reset-circuit-breaker',
      description: 'Reset session spawn circuit breaker',
      execute: async () => {
        errorHandler.resetCircuitBreaker('session-spawn');
        await new Promise(r => setTimeout(r, 1000));
        try {
          await retryFn();
          return true;
        } catch {
          return false;
        }
      },
      priority: 2,
      maxAttempts: 1,
    },
    {
      name: 'cleanup-and-retry',
      description: 'Clean up resources and retry',
      execute: async () => {
        // Cancel any pending recoveries for this session
        errorHandler.cancelPendingRecoveries(sessionId);
        await new Promise(r => setTimeout(r, 3000));
        try {
          await retryFn();
          return true;
        } catch {
          return false;
        }
      },
      priority: 3,
      maxAttempts: 1,
    },
  ];

  return executeRecoveryPlan(strategies);
}

/**
 * Recovery strategy for git worktree failures
 */
export async function recoverGitWorktree(
  branch: string,
  worktreePath: string,
  retryFn: () => Promise<void>
): Promise<boolean> {
  const strategies: RecoveryAction[] = [
    {
      name: 'wait-for-lock',
      description: 'Wait for git lock to be released',
      execute: async () => {
        await new Promise(r => setTimeout(r, 2000));
        try {
          await retryFn();
          return true;
        } catch {
          return false;
        }
      },
      priority: 1,
      maxAttempts: 3,
    },
    {
      name: 'force-cleanup',
      description: 'Force remove existing worktree and retry',
      execute: async () => {
        try {
          const { execSync } = await import('child_process');
          // Try to force remove the worktree
          execSync(`git worktree remove -f "${worktreePath}"`, { stdio: 'ignore' });
        } catch {
          // Ignore cleanup errors
        }
        await new Promise(r => setTimeout(r, 1000));
        try {
          await retryFn();
          return true;
        } catch {
          return false;
        }
      },
      priority: 2,
      maxAttempts: 1,
    },
    {
      name: 'manual-cleanup',
      description: 'Manually remove worktree directory and prune',
      execute: async () => {
        try {
          const { rmSync, existsSync } = await import('fs');
          const { execSync } = await import('child_process');
          
          if (existsSync(worktreePath)) {
            rmSync(worktreePath, { recursive: true, force: true });
          }
          
          // Prune worktrees
          execSync('git worktree prune', { stdio: 'ignore' });
        } catch {
          // Ignore cleanup errors
        }
        await new Promise(r => setTimeout(r, 1000));
        try {
          await retryFn();
          return true;
        } catch {
          return false;
        }
      },
      priority: 3,
      maxAttempts: 1,
    },
  ];

  return executeRecoveryPlan(strategies);
}

/**
 * Recovery strategy for Telegram send failures
 */
export async function recoverTelegramSend(
  retryFn: () => Promise<void>
): Promise<boolean> {
  const strategies: RecoveryAction[] = [
    {
      name: 'retry-with-backoff',
      description: 'Retry with exponential backoff',
      execute: async () => {
        // Exponential backoff: 1s, 2s, 4s
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
          try {
            await retryFn();
            return true;
          } catch {
            continue;
          }
        }
        return false;
      },
      priority: 1,
      maxAttempts: 1,
    },
    {
      name: 'reset-circuit-breaker',
      description: 'Reset Telegram circuit breaker',
      execute: async () => {
        errorHandler.resetCircuitBreaker('telegram-send');
        await new Promise(r => setTimeout(r, 5000));
        try {
          await retryFn();
          return true;
        } catch {
          return false;
        }
      },
      priority: 2,
      maxAttempts: 1,
    },
  ];

  return executeRecoveryPlan(strategies);
}

/**
 * Recovery strategy for config parsing failures
 */
export async function recoverConfigParse(
  configPath: string,
  retryFn: () => Promise<void>
): Promise<boolean> {
  const strategies: RecoveryAction[] = [
    {
      name: 'retry-read',
      description: 'Retry reading config file',
      execute: async () => {
        await new Promise(r => setTimeout(r, 500));
        try {
          await retryFn();
          return true;
        } catch {
          return false;
        }
      },
      priority: 1,
      maxAttempts: 2,
    },
    {
      name: 'use-default-config',
      description: 'Fall back to default configuration',
      execute: async () => {
        console.log(`[ConfigRecovery] Using default config for ${configPath}`);
        // Default config is already handled by the caller
        return true;
      },
      priority: 2,
      maxAttempts: 1,
    },
  ];

  return executeRecoveryPlan(strategies);
}

// ==================== Recovery Plan Executor ====================

async function executeRecoveryPlan(actions: RecoveryAction[]): Promise<boolean> {
  // Sort by priority
  const sorted = [...actions].sort((a, b) => a.priority - b.priority);

  for (const action of sorted) {
    console.log(`[Recovery] Attempting: ${action.name} - ${action.description}`);

    for (let attempt = 1; attempt <= action.maxAttempts; attempt++) {
      try {
        const success = await action.execute();
        if (success) {
          console.log(`[Recovery] Success: ${action.name}`);
          return true;
        }
      } catch (error) {
        console.error(`[Recovery] ${action.name} failed (attempt ${attempt}):`, error);
      }
    }
  }

  console.error('[Recovery] All recovery strategies failed');
  return false;
}

// ==================== Pre-registered Recovery Strategies ====================

export function registerRecoveryStrategies(): void {
  // Register session spawn recovery
  recoveryStrategies.register('session-spawn', async () => {
    console.log('[Recovery] Executing session-spawn recovery');
    // This is a placeholder - actual recovery requires context
    return;
  });

  // Register git worktree recovery
  recoveryStrategies.register('git-worktree', async () => {
    console.log('[Recovery] Executing git-worktree recovery');
    return;
  });

  // Register Telegram send recovery
  recoveryStrategies.register('telegram-send', async () => {
    console.log('[Recovery] Executing telegram-send recovery');
    return;
  });

  // Register config parse recovery
  recoveryStrategies.register('config-parse', async () => {
    console.log('[Recovery] Executing config-parse recovery');
    return;
  });
}