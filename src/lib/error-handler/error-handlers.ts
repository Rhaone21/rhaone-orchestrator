/**
 * Rhaone Orchestrator - Error Handler Wrappers
 * Pre-configured error handling wrappers for critical paths
 */

import {
  errorHandler,
  withErrorHandling,
  withRetry,
  withCircuitBreaker,
  withGracefulDegradation,
  withTimeout,
  CircuitBreakerOpenError,
  RetryableError,
  NonRetryableError,
  RecoveryStrategies,
  Bulkhead,
  type ErrorCategory,
  type ErrorContext,
  type RecoveryStrategy,
  type CircuitBreakerConfig,
  type RetryOptions,
} from './error-handler';

// ==================== Circuit Breaker Configurations ====================

export const CIRCUIT_BREAKERS = {
  SESSION_SPAWN: 'session-spawn',
  GIT_WORKTREE: 'git-worktree',
  TELEGRAM_SEND: 'telegram-send',
  CONFIG_PARSE: 'config-parse',
  GITHUB_API: 'github-api',
  CI_POLLER: 'ci-poller',
} as const;

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxCalls: 3,
  successThreshold: 2,
};

const STRICT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 60000,
  halfOpenMaxCalls: 1,
  successThreshold: 2,
};

const LENIENT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 10,
  resetTimeoutMs: 15000,
  halfOpenMaxCalls: 5,
  successThreshold: 1,
};

// ==================== Retry Configurations ====================

export const RETRY_CONFIGS = {
  SESSION_SPAWN: {
    maxRetries: 2,
    backoffMs: 1000,
    backoffMultiplier: 2,
    maxBackoffMs: 10000,
    retryableErrors: ['timeout', 'ECONNRESET', 'EAI_AGAIN', 'temporary', 'spawn'],
  },
  GIT_WORKTREE: {
    maxRetries: 2,
    backoffMs: 500,
    backoffMultiplier: 1.5,
    maxBackoffMs: 5000,
    retryableErrors: ['lock', 'busy', 'timeout', 'unable to access', 'worktree'],
  },
  TELEGRAM_SEND: {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    maxBackoffMs: 30000,
    retryableErrors: ['timeout', 'ECONNRESET', 'ETIMEDOUT', '429', 'rate limit'],
  },
  CONFIG_PARSE: {
    maxRetries: 0, // Config parsing is not retryable
    backoffMs: 0,
    backoffMultiplier: 1,
    maxBackoffMs: 0,
    retryableErrors: [],
  },
  GITHUB_API: {
    maxRetries: 3,
    backoffMs: 5000,
    backoffMultiplier: 2,
    maxBackoffMs: 60000,
    retryableErrors: ['rate limit', 'abuse', 'timeout', '500', '502', '503', '504', '429'],
  },
  NETWORK: {
    maxRetries: 5,
    backoffMs: 2000,
    backoffMultiplier: 2,
    maxBackoffMs: 60000,
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'],
  },
} as const;

// ==================== Error Context Builders ====================

export function createSessionContext(
  sessionId: string,
  issueId?: string,
  metadata?: Record<string, unknown>
): ErrorContext {
  return {
    operation: 'session-spawn',
    sessionId,
    issueId,
    metadata,
  };
}

export function createGitContext(
  operation: string,
  branch?: string,
  repoPath?: string,
  metadata?: Record<string, unknown>
): ErrorContext {
  return {
    operation,
    metadata: {
      branch,
      repoPath,
      ...metadata,
    },
  };
}

export function createTelegramContext(
  chatId?: string,
  messageType?: string,
  metadata?: Record<string, unknown>
): ErrorContext {
  return {
    operation: 'telegram-send',
    metadata: {
      chatId,
      messageType,
      ...metadata,
    },
  };
}

export function createConfigContext(
  configPath?: string,
  configType?: 'global' | 'project',
  metadata?: Record<string, unknown>
): ErrorContext {
  return {
    operation: 'config-parse',
    metadata: {
      configPath,
      configType,
      ...metadata,
    },
  };
}

// ==================== Specialized Error Handlers ====================

/**
 * Handle session spawn errors with circuit breaker and retry
 */
