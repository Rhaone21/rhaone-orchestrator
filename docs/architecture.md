# Rhaone Orchestrator - Architecture Overview

## System Architecture

Rhaone Orchestrator follows a layered architecture designed for scalability, maintainability, and extensibility. The system is built around a core orchestration layer that coordinates multiple specialized components.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Application Layer                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │     CLI     │  │    API      │  │  Telegram   │  │   Webhook   │        │
│  │   (cli.ts)  │  │  (index.ts) │  │   Handler   │  │   Handler   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼───────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                         Orchestration Layer                                │
│                              (Orchestrator)                                 │
│  ┌─────────────────────────────────┼─────────────────────────────────────┐ │
│  │                                 ▼                                     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │ │
│  │  │   Session   │  │   Batch     │  │    Task     │  │  Resource   │  │ │
│  │  │   Manager   │  │   Spawner   │  │ Decomposer  │  │   Manager   │  │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │ │
│  └─────────┼────────────────┼────────────────┼────────────────┼─────────┘ │
└────────────┼────────────────┼────────────────┼────────────────┼───────────┘
             │                │                │                │
┌────────────┼────────────────┼────────────────┼────────────────┼───────────┐
│            │         Service Layer (Business Logic)            │           │
│            ▼                ▼                ▼                ▼           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │   GitHub    │  │   Lifecycle │  │   Learning  │  │   Error     │      │
│  │ Integration │  │   Manager   │  │   Engine    │  │   Handler   │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│         │                │                │                │             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  CI Poller  │  │  Telegram   │  │   Pattern   │  │ Performance │      │
│  │             │  │  Notifier   │  │  Analyzer   │  │  Optimizer  │      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
└─────────┼────────────────┼────────────────┼────────────────┼─────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                         Infrastructure Layer                               │
│  ┌─────────────┐  ┌─────────────┐  │  ┌─────────────┐  ┌─────────────┐      │
│  │  Git CLI    │  │ GitHub CLI  │  │  │   Cache     │  │   Storage   │      │
│  │  (exec)     │  │    (gh)     │  │  │   (LRU)     │  │   (JSON)    │      │
│  └─────────────┘  └─────────────┘  │  └─────────────┘  └─────────────┘      │
│                                    │                                        │
│  ┌─────────────┐  ┌─────────────┐  │  ┌─────────────┐                       │
│  │ OpenClaw    │  │  Telegram   │  │  │   Config    │                       │
│  │  Sessions   │  │     API     │  │  │   (YAML)    │                       │
│  └─────────────┘  └─────────────┘  │  └─────────────┘                       │
└────────────────────────────────────┴────────────────────────────────────────┘
```

## Component Details

### 1. Session Manager (`src/lib/session-manager.ts`)

The Session Manager is responsible for creating, tracking, and managing agent sessions.

**Key Responsibilities:**
- Generate unique session IDs from project + issue combinations
- Spawn agent sessions via OpenClaw's `sessions_spawn`
- Persist session metadata to disk
- Track session lifecycle (pending → working → completed/errored)

**Key Methods:**
```typescript
class SessionManager {
  create(config: SpawnConfig): Promise<Session>
  spawn(config: SpawnConfig): Promise<Session>
  get(sessionId: string): Session | null
  list(projectId?: string): Session[]
  updateStatus(sessionId: string, status: SessionStatus): Promise<Session>
  complete(sessionId: string, prInfo?: PRInfo): Promise<Session>
  kill(sessionId: string): Promise<void>
}
```

**Session Lifecycle:**
```
Pending → Working → Waiting_PR → Completed
   ↓         ↓          ↓
Errored   Killed      (merged state tracked separately)
```

### 2. Orchestrator (`src/lib/orchestrator.ts`)

The central coordination component that manages complex multi-step tasks.

**Key Responsibilities:**
- Coordinate batch spawning with resource limits
- Manage task decomposition and dependency resolution
- Execute tasks in phases with parallelization support
- Track overall orchestration status and health

**Architecture Pattern:** Event-driven with EventEmitter

**Key Events:**
- `taskCreated` - New task registered
- `taskDecomposing` - Task breakdown in progress
- `taskReady` - Task ready for execution
- `taskRunning` - Task execution started
- `taskCompleted` - Task finished successfully
- `taskFailed` - Task failed
- `batchProgress` - Batch operation progress update
- `resourceReserved` / `resourceReleased` - Resource management

### 3. Task Decomposer (`src/lib/task-decomposer.ts`)

Breaks complex issues into manageable subtasks.

**Key Responsibilities:**
- Analyze task complexity
- Generate subtasks with dependencies
- Estimate effort for each subtask
- Include test and documentation tasks when configured

**Decomposition Strategy:**
```typescript
interface DecomposedTask {
  originalTask: string;
  subtasks: Subtask[];
  estimatedTotalEffort: number;
  canParallelize: boolean;
}

