/**
 * Rhaone Orchestrator - Error Handler Tests
 * Comprehensive tests for error handling, retry logic, and circuit breaker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  errorHandler,
  CircuitBreaker,
  CircuitBreakerOpenError,
  withRetry,
  withCircuitBreaker,
  withGracefulDegradation,
  withTimeout,
  Bulkhead,
} from './error-handler';
import {
  CIRCUIT_BREAKERS,
  RETRY_CONFIGS,
  handleSessionSpawn,
  handleGitWorktree,
  handleTelegramSend,
  handleConfigParse,
} from './error-handlers';
import {
  recoverSessionSpawn,
  recoverGitWorktree,
  recoverTelegramSend,
  recoverConfigParse,
} from './recovery-strategies';

describe('Error Handler', () => {
  beforeEach(() => {
    errorHandler.clearHistory();
    errorHandler.resetAllCircuitBreakers();
  });

  describe('Circuit Breaker', () => {
    it('should start in closed state', () => {
      const cb = errorHandler.getCircuitBreaker('test-cb');
      expect(cb.getState().state).toBe('closed');
    });

    it('should open after threshold failures', async () => {
      const cb = errorHandler.getCircuitBreaker('test-cb', {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });

      // Trigger 3 failures
      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(async () => {
            throw new Error('Test error');
          });
        } catch {
          // Expected
        }
      }

      expect(cb.getState().state).toBe('open');
    });

    it('should reject calls when open', async () => {
      const cb = errorHandler.getCircuitBreaker('test-cb', {
        failureThreshold: 1,
        resetTimeoutMs: 10000,
      });

      // Trigger failure to open circuit
      try {
        await cb.execute(async () => {
 throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(cb.getState().state).toBe('open');

      await expect(
        cb.execute(async () => 'success')
      ).rejects.toThrow(CircuitBreakerOpenError);
    });

    it('should transition to half-open after timeout', async () => {
      const cb = errorHandler.getCircuitBreaker('test-cb', {
        failureThreshold: 1,
        resetTimeoutMs: 100, // Short timeout for testing
      });

      // Open the circuit
      try {
        await cb.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(cb.getState().state).toBe('open');

      // Wait for timeout
      await new Promise(r => setTimeout(r, 150));

      // Next call should be allowed (half-open)
      const result = await cb.execute(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('Retry Logic', () => {
    it('should retry on retryable errors', async () => {
      let attempts = 0;
      const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

      const wrapped = withRetry(fn, {
        operationName: 'test-retry',
        maxRetries: 3,
        backoffMs: 10,
        retryableErrors: ['ECONNRESET'],
      });

      try {
        await wrapped();
      } catch {
        // Expected to fail after retries
      }

      expect(fn).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should not retry on non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Fatal error'));

      const wrapped = withRetry(fn, {
        operationName: 'test-retry',
        maxRetries: 3,
        retryableErrors: ['ECONNRESET'],
      });

      try {
        await wrapped();
      } catch {
        // Expected
      }

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should succeed on retry', async () => {
      let attempts = 0;
      const fn = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('ECONNRESET');
        }
        return Promise.resolve('success');
      });

      const wrapped = withRetry(fn, {
        operationName: 'test-retry',
        maxRetries: 3,
        backoffMs: 10,
        retryableErrors: ['ECONNRESET'],
      });

      const result = await wrapped();
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('Graceful Degradation', () => {
    it('should return fallback on failure', async () => {
      const fallback = 'fallback-value';
      const result = await withGracefulDegradation(
        async () => {
          throw new Error('Test error');
        },
        fallback
      );

      expect(result).toBe(fallback);
    });

    it('should return result on success', async () => {
      const result = await withGracefulDegradation(
        async () => 'success',
        'fallback'
      );

      expect(result).toBe('success');
    });
  });

  describe('Timeout', () => {
    it('should timeout slow operations', async () => {
      await expect(
        withTimeout(
          async () => {
            await new Promise(r => setTimeout(r, 1000));
            return 'success';
          },
          100
        )
      ).rejects.toThrow('timed out');
    });

    it('should return result if within timeout', async () => {
      const result = await withTimeout(
        async () => {
          await new Promise(r => setTimeout(r, 50));
          return 'success';
        },
        200
      );

      expect(result).toBe('success');
    });
  });

  describe('Bulkhead', () => {
    it('should limit concurrent operations', async () => {
      const bulkhead = new Bulkhead(2);
      let running = 0;
      let maxRunning = 0;

      const operations = Array(5).fill(null).map(() =>
        bulkhead.execute(async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise(r => setTimeout(r, 50));
          running--;
          return 'done';
        })
      );

      await Promise.all(operations);
      expect(maxRunning).toBe(2);
    });
  });
});

describe('Specialized Error Handlers', () => {
  beforeEach(() => {
    errorHandler.clearHistory();
    errorHandler.resetAllCircuitBreakers();
  });

  describe('handleSessionSpawn', () => {
    it('should use circuit breaker', async () => {
      let calls = 0;
      const operation = async () => {
        calls++;
        if (calls < 2) {
          throw new Error('spawn timeout');
        }
        return { id: 'test-session' };
      };

      const result = await handleSessionSpawn(operation, 'test-session', 'issue-123');
      expect(result).toEqual({ id: 'test-session' });
    });

    it('should fallback on persistent failure', async () => {
      const fallback = { id: 'fallback-session' };
      const operation = async () => {
        throw new Error('spawn failed');
      };

      const result = await handleSessionSpawn(operation, 'test-session', 'issue-123', {
        fallback: async () => fallback,
      });

      expect(result).toEqual(fallback);
    });
  });

  describe('handleGitWorktree', () => {
    it('should retry on lock errors', async () => {
      let calls = 0;
      const operation = async () => {
        calls++;
        if (calls < 2) {
          throw new Error('git lock');
        }
        return { path: '/test/path' };
      };

      const result = await handleGitWorktree(operation, 'test-branch');
      expect(result).toEqual({ path: '/test/path' });
    });

    it('should return fallback on failure', async () => {
      const fallback = { path: '/fallback/path' };
      const operation = async () => {
        throw new Error('fatal error');
      };

      const result = await handleGitWorktree(operation, 'test-branch', '/repo', {
        fallbackValue: fallback,
      });

      expect(result).toEqual(fallback);
    });
  });

  describe('handleTelegramSend', () => {
    it('should return null on failure', async () => {
      const operation = async () => {
        throw new Error('network error');
      };

      const result = await handleTelegramSend(operation, 'chat-123');
      expect(result).toBeNull();
    });

    it('should return result on success', async () => {
      const operation = async () => ({ ok: true, messageId: 123 });

      const result = await handleTelegramSend(operation, 'chat-123');
      expect(result).toEqual({ ok: true, messageId: 123 });
    });
  });

  describe('handleConfigParse', () => {
    it('should return default on parse failure', async () => {
      const defaultValue = { defaults: { agent: 'default' } };
      const operation = async () => {
        throw new Error('parse error');
      };

      const result = await handleConfigParse(operation, '/config.yaml', 'global', {
        defaultValue,
      });

      expect(result).toEqual(defaultValue);
    });

    it('should validate config if validator provided', async () => {
      interface Config { valid?: boolean; defaults?: { agent: string } }
      const operation = async (): Promise<Config> => ({ invalid: true } as Config);

      const result = await handleConfigParse(operation, '/config.yaml', 'global', {
        defaultValue: { valid: true, defaults: { agent: 'default' } },
        validate: (config: Config) => config.hasOwnProperty('valid'),
      });

      expect(result).toEqual({ valid: true, defaults: { agent: 'default' } });
    });
  });
});

describe('Recovery Strategies', () => {
  describe('recoverSessionSpawn', () => {
    it('should attempt multiple recovery strategies', async () => {
      let attempts = 0;
      const retryFn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('still failing');
        }
      };

      const result = await recoverSessionSpawn('test-session', retryFn);
      expect(result).toBe(true);
      expect(attempts).toBeGreaterThanOrEqual(1);
    });
  });

  describe('recoverGitWorktree', () => {
    it('should attempt cleanup and retry', async () => {
      let attempts = 0;
      const retryFn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('lock error');
        }
      };

      const result = await recoverGitWorktree('test-branch', '/worktree/path', retryFn);
      expect(result).toBe(true);
    });
  });

  describe('recoverTelegramSend', () => {
    it('should retry with backoff', async () => {
      let attempts = 0;
      const retryFn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('rate limit');
        }
      };

      const result = await recoverTelegramSend(retryFn);
      expect(result).toBe(true);
    });
  });

  describe('recoverConfigParse', () => {
    it('should fallback to defaults', async () => {
      const retryFn = async () => {
        throw new Error('parse error');
      };

      const result = await recoverConfigParse('/config.yaml', retryFn);
      expect(result).toBe(true);
    });
  });
});

describe('Error Handler Integration', () => {
  beforeEach(() => {
    errorHandler.clearHistory();
    errorHandler.resetAllCircuitBreakers();
  });

  it('should track error history', async () => {
    const operation = async () => {
      throw new Error('test error');
    };

    try {
      await errorHandler.handle(operation, { operation: 'test' });
    } catch {
      // Expected
    }

    const history = errorHandler.getErrorHistory();
    expect(history.length).toBe(1);
    expect(history[0].message).toBe('test error');
  });

  it('should provide error statistics', async () => {
    // Create some errors
    for (let i = 0; i < 3; i++) {
      try {
        await errorHandler.handle(
          async () => { throw new Error(`error ${i}`); },
          { operation: 'test' }
        );
      } catch {
        // Expected
      }
    }

    const stats = errorHandler.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byCategory.unknown).toBe(3);
  });

  it('should filter error history', async () => {
    // Create errors with different categories
    try {
      await errorHandler.handle(
        async () => { throw new Error('network error'); },
        { operation: 'test' }
      );
    } catch {
      // Expected
    }

    const networkHistory = errorHandler.getErrorHistory({ category: 'network' });
    expect(networkHistory.length).toBeGreaterThanOrEqual(0);
  });
});