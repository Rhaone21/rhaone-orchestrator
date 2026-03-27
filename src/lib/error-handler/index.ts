/**
 * Rhaone Orchestrator - Error Handler Module
 * Comprehensive error handling, retry logic, circuit breaker, and recovery strategies
 */

export {
  // Main classes
  ErrorHandler,
  CircuitBreaker,
  Bulkhead,
  RecoveryStrategies,
  
  // Error types
  CircuitBreakerOpenError,
  RetryableError,
  NonRetryableError,
  
  // Singletons
  errorHandler,
  recoveryStrategies,
  
  // Factory functions
  createErrorHandler,
  
  // Wrapper functions
  withErrorHandling,
  withRetry,
  withCircuitBreaker,
  withGracefulDegradation,
  withTimeout,
} from './error-handler';

export type {
  ErrorSeverity,
  ErrorCategory,
  CircuitState,
  ErrorContext,
  RecoveryStrategy,
  CircuitBreakerConfig,
  CircuitBreakerState,
  ErrorRecord,
  ErrorHandlerConfig,
  RetryOptions,
  WrappedAsyncOptions,
} from './error-handler';

// Specialized error handlers
export {
  // Circuit breaker IDs
  CIRCUIT_BREAKERS,
  
  // Retry configurations
  RETRY_CONFIGS,
  
  // Context builders
  createSessionContext,
  createGitContext,
  createTelegramContext,
  createConfigContext,
  
  // Specialized handlers
  handleSessionSpawn,
  handleGitWorktree,
  handleTelegramSend,
  handleConfigParse,
} from './error-handlers';

// Recovery strategies
export {
  // Recovery functions
  recoverSessionSpawn,
  recoverGitWorktree,
  recoverTelegramSend,
  recoverConfigParse,
  
  // Registration
  registerRecoveryStrategies,
  
  // Types
  type RecoveryAction,
  type RecoveryPlan,
} from './recovery-strategies';