interface Subtask {
  id: string;
  title: string;
  description: string;
  type: 'code' | 'test' | 'docs' | 'refactor' | 'config';
  estimatedEffort: number;
  dependencies: string[];
}
```

### 4. Dependency Resolver (`src/lib/dependency-resolver.ts`)

Manages task dependencies and execution order.

**Key Responsibilities:**
- Build dependency graphs from subtasks
- Detect circular dependencies
- Generate execution phases
- Track task completion status

**Algorithm:**
1. Build directed graph from dependencies
2. Topological sort to determine phases
3. Group independent tasks into parallelizable phases
4. Execute phases sequentially, tasks within phase in parallel

### 5. Resource Manager (`src/lib/resource-manager.ts`)

Manages system resources and concurrency limits.

**Key Responsibilities:**
- Track active agent slots
- Enforce concurrency limits
- Handle resource reservations with timeouts
- Monitor memory usage
- Cleanup stuck resources

**Resource Model:**
```typescript
interface ResourceConfig {
  maxConcurrentAgents: number;
  maxTotalAgents: number;
  timeoutMs: number;
  memoryLimitMB?: number;
}
```

### 6. Batch Spawner (`src/lib/batch-spawner.ts`)

Coordinates spawning multiple sessions efficiently.

**Key Responsibilities:**
- Queue multiple issues for processing
- Respect concurrency limits
- Provide progress updates
- Handle partial failures
- Support both sequential and parallel execution

### 7. GitHub Integration (`src/lib/github.ts`)

Handles all GitHub operations via the `gh` CLI.

**Key Responsibilities:**
- Fetch issue details
- Create and manage PRs
- Monitor CI status
- Retrieve reviews
- Merge PRs

**Operations:**
```typescript
class GitHubIntegration {
  getIssue(issueRef: string): Promise<GitHubIssue | null>
  getPR(branchOrNumber: string): Promise<GitHubPR | null>
  getCIStatus(prNumber: number): Promise<CIStatus>
  getReviews(prNumber: number): Promise<Review[]>
  createPR(options: PRCreationOptions): Promise<GitHubPR | null>
  mergePR(prNumber: number, method: 'merge' | 'squash' | 'rebase'): Promise<boolean>
}
```

### 8. CI Poller (`src/lib/ci-poller.ts`, `src/lib/ci-poller-optimized.ts`)

Monitors CI status with adaptive polling strategies.

**Key Responsibilities:**
- Poll GitHub for CI status changes
- Emit events on status transitions
- Support adaptive polling intervals
- Cache results to reduce API calls

**Polling Strategies:**
- **Fixed Interval**: Constant polling rate
- **Adaptive**: Adjust interval based on activity
- **Exponential Backoff**: Increase interval when no changes

### 9. Learning Engine (`src/learning/index.ts`)

Tracks performance and provides recommendations.

**Key Responsibilities:**
- Record session metrics
- Analyze success/failure patterns
- Generate agent performance reports
- Provide task-type recommendations

**Components:**
- `LearningStorage` - Persistence layer
- `PatternAnalyzer` - Pattern detection
- `RecommendationEngine` - Suggestion generation
- `InsightsGenerator` - Report creation
- `MetricsCollector` - Data collection

### 10. Error Handler (`src/lib/error-handler.ts`)

Comprehensive error handling with recovery strategies.

**Key Responsibilities:**
- Classify errors by category and severity
- Implement retry logic with backoff
- Provide fallback actions
- Track error history and statistics

**Error Categories:**
- `network` - Connection issues
- `github` - GitHub API errors
- `git` - Git operation failures
- `session` - Session management errors
- `config` - Configuration errors
- `system` - System-level errors

**Recovery Strategies:**
```typescript
interface RecoveryStrategy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  retryableErrors: string[];
  fallbackAction?: () => Promise<void>;
}
```

### 11. Performance Optimizer (`src/lib/performance-optimizer.ts`)

Provides caching and performance utilities.

**Key Components:**
- `OptimizedCache` - LRU cache with TTL support
- `LazyLoader` - On-demand data loading
- `BatchProcessor` - Groups operations for efficiency
- `debounce` / `throttle` - Rate limiting utilities
- `memoize` - Function result caching

## Data Flow

### Typical Session Flow

```
1. User/Trigger
   └─> spawn({ issueId: "GH-123", task: "Fix bug" })

