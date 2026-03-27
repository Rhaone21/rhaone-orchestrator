# Rhaone Orchestrator - Performance Profile Report

## Executive Summary

This report analyzes the performance characteristics of the Rhaone Orchestrator codebase and identifies key bottlenecks that impact session spawning, resource management, and overall throughput.

## Identified Bottlenecks

### 1. **Session Spawning Overhead** (Critical)
**Location:** `src/lib/session-manager.ts`, `src/lib/batch-spawner.ts`

**Issues:**
- Synchronous file I/O on every session creation (`writeFileSync`, `readFileSync`)
- No batching of disk writes - each session triggers immediate disk write
- `loadAllSessions()` blocks initialization with synchronous readdirSync/readFileSync
- No caching of session data - repeated disk reads for same sessions

**Impact:** High latency for session creation, especially in batch operations

### 2. **Inefficient Parallel Execution** (High)
**Location:** `src/lib/orchestrator.ts` (lines 275-320), `src/lib/batch-spawner.ts` (lines 155-220)

**Issues:**
- `executePhaseParallel()` uses `Promise.race` + manual promise filtering pattern that's O(n²) in worst case
- `spawnParallel()` recursively calls itself creating unnecessary call stack depth
- No proper concurrency limit enforcement - can exceed maxConcurrent under race conditions
- Promise array manipulation with `splice` in loop causes index shifting issues

**Impact:** Unpredictable concurrency, potential memory pressure from promise accumulation

### 3. **Memory Leaks** (High)
**Location:** Multiple files

**Issues:**
- Event listeners never removed in `Orchestrator`, `BatchSpawner`, `CIPoller`
- `eventHistory` in `Orchestrator` grows unbounded (only limited to 100 entries)
- `pendingFixes` Map in `LifecycleManager` - timeouts not cleared on session completion
- `pollTimers` in `CIPoller` - timers not cleaned up on session errors
- `errorHistory` in `ErrorHandler` - only limited by config, no automatic cleanup

**Impact:** Long-running processes accumulate memory over time

### 4. **Resource Manager Lock Contention** (Medium)
**Location:** `src/lib/resource-manager.ts` (lines 95-140)

**Issues:**
- `waitForSlot()` creates new Promise/resolver for every wait attempt
- No timeout cleanup for wait queue entries
- `release()` uses setTimeout for async release, creating unnecessary event loop pressure
- Cooldown mechanism uses setTimeout per release, not scalable

**Impact:** Resource acquisition latency increases under load

### 5. **Dependency Resolver Inefficiency** (Medium)
**Location:** `src/lib/dependency-resolver.ts` (lines 45-90)

**Issues:**
- `calculateDepths()` uses recursive DFS without memoization - O(n²) in pathological cases
- `buildGraph()` iterates nodes multiple times
- No caching of execution plans - recomputed every time

**Impact:** Task decomposition overhead for complex dependency chains

### 6. **CI Poller Polling Overhead** (Medium)
**Location:** `src/lib/ci-poller.ts`

**Issues:**
- Fixed interval polling regardless of CI state
- No request deduplication - multiple sessions for same PR poll independently
- No backoff on errors

**Impact:** Unnecessary API calls, rate limit exhaustion

### 7. **Task Decomposer String Operations** (Low)
**Location:** `src/lib/task-decomposer.ts`

**Issues:**
- Repeated `toLowerCase()` calls on same strings
- No caching of complexity detection results
- `generateSubtasks()` creates new objects even when task patterns match cached results

## Performance Metrics (Estimated)

| Operation | Current | Target | Improvement |
|-----------|---------|--------|-------------|
| Session Spawn (single) | ~50-100ms | ~10-20ms | 5x |
| Batch Spawn (10 sessions) | ~500-1000ms | ~100-200ms | 5x |
| Task Decomposition | ~1-5ms | ~0.5-1ms | 2x |
| Dependency Resolution | ~O(n²) | ~O(n) | Significant |
| Memory Growth (24h) | ~100-500MB | ~10-50MB | 10x |

## Recommendations

1. **Implement Write-Ahead Logging (WAL)** for session persistence instead of sync file writes
2. **Use Worker Pool** for CPU-intensive operations like dependency resolution
3. **Add Request Coalescing** for CI polling to deduplicate identical requests
4. **Implement Proper Cleanup** with WeakRefs and finalizers where appropriate
5. **Use Async Generators** for batch processing to control memory pressure
6. **Add Connection Pooling** for GitHub API calls

## Next Steps

See `src/lib/optimized/` directory for optimized implementations addressing these bottlenecks.
