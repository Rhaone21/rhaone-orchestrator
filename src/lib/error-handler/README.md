# Error Handler Module

Comprehensive error handling for Rhaone Orchestrator with retry logic, circuit breaker, graceful degradation, and recovery strategies.

## Features

- **Automatic Retry Logic**: Exponential backoff with jitter for transient failures
- **Circuit Breaker Pattern**: Prevents cascading failures when services are down
- **Graceful Degradation**: Returns fallback values instead of throwing
- **Error Classification**: Automatically categorizes errors (network, github, git, etc.)
- **Bulkhead Pattern**: Limits concurrent operations to prevent resource exhaustion
- **Timeout Handling**: Adds timeout protection to any async operation
- **Error History**: Tracks and analyzes error patterns

## Quick Start

```typescript
import { 
  withErrorHandling, 
  withRetry, 
  withCircuitBreaker,
  withGracefulDegradation,
  errorHandler 
} from './error-handler';

// Basic error handling with retry
const result = await withErrorHandling(
  async () => await fetchData(),
  {
    operation: 'fetchData',
    retry: {
      maxRetries: 3,
      backoffMs: 1000,
    },
  }
);

// Wrap a function with retry
const fetchWithRetry = withRetry(fetchData, {
  operationName: 'fetchData',
  maxRetries: 3,
  retryableErrors: ['timeout', 'ECONNRESET'],
});

// Circuit breaker protection
const fetchWithCircuitBreaker = withCircuitBreaker(
  fetchData,
  'github-api',
  { failureThreshold: 5, resetTimeoutMs: 30000 }
);

// Graceful degradation
const result = await withGracefulDegradation(
  async () => await fetchData(),
  defaultData, // fallback value
  { operationName: 'fetchData' }
);
```

## Error Categories

Errors are automatically classified into categories:

- `network`: Connection issues, timeouts
- `github`: GitHub API errors, rate limits
- `git`: Git operations, worktree issues
- `session`: Session spawning failures
- `config`: Configuration errors
- `system`: System-level errors (memory, disk)
- `unknown`: Uncategorized errors

Each category has default retry strategies optimized for that error type.

## Circuit Breaker

The circuit breaker prevents cascading failures by temporarily rejecting requests when a service is failing.

### States

- **Closed**: Normal operation, requests pass through
- **Open**: Service is failing, requests are rejected immediately
- **Half-Open**: Testing if service has recovered

### Configuration

```typescript
const cb = errorHandler.getCircuitBreaker('my-service', {
  failureThreshold: 5,      // Open after 5 failures
  resetTimeoutMs: 30000,    // Try again after 30 seconds
  successThreshold: 2,      // Close after 2 successes in half-open
});

// Check state
const state = cb.getState();
// { state: 'closed', failures: 0, successes: 0, ... }

// Execute through circuit breaker
const result = await cb.execute(() => riskyOperation());

// Manual control
cb.forceOpen();   // Force circuit open
cb.forceClose();  // Force circuit closed
cb.reset();       // Reset to initial state
```

## Retry Configuration

### Default Strategies by Category

| Category | Max Retries | Backoff | Max Backoff |
|----------|-------------|---------|-------------|
| network  | 5           | 2000ms  | 60000ms     |
| github   | 3           | 5000ms  | 60000ms     |
| git      | 2           | 1000ms  | 10000ms     |
| session  | 1           | 1000ms  | 5000ms      |
| config   | 0           | -       | -           |
| system   | 2           | 5000ms  | 60000ms     |

### Custom Retry Options

```typescript
await withErrorHandling(
  async () => await operation(),
  {
    operation: 'myOperation',
    retry: {
      maxRetries: 5,
      backoffMs: 1000,
      backoffMultiplier: 2,    // 1s, 2s, 4s, 8s...
      maxBackoffMs: 30000,
      retryableErrors: ['timeout', 'ECONNRESET', 'rate limit'],
      onRetry: (attempt, error, delay) => {
        console.log(`Retry ${attempt} after ${delay}ms: ${error.message}`);
      },
      onFailure: (error, attempts) => {
        console.log(`Failed after ${attempts} attempts: ${error.message}`);
      },
    },
  }
);
```