2. SessionManager
   ├─> Generate session ID
   ├─> Create git worktree
   ├─> Build task prompt
   └─> Call sessions_spawn

3. OpenClaw
   └─> Spawn agent session

4. LifecycleManager (parallel)
   ├─> Monitor session status
   ├─> Poll GitHub for PR/CI
   └─> Send Telegram notifications

5. Agent
   ├─> Work on issue
   ├─> Create PR
   └─> Signal completion

6. CIPoller
   ├─> Monitor CI status
   ├─> Retry on failure (if configured)
   └─> Auto-merge on success (if configured)

7. LearningEngine
   └─> Record session metrics
```

### Batch Processing Flow

```
1. User
   └─> orchestrator.spawnBatch({ issues: [...] })

2. Orchestrator
   ├─> Validate resource limits
   ├─> Create execution plan
   └─> Queue tasks

3. BatchSpawner
   ├─> Process queue with concurrency limit
   ├─> Spawn sessions in parallel/sequential
   └─> Emit progress events

4. ResourceManager
   ├─> Reserve slots for each task
   ├─> Wait for available resources
   └─> Release on completion

5. Results aggregated and returned
```

## Configuration System

### Configuration Hierarchy

```
Default Config < Global Config < Project Config < Runtime Config
     │               │                │                │
     └───────────────┴────────────────┴────────────────┘
                          │
                    Merged Config
```

### Configuration Sources

1. **Default Config** - Hardcoded defaults in `src/lib/config.ts`
2. **Global Config** - `~/.rhaone-orchestrator/config.yaml`
3. **Project Config** - `{projectPath}/config.yaml`
4. **Runtime Config** - Options passed to constructors/methods

### Environment Variable Substitution

```yaml
github:
  token: ${GITHUB_TOKEN}  # Replaced with process.env.GITHUB_TOKEN
```

## Storage Layer

### Session Storage

Sessions are stored as JSON files:
```
~/.rhaone-orchestrator/
└── projects/
    └── {projectId}/
        └── sessions/
            └── {sessionId}.json
```

### Learning Data Storage

```
~/.rhaone-orchestrator/
└── memory/
    ├── metrics.json       # Session metrics
    ├── patterns.json      # Detected patterns
    ├── recommendations.json # Cached recommendations
    └── config.json        # Learning engine config
```

## Extension Points

### Adding a New Agent Type

1. Add agent configuration to project config
2. Implement agent-specific prompt builder
3. Register in SessionManager

### Adding a New Reaction

1. Define reaction in `LifecycleManager`
2. Implement reaction handler
3. Add to project config

### Adding a New Notification Channel

1. Implement notifier interface
2. Add to `LifecycleManager`
3. Configure in global config

## Security Considerations

### Token Management
- GitHub tokens passed via environment variables
- Never logged or persisted to disk
- Scoped to specific repositories

### Session Isolation
- Each session gets its own git worktree
- Environment variables isolated per session
- No shared state between sessions

### Access Control
- Telegram chat ID whitelisting
- Agent permission levels
- Project-level access controls

## Performance Characteristics

### Scalability
- **Sessions**: Limited by `maxConcurrentAgents` (default: 5)
- **Batch Size**: Limited by `maxTotalAgents` (default: 20)
- **Polling**: Adaptive intervals reduce API usage
- **Caching**: LRU cache reduces redundant operations

### Resource Usage
- **Memory**: ~50MB base + ~10MB per active session
- **Disk**: Session metadata + git worktrees
- **Network**: GitHub API calls + Telegram messages
- **CPU**: Minimal (event-driven architecture)

## Monitoring & Observability

### Metrics Available

- Session success/failure rates
- Average time to PR
- CI retry counts
- Cache hit rates
- Error rates by category
- Resource utilization

### Health Checks

```typescript
orchestrator.getHealth() => {
  healthy: boolean;
  resourceHealth: ResourceHealth;
  tasks: OrchestratorStatus;
}
```

## Future Enhancements

### Phase 6+ Ideas
- Web dashboard for visualization
- Multi-repository coordination
- Advanced scheduling (cron-based)
- Plugin system for custom reactions
- Integration with other CI/CD platforms
- Distributed orchestration across multiple hosts