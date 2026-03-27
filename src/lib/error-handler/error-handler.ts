/**
 * Rhaone Orchestrator - Error Handler & Recovery
 * Comprehensive error handling with retry logic, circuit breaker, and graceful degradation
 */

import { EventEmitter } from 'events';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ErrorCategory = 'network' | 'github' | 'git' | 'session' | 'config' | 'system' | 'unknown';
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface ErrorContext {
  operation: string;
  sessionId?: string;
  issueId?: string;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

export interface RecoveryStrategy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  retryableErrors: readonly string[];
  fallbackAction?: () => Promise<void>;
  onRetry?: (attempt: number, error: Error, delay: number) => void;
  onFailure?: (error: Error, attempts: number) => void;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
  successThreshold: number;
}

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalCalls: number;
  rejectedCalls: number;
}

export interface ErrorRecord {
  id: string;
  timestamp: Date;
  severity: ErrorSeverity;
  category: ErrorCategory;
  message: string;
  stack?: string;
  context: ErrorContext;
  recovered: boolean;
  recoveryAttempts: number;
  circuitBreakerId?: string;
}

export interface ErrorHandlerConfig {
  maxErrorHistory: number;
  defaultStrategy: RecoveryStrategy;
  categoryStrategies: Partial<Record<ErrorCategory, Partial<RecoveryStrategy>>>;
  circuitBreaker?: CircuitBreakerConfig;
  onCriticalError?: (error: ErrorRecord) => void;
  onRecoveryFailure?: (error: ErrorRecord) => void;
  onCircuitOpen?: (circuitId: string, state: CircuitBreakerState) => void;
  onCircuitClose?: (circuitId: string, state: CircuitBreakerState) => void;
}

export interface RetryOptions {
  maxRetries?: number;
  backoffMs?: number;
  backoffMultiplier?: number;
  maxBackoffMs?: number;
  retryableErrors?: readonly string[];
  onRetry?: (attempt: number, error: Error, delay: number) => void;
  onFailure?: (error: Error, attempts: number) => void;
}

export interface WrappedAsyncOptions {
  operation: string;
  sessionId?: string;
  issueId?: string;
  metadata?: Record<string, unknown>;
  retry?: RetryOptions;
  useCircuitBreaker?: string;
  fallback?: () => Promise<any>;
}

const DEFAULT_STRATEGY: RecoveryStrategy = {
  maxRetries: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 30000,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'rate limit',
    'timeout',
    'temporary',
    '503',
    '502',
    '504',
    '429',
  ],
};

const CATEGORY_STRATEGIES: Partial<Record<ErrorCategory, Partial<RecoveryStrategy>>> = {
  network: {
    maxRetries: 5,
    backoffMs: 2000,
    backoffMultiplier: 2,
    maxBackoffMs: 60000,
  },
  github: {
    maxRetries: 3,
    backoffMs: 5000,
    backoffMultiplier: 2,
    maxBackoffMs: 60000,
    retryableErrors: ['rate limit', 'abuse', 'timeout', '500', '502', '503', '504', '429'],
  },
  git: {
    maxRetries: 2,
    backoffMs: 1000,
    backoffMultiplier: 1.5,
    maxBackoffMs: 10000,
    retryableErrors: ['lock', 'conflict', 'busy', 'timeout', 'unable to access'],
  },
  session: {
    maxRetries: 1,
    backoffMs: 1000,
    backoffMultiplier: 1,
    maxBackoffMs: 5000,
  },
  config: {
    maxRetries: 0,
    backoffMs: 0,
    backoffMultiplier: 1,
    maxBackoffMs: 0,
  },
  system: {
    maxRetries: 2,
    backoffMs: 5000,
    backoffMultiplier: 2,
    maxBackoffMs: 60000,
  },
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxCalls: 3,
  successThreshold: 2,
};

/**
 * Circuit Breaker - prevents cascading failures
 */
export class CircuitBreaker extends EventEmitter {
  private config: CircuitBreakerConfig;
  private state: CircuitBreakerState;
  private id: string;
  private resetTimer: NodeJS.Timeout | null = null;

