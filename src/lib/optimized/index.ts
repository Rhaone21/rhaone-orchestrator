/**
 * Rhaone Orchestrator - Optimized Modules
 * High-performance implementations of core functionality
 */

export {
  OptimizedSessionManager,
  optimizedSessionManager,
  type SpawnConfig,
  type Session,
  type SessionStatus,
  type SessionManagerOptions,
} from './session-manager';

export {
  OptimizedBatchSpawner,
  optimizedBatchSpawner,
  type BatchSpawnConfig,
  type BatchIssueConfig,
  type BatchSpawnResult,
  type BatchSessionResult,
  type BatchProgressEvent,
  type BatchStatus,
  type BatchSpawnStats,
} from './batch-spawner';

export {
  OptimizedResourceManager,
  optimizedResourceManager,
  type ResourceManagerOptions,
  type ResourceState,
  type ResourceMetrics,
} from './resource-manager';
