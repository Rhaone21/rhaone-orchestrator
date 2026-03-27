/**
 * Rhaone Orchestrator - Error Handler Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorHandler,
  CircuitBreaker,
  Bulkhead,
  RecoveryStrategies,
  CircuitBreakerOpenError,
  withRetry,
  withCircuitBreaker,
  withGracefulDegradation,
  withTimeout,
  createErrorHandler,
} from './error-handler';

describe('ErrorHandler', () => {
  let handler: ErrorHandler;

  beforeEach(() => {
    handler = createErrorHandler({ maxErrorHistory: 50 });
  });

  describe('Basic Error Handling', () => {
    it('should handle successful operations', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      const result = await handler.handle(operation, { operation: 'test' });
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');
      
      const result = await handler.handle(operation, { operation: 'test' });
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries exceeded', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('timeout'));
      
      await expect(
        handler.handle(operation, { operation: 'test' }, { maxRetries: 2 })
      ).rejects.toThrow('timeout');
      
      expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  describe('Circuit Breaker', () => {
    it('should allow calls when closed', async () => {
      const cb = handler.getCircuitBreaker('test-circuit');
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await cb.execute(operation);
      expect(result).toBe('success');
    });

    it('should open after threshold failures', async () => {
      const cb = handler.getCircuitBreaker('test-circuit', { failureThreshold: 3 });
      const operation = vi.fn().mockRejectedValue(new Error('error'));
      
      // Trigger failures
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(operation); } catch {}
      }
      
      // Circuit should be open now
      await expect(cb.execute(operation)).rejects.toThrow(CircuitBreakerOpenError);
    });

    it('should close after success threshold', async () => {
      const cb = handler.getCircuitBreaker('test-circuit', { 
        failureThreshold: 2,
        successThreshold: 2 
      });
      
      // Open the circuit
      const failingOp = vi.fn().mockRejectedValue(new Error('error'));
      for (let i = 0; i < 2; i++) {
        try { await cb.execute(failingOp); } catch {}
      }
      
      // Force close
      cb.forceClose();
      
      const successOp = vi.fn().mockResolvedValue('success');
      const result = await cb.execute(successOp);
      expect(result).toBe('success');
    });
  });

  describe('Bulkhead Pattern', () => {
    it('should limit concurrent executions', async () => {
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
      expect(maxRunning).toBeLessThanOrEqual(2);
    });
  });

  describe('Utility Functions', () => {
    it('withRetry should wrap function with retry', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');
      
      const wrapped = withRetry(fn, { operationName: 'test', maxRetries: 2 });
      const result = await wrapped();
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('withGracefulDegradation should return fallback on failure', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('fail'));
      const result = await withGracefulDegradation(
        () => operation(),
        'fallback',
        { logError: false }
      );
      expect(result).toBe('fallback');
    });

    it('withTimeout should reject on timeout', async () => {
      const slowOperation = () => new Promise(resolve => setTimeout(resolve, 1000));
      
      await expect(
        withTimeout(slowOperation, 50, { operationName: 'slow' })
      ).rejects.toThrow('timed out');
    });

    it('withTimeout should resolve if operation completes', async () => {
      const fastOperation = () => Promise.resolve('done');
      const result = await withTimeout(fastOperation, 1000);
      expect(result).toBe('done');
    });
  });

  describe('Error Classification', () => {
    it('should classify network errors', () => {
      const error = new Error('ECONNRESET');
      (error as any).code = 'ECONNRESET';
      expect(handler.classifyError(error)).toBe('network');
    });

    it('should classify github errors', () => {
      const error = new Error('GitHub API rate limit exceeded');
      expect(handler.classifyError(error)).toBe('github');
    });
  });

  describe('Statistics', () => {
    it('should track error statistics', async () => {
      // Generate some errors
      const errorOp = () => Promise.reject(new Error('test error'));
      
      try { await handler.handle(errorOp, { operation: 'test1' }); } catch {}
      try { await handler.handle(errorOp, { operation: 'test2' }); } catch {}
      
      const stats = handler.getStats(60000);
      expect(stats.total).toBe(2);
    });
  });
});