## Bulkhead Pattern

Limits concurrent operations to prevent resource exhaustion:

```typescript
import { Bulkhead } from './error-handler';

const bulkhead = new Bulkhead(5); // Max 5 concurrent

// All operations go through bulkhead
const results = await Promise.all([
  bulkhead.execute(() => operation1()),
  bulkhead.execute(() => operation2()),
  // ... more operations
]);

// Check status
const status = bulkhead.getStatus();
// { running: 3, queued: 2, maxConcurrent: 5 }
```

## Timeout Handling

Add timeout protection to any operation:

```typescript
import { withTimeout } from './error-handler';

const result = await withTimeout(
  async () => await slowOperation(),
  5000, // 5 second timeout
  { 
    operationName: 'slowOperation',
    onTimeout: () => console.log('Operation timed out!')
  }
);
```

## Error Statistics

Track and analyze error patterns:

```typescript
// Get error stats for last 24 hours
const stats = errorHandler.getStats(24 * 60 * 60 * 1000);

console.log(stats);
// {
//   total: 42,
//   byCategory: { network: 10, github: 5, git: 2, ... },
//   bySeverity: { low: 20, medium: 15, high: 5, critical: 2 },
//   recoveryRate: 0.85,
//   circuitBreakers: { 'github-api': {...}, ... }
// }

// Get error history
const errors = errorHandler.getErrorHistory({
  category: 'github',
  severity: 'high',
  limit: 10,
});

// Clear history
errorHandler.clearHistory();
```

## Recovery Strategies

Register and execute custom recovery strategies:

```typescript
import { recoveryStrategies } from './error-handler';

// Register a recovery strategy
recoveryStrategies.register('github-auth-refresh', async () => {
  await refreshGitHubToken();
});

// Execute a strategy
const success = await recoveryStrategies.execute('github-auth-refresh');

// List available strategies
const strategies = recoveryStrategies.list();
```

## Integration Examples

### GitHub API Calls

```typescript
// From github.ts - already integrated
async getIssue(issueRef: string): Promise<GitHubIssue | null> {
  return withGracefulDegradation(
    async () => {
      // API call with automatic retry and circuit breaker
      const data = await this.runGhJson([...]);
      return transform(data);
    },
    null, // fallback value
    { operationName: `getIssue(${issueRef})`, logError: true }
  );
}
```

### Session Spawning

```typescript
// From session-manager.ts - already integrated
async spawn(config: SpawnConfig): Promise<Session> {
  return withErrorHandling(
    async () => {
      const spawnResult = await withRetry(
        async () => await this.callSessionsSpawn({...}),
        {
          operationName: 'sessions_spawn',
          maxRetries: 2,
          retryableErrors: ['timeout', 'ECONNRESET'],
        }
      );
      return session;
    },
    {
      operation: 'spawn',
      sessionId: session.id,
      retry: { maxRetries: 1, backoffMs: 2000 },
      fallback: async () => {
        // Mark as errored
        session.status = 'errored';
        return session;
      },
    }
  );
}
```

### Batch Operations

```typescript
// From batch-spawner.ts - already integrated
async spawnSingle(batchId: string, issue: BatchIssueConfig): Promise<BatchSessionResult> {
  return withGracefulDegradation(
    async () => {
      return await this.bulkhead.execute(async () => {
        const session = await withErrorHandling(
          () => this.sessionManager.spawn(spawnConfig),
          {
            operation: 'batch-spawn-single',
            retry: { maxRetries: 2 },
          }
        );
        return { issueId: issue.issueId, sessionId: session.id, status: 'spawned' };
      });
    },
    { issueId: issue.issueId, sessionId