  constructor(id: string, config?: Partial<CircuitBreakerConfig>) {
    super();
    this.id = id;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.state = {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      totalCalls: 0,
      rejectedCalls: 0,
    };
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Check if the circuit allows calls
   */
  canExecute(): boolean {
    if (this.state.state === 'open') {
      // Check if reset timeout has passed
      if (this.state.lastFailureTime && 
          Date.now() - this.state.lastFailureTime >= this.config.resetTimeoutMs) {
        this.transitionTo('half-open');
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      this.state.rejectedCalls++;
      throw new CircuitBreakerOpenError(`Circuit breaker '${this.id}' is OPEN`);
    }

    this.state.totalCalls++;

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private recordSuccess(): void {
    this.state.lastSuccessTime = Date.now();
    
    if (this.state.state === 'half-open') {
      this.state.successes++;
      if (this.state.successes >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    } else {
      this.state.failures = 0;
      this.state.successes = 0;
    }
  }

  /**
   * Record a failed call
   */
  private recordFailure(): void {
    this.state.lastFailureTime = Date.now();
    this.state.failures++;

    if (this.state.state === 'half-open') {
      this.transitionTo('open');
    } else if (this.state.state === 'closed' && this.state.failures >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state.state;
    this.state.state = newState;

    if (newState === 'open') {
      this.state.successes = 0;
      this.emit('open', { id: this.id, state: this.getState() });
    } else if (newState === 'closed') {
      this.state.failures = 0;
      this.state.successes = 0;
      this.state.rejectedCalls = 0;
      this.emit('close', { id: this.id, state: this.getState() });
    } else if (newState === 'half-open') {
      this.state.successes = 0;
      this.emit('half-open', { id: this.id, state: this.getState() });
    }

    console.log(`[CircuitBreaker] ${this.id}: ${oldState} -> ${newState}`);
  }

  /**
   * Force open the circuit
   */
  forceOpen(): void {
    this.transitionTo('open');
  }

  /**
   * Force close the circuit
   */
  forceClose(): void {
    this.transitionTo('closed');
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.state = {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      totalCalls: 0,
      rejectedCalls: 0,
    };
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}

/**
 * Circuit Breaker Open Error
 */
export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Retryable Error
 */
export class RetryableError extends Error {
  constructor(message: string, public readonly originalError: Error) {
    super(message);
    this.name = 'RetryableError';
  }
}

/**
 * Non-Retryable Error
 */
export class NonRetryableError extends Error {
  constructor(message: string, public readonly originalError: Error) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Error Handler - comprehensive error management with recovery
 */
export class ErrorHandler extends EventEmitter {
  private config: ErrorHandlerConfig;
  private errorHistory: ErrorRecord[] = [];
  private pendingRecoveries: Map<string, NodeJS.Timeout> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor(config?: Partial<ErrorHandlerConfig>) {
    super();
    this.config = {
      maxErrorHistory: config?.maxErrorHistory || 100,
      defaultStrategy: { ...DEFAULT_STRATEGY, ...config?.defaultStrategy },
      categoryStrategies: {
        ...CATEGORY_STRATEGIES,
        ...config?.categoryStrategies,
      },
      circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config?.circuitBreaker },
      onCriticalError: config?.onCriticalError,
      onRecoveryFailure: config?.onRecoveryFailure,
      onCircuitOpen: config?.onCircuitOpen,
      onCircuitClose: config?.onCircuitClose,
    };
  }

  /**
   * Get or create a circuit breaker
   */
  getCircuitBreaker(id: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.circuitBreakers.has(id)) {
      const cb = new CircuitBreaker(id, { ...this.config.circuitBreaker, ...config });
      
      cb.on('open', ({ id, state }) => {
        console.warn(`[CircuitBreaker] ${id} is OPEN - rejecting calls`);
        this.emit('circuitOpen', { id, state });
        if (this.config.onCircuitOpen) {
          this.config.onCircuitOpen(id, state);
        }
      });

      cb.on('close', ({ id, state }) => {
        console.log(`[CircuitBreaker] ${id} is CLOSED - accepting calls`);
        this.emit('circuitClose', { id, state });
        if (this.config.onCircuitClose) {
          this.config.onCircuitClose(id, state);
        }
      });

      this.circuitBreakers.set(id, cb);
    }
    return this.circuitBreakers.get(id)!;
  }

  /**
   * Classify error into category
   */
  classifyError(error: Error): ErrorCategory {
    const message = error.message.toLowerCase();
    const code = (error as any).code?.toString().toLowerCase() || '';

    if (code.includes('conn') || code.includes('timeout') || message.includes('network')) {
      return 'network';
    }
    if (message.includes('github') || message.includes('gh ') || message.includes('api')) {
      return 'github';
    }
    if (message.includes('git') || message.includes('worktree') || message.includes('branch')) {
      return 'git';
    }
    if (message.includes('session') || message.includes('spawn')) {
      return 'session';
    }
    if (message.includes('config') || message.includes('yaml')) {
      return 'config';
    }
    if (message.includes('system') || message.includes('memory') || message.includes('disk')) {
      return 'system';
    }
    return 'unknown';
  }

  /**
   * Determine error severity
   */
  determineSeverity(error: Error, category: ErrorCategory): ErrorSeverity {
    const message = error.message.toLowerCase();

    // Critical errors
    if (category === 'system' || message.includes('out of memory') || message.includes('disk full')) {
      return 'critical';
    }

    // High severity
    if (message.includes('authentication') || message.includes('unauthorized') || message.includes('forbidden')) {
      return 'high';
    }

    // Medium severity
    if (category === 'github' || category === 'git') {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error: Error, strategy: RecoveryStrategy): boolean {
    const message = error.message.toLowerCase();
    const code = (error as any).code?.toString().toLowerCase() || '';

    // Non-retryable errors
    if (error instanceof NonRetryableError) return false;
    if (error instanceof CircuitBreakerOpenError) return false;

    // Check against retryable patterns
    return strategy.retryableErrors.some(retryable =>
      message.includes(retryable.toLowerCase()) || code.includes(retryable.toLowerCase())
    );
  }

  /**
   * Get recovery strategy for category
   */
  getStrategy(category: ErrorCategory): RecoveryStrategy {
    const categoryStrategy = this.config.categoryStrategies[category] || {};
    return {
      ...this.config.defaultStrategy,
      ...categoryStrategy,
    };
  }

  /**
   * Calculate backoff delay with exponential backoff and jitter
   */
  calculateBackoff(attempt: number, strategy: RecoveryStrategy): number {
    const exponentialDelay = strategy.backoffMs * Math.pow(strategy.backoffMultiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, strategy.maxBackoffMs);
    // Add jitter (±20%) to prevent thundering herd
    const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(cappedDelay + jitter));
  }

  /**
   * Handle an error with automatic recovery
   */
  async handle<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    customStrategy?: Partial<RecoveryStrategy>
  ): Promise<T> {
    const strategy = customStrategy
      ? { ...this.config.defaultStrategy, ...customStrategy }
      : undefined;

    return this.executeWithRetry(operation, context, 0, strategy);
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    attempt: number,
    customStrategy?: RecoveryStrategy
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const category = this.classifyError(err);
      const severity = this.determineSeverity(err, category);
      const strategy = customStrategy || this.getStrategy(category);

      // Record error
      const errorRecord = this.recordError(err, category, severity, context);

      // Check if we should retry
      if (attempt < strategy.maxRetries && this.isRetryable(err, strategy)) {
        const delay = this.calculateBackoff(attempt, strategy);
        
        if (strategy.onRetry) {
          strategy.onRetry(attempt + 1, err, delay);
        }
        
        console.log(`[ErrorHandler] Retrying ${context.operation} in ${delay}ms (attempt ${attempt + 1}/${strategy.maxRetries})`);

        await this.sleep(delay);
        return this.executeWithRetry(operation, { ...context, retryCount: attempt + 1 }, attempt + 1, strategy);
      }

      // Recovery failed
      errorRecord.recovered = false;
      this.emit('recoveryFailed', errorRecord);

      if (severity === 'critical' && this.config.onCriticalError) {
        this.config.onCriticalError(errorRecord);
      }

      if (this.config.onRecoveryFailure) {
        this.config.onRecoveryFailure(errorRecord);
      }

      if (strategy.onFailure) {
        strategy.onFailure(err, attempt + 1);
      }

      // Try fallback if available
      if (strategy.fallbackAction) {
        console.log(`[ErrorHandler] Executing fallback for ${context.operation}`);
        try {
          await strategy.fallbackAction();
        } catch (fallbackError) {
          console.error(`[ErrorHandler] Fallback also failed:`, fallbackError);
        }
      }

      throw err;
    }
  }

  /**
   * Execute with circuit breaker protection
   */
  async executeWithCircuitBreaker<T>(
    circuitId: string,
    operation: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<T> {
    const cb = this.getCircuitBreaker(circuitId, config);
    return cb.execute(operation);
  }

  /**
   * Record error to history
   */
  private recordError(
    error: Error,
    category: ErrorCategory,
    severity: ErrorSeverity,
    context: ErrorContext
  ): ErrorRecord {
    const record: ErrorRecord = {
      id: `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      severity,
      category,
      message: error.message,
      stack: error.stack,
      context,
      recovered: false,
      recoveryAttempts: context.retryCount || 0,
    };

    this.errorHistory.push(record);

    // Keep history limited
    if (this.errorHistory.length > this.config.maxErrorHistory) {
      this.errorHistory.shift();
    }

    this.emit('error', record);
    console.error(`[ErrorHandler] ${severity.toUpperCase()} [${category}]: ${error.message}`);

    return record;
  }

  /**
   * Get error history
   */
  getErrorHistory(filter?: {
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    since?: Date;
    limit?: number;
  }): ErrorRecord[] {
    let filtered = this.errorHistory;

    if (filter?.category) {
      filtered = filtered.filter(e => e.category === filter.category);
    }

    if (filter?.severity) {
      filtered = filtered.filter(e => e.severity === filter.severity);
    }

    if (filter?.since) {
      filtered = filtered.filter(e => e.timestamp >= filter.since!);
    }

    if (filter?.limit) {
      filtered = filtered.slice(-filter.limit);
    }

    return filtered;
  }

  /**
   * Get error statistics
   */
  getStats(timeWindowMs: number = 24 * 60 * 60 * 1000): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
    recoveryRate: number;
    circuitBreakers: Record<string, CircuitBreakerState>;
  } {
    const since = new Date(Date.now() - timeWindowMs);
    const recent = this.errorHistory.filter(e => e.timestamp >= since);

    const byCategory: Record<ErrorCategory, number> = {
      network: 0, github: 0, git: 0, session: 0, config: 0, system: 0, unknown: 0,
    };

    const bySeverity: Record<ErrorSeverity, number> = {
      low: 0, medium: 0, high: 0, critical: 0,
    };

    let recovered = 0;

    for (const error of recent) {
      byCategory[error.category]++;
      bySeverity[error.severity]++;
      if (error.recovered) recovered++;
    }

    const circuitBreakers: Record<string, CircuitBreakerState> = {};
    this.circuitBreakers.forEach((cb, id) => {
      circuitBreakers[id] = cb.getState();
    });

    return {
      total: recent.length,
      byCategory,
      bySeverity,
      recoveryRate: recent.length > 0 ? recovered / recent.length : 1,
      circuitBreakers,
    };
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * Cancel pending recoveries for a session
   */
  cancelPendingRecoveries(sessionId: string): void {
    const keysToDelete: string[] = [];
    this.pendingRecoveries.forEach((timeout, key) => {
      if (key.startsWith(sessionId)) {
        clearTimeout(timeout);
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.pendingRecoveries.delete(key));
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wrap a function with error handling
   */
  wrap<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    context: Omit<ErrorContext, 'operation'>
  ): T {
    const wrapped = async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      return this.handle(
        () => fn(...args),
        { ...context, operation: fn.name || 'anonymous' }
      );
    };
    return wrapped as T;
  }

  /**
   * Wrap with circuit breaker
   */
  wrapWithCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    circuitId: string,
    config?: Partial<CircuitBreakerConfig>
  ): T {
    const cb = this.getCircuitBreaker(circuitId, config);
    const wrapped = async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      return cb.execute(() => fn(...args));
    };
    return wrapped as T;
  }

  /**
   * Get all circuit breaker states
   */
  getCircuitBreakerStates(): Record<string, CircuitBreakerState> {
    const states: Record<string, CircuitBreakerState> = {};
    this.circuitBreakers.forEach((cb, id) => {
      states[id] = cb.getState();
    });
    return states;
  }

  /**
   * Reset a specific circuit breaker
   */
  resetCircuitBreaker(id: string): boolean {
    const cb = this.circuitBreakers.get(id);
    if (cb) {
      cb.reset();
      return true;
    }
    return false;
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    this.circuitBreakers.forEach(cb => cb.reset());
  }

  /**
   * Force open a circuit breaker
   */
  forceOpenCircuitBreaker(id: string): boolean {
    const cb = this.circuitBreakers.get(id);
    if (cb) {
      cb.forceOpen();
      return true;
    }
    return false;
  }

  /**
   * Force close a circuit breaker
   */
  forceCloseCircuitBreaker(id: string): boolean {
    const cb = this.circuitBreakers.get(id);
    if (cb) {
      cb.forceClose();
      return true;
    }
    return false;
  }
}

// Export singleton
export const errorHandler = new ErrorHandler();

// Factory function
export function createErrorHandler(config?: Partial<ErrorHandlerConfig>): ErrorHandler {
  return new ErrorHandler(config);
}

/**
 * Async wrapper with try-catch - wraps any async function with comprehensive error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  options: WrappedAsyncOptions
): Promise<T> {
  const { operation: opName, sessionId, issueId, metadata, retry, fallback, useCircuitBreaker } = options;
  
  const context: ErrorContext = {
    operation: opName,
    sessionId,
    issueId,
    metadata,
  };

  const handler = errorHandler;

  try {
    let fn = operation;

    // Apply circuit breaker if specified
    if (useCircuitBreaker) {
      const cb = handler.getCircuitBreaker(useCircuitBreaker);
      fn = () => cb.execute(operation);
    }

    // Apply retry logic if specified
    if (retry) {
      return await handler.handle(fn, context, retry);
    }

    return await fn();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    
    // Log the error
    console.error(`[withErrorHandling] Operation '${opName}' failed:`, err.message);
    
    // Try fallback if provided
    if (fallback) {
      console.log(`[withErrorHandling] Executing fallback for '${opName}'`);
      try {
        return await fallback();
      } catch (fallbackError) {
        console.error(`[withErrorHandling] Fallback also failed:`, fallbackError);
      }
    }
    
    throw err;
  }
}

/**
 * Create a retryable function wrapper
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: RetryOptions & { operationName?: string }
): T {
  const wrapped = async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const strategy: RecoveryStrategy = {
      maxRetries: options.maxRetries ?? 3,
      backoffMs: options.backoffMs ?? 1000,
      backoffMultiplier: options.backoffMultiplier ?? 2,
      maxBackoffMs: options.maxBackoffMs ?? 30000,
      retryableErrors: options.retryableErrors ?? DEFAULT_STRATEGY.retryableErrors,
      onRetry: options.onRetry,
      onFailure: options.onFailure,
    };

    return errorHandler.handle(
      () => fn(...args),
      { operation: options.operationName || fn.name || 'anonymous' },
      strategy
    );
  };
  return wrapped as T;
}

/**
 * Create a circuit breaker protected function
 */
export function withCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  circuitId: string,
  config?: Partial<CircuitBreakerConfig>
): T {
  const cb = errorHandler.getCircuitBreaker(circuitId, config);
  const wrapped = async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return cb.execute(() => fn(...args));
  };
  return wrapped as T;
}

/**
 * Graceful degradation - returns fallback value on failure
 */
export async function withGracefulDegradation<T>(
  operation: () => Promise<T>,
  fallback: T,
  options?: { logError?: boolean; operationName?: string }
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (options?.logError !== false) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[GracefulDegradation] ${options?.operationName || 'Operation'} failed, using fallback:`, err.message);
    }
    return fallback;
  }
}

/**
 * Bulkhead pattern - limit concurrent operations
 */
export class Bulkhead {
  private maxConcurrent: number;
  private queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  private running: number = 0;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running < this.maxConcurrent) {
      return this.run(fn);
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
    });
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    this.running++;
    try {
      const result = await fn();
      return result;
    } finally {
      this.running--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        this.run(next.fn).then(next.resolve).catch(next.reject);
      }
    }
  }

  getStatus(): { running: number; queued: number; maxConcurrent: number } {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

/**
 * Timeout wrapper - adds timeout to any async operation
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  options?: { operationName?: string; onTimeout?: () => void }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (options?.onTimeout) {
        options.onTimeout();
      }
      reject(new Error(`Operation '${options?.operationName || 'anonymous'}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Recovery strategies registry
 */
export class RecoveryStrategies {
  private strategies: Map<string, () => Promise<void>> = new Map();

  register(name: string, strategy: () => Promise<void>): void {
    this.strategies.set(name, strategy);
  }

  async execute(name: string): Promise<boolean> {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      console.warn(`[RecoveryStrategies] No strategy registered for '${name}'`);
      return false;
    }

    try {
      await strategy();
      return true;
    } catch (error) {
      console.error(`[RecoveryStrategies] Strategy '${name}' failed:`, error);
      return false;
    }
  }

  has(name: string): boolean {
    return this.strategies.has(name);
  }

  list(): string[] {
    return Array.from(this.strategies.keys());
  }
}

// Global recovery strategies registry
export const recoveryStrategies = new RecoveryStrategies();