export async function handleSessionSpawn<T>(
  operation: () => Promise<T>,
  sessionId: string,
  issueId?: string,
  options?: {
    useCircuitBreaker?: boolean;
    fallback?: () => Promise<T>;
  }
): Promise<T> {
  const context = createSessionContext(sessionId, issueId);

  try {
    let fn = operation;

    // Apply circuit breaker
    if (options?.useCircuitBreaker !== false) {
      const cb = errorHandler.getCircuitBreaker(
        CIRCUIT_BREAKERS.SESSION_SPAWN,
        DEFAULT_CIRCUIT_CONFIG
      );
      fn = () => cb.execute(operation);
    }

    // Apply retry logic
    return await withRetry(fn, {
      operationName: 'session-spawn',
      maxRetries: RETRY_CONFIGS.SESSION_SPAWN.maxRetries,
      backoffMs: RETRY_CONFIGS.SESSION_SPAWN.backoffMs,
      backoffMultiplier: RETRY_CONFIGS.SESSION_SPAWN.backoffMultiplier,
      maxBackoffMs: RETRY_CONFIGS.SESSION_SPAWN.maxBackoffMs,
      retryableErrors: [...RETRY_CONFIGS.SESSION_SPAWN.retryableErrors],
      onRetry: (attempt, error, delay) => {
        console.log(`[SessionSpawn] Retry ${attempt} after ${delay}ms: ${error.message}`);
      },
      onFailure: (error, attempts) => {
        console.error(`[SessionSpawn] Failed after ${attempts} attempts: ${error.message}`);
      },
    })();
  } catch (error) {
    // Try fallback if provided
    if (options?.fallback) {
      console.log(`[SessionSpawn] Executing fallback for ${sessionId}`);
      try {
        return await options.fallback();
      } catch (fallbackError) {
        console.error(`[SessionSpawn] Fallback also failed:`, fallbackError);
      }
    }
    throw error;
  }
}

/**
 * Handle git worktree operations with retry and graceful degradation
 */
export async function handleGitWorktree<T>(
  operation: () => Promise<T>,
  branch: string,
  repoPath?: string,
  options?: {
    fallbackValue?: T;
    logError?: boolean;
  }
): Promise<T> {
  const context = createGitContext('git-worktree', branch, repoPath);

  return withGracefulDegradation(
    async () => {
      return await withRetry(
        operation,
        {
          operationName: `git-worktree-${branch}`,
          maxRetries: RETRY_CONFIGS.GIT_WORKTREE.maxRetries,
          backoffMs: RETRY_CONFIGS.GIT_WORKTREE.backoffMs,
          backoffMultiplier: RETRY_CONFIGS.GIT_WORKTREE.backoffMultiplier,
          maxBackoffMs: RETRY_CONFIGS.GIT_WORKTREE.maxBackoffMs,
          retryableErrors: [...RETRY_CONFIGS.GIT_WORKTREE.retryableErrors],
        }
      )();
    },
    options?.fallbackValue as T,
    {
      operationName: `git-worktree(${branch})`,
      logError: options?.logError ?? true,
    }
  );
}

/**
 * Handle Telegram send operations with circuit breaker and retry
 */
export async function handleTelegramSend<T>(
  operation: () => Promise<T>,
  chatId?: string,
  options?: {
    useCircuitBreaker?: boolean;
    silent?: boolean;
  }
): Promise<T | null> {
  const context = createTelegramContext(chatId);

  try {
    let fn = operation;

    // Apply circuit breaker
    if (options?.useCircuitBreaker !== false) {
      const cb = errorHandler.getCircuitBreaker(
        CIRCUIT_BREAKERS.TELEGRAM_SEND,
        LENIENT_CIRCUIT_CONFIG
      );
      fn = () => cb.execute(operation);
    }

    // Apply retry with timeout
    return await withTimeout(
      () => withRetry(fn, {
        operationName: 'telegram-send',
        maxRetries: RETRY_CONFIGS.TELEGRAM_SEND.maxRetries,
        backoffMs: RETRY_CONFIGS.TELEGRAM_SEND.backoffMs,
        backoffMultiplier: RETRY_CONFIGS.TELEGRAM_SEND.backoffMultiplier,
        maxBackoffMs: RETRY_CONFIGS.TELEGRAM_SEND.maxBackoffMs,
        retryableErrors: [...RETRY_CONFIGS.TELEGRAM_SEND.retryableErrors],
      })(),
      30000, // 30 second timeout
      { operationName: 'telegram-send' }
    );
  } catch (error) {
    if (!options?.silent) {
      console.error(`[TelegramSend] Failed:`, error);
    }
    return null;
  }
}

/**
 * Handle config parsing with validation and graceful degradation
 */
export async function handleConfigParse<T>(
  operation: () => Promise<T>,
  configPath?: string,
  configType?: 'global' | 'project',
  options?: {
    defaultValue: T;
    validate?: (config: T) => boolean;
  }
): Promise<T> {
  const context = createConfigContext(configPath, configType);

  try {
    const result = await operation();

    // Validate if validator provided
    if (options?.validate && !options.validate(result)) {
      throw new Error('Config validation failed');
    }

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[ConfigParse] Failed to parse ${configType} config:`, err.message);

    // Return default value
    return options?.defaultValue as T;
  }
}
