# Rhaone Orchestrator - API Documentation

## Table of Contents

- [Core API](#core-api)
  - [SessionManager](#sessionmanager)
  - [Orchestrator](#orchestrator)
  - [GitHubIntegration](#githubintegration)
- [Phase 3: Learning Engine](#phase-3-learning-engine)
- [Phase 4: Task Intelligence](#phase-4-task-intelligence)
- [Phase 5: Performance & Error Handling](#phase-5-performance--error-handling)
- [Configuration API](#configuration-api)
- [CLI API](#cli-api)

---

## Core API

### SessionManager

The SessionManager is the primary interface for creating and managing agent sessions.

#### Constructor

```typescript
import { SessionManager } from 'rhaone-orchestrator';

const sessionManager = new SessionManager({
  dataDir: '~/.rhaone-orchestrator/projects',  // Optional
});
```

#### Methods

##### `create(config: SpawnConfig): Promise<Session>`

Creates a new session without spawning an agent.

```typescript
const session = await sessionManager.create({
  projectId: 'my-project',
  issueId: 'GH-123',
  task: 'Fix authentication bug in login flow',
  agent: 'kimi',           // Optional, default from config
  model: 'claude-sonnet-4-20250514',  // Optional
  branch: 'feat/GH-123-fix-auth',     // Optional, auto-generated
  workdir: '/path/to/worktree',       // Optional
});

console.log(session.id);      // "my-project-GH-123-a1b2"
console.log(session.branch);  // "feat/GH-123-fix-auth"
console.log(session.status);  // "pending"
```

##### `spawn(config: SpawnConfig): Promise<Session>`

Creates and immediately spawns a new agent session.

```typescript
const session = await sessionManager.spawn({
  projectId: 'my-project',
  issueId: 'GH-123',
  task: 'Fix authentication bug',
});

// Session is now "working" status
console.log(session.openclawSessionId);  // "agent:kimi:subagent:xxx"
```

##### `get(sessionId: string): Session | null`

Retrieves a session by ID.

```typescript
const session = sessionManager.get('my-project-GH-123-a1b2');
if (session) {
  console.log(session.status);
  console.log(session.metrics.spawnDuration);
}
```

##### `list(projectId?: string): Session[]`

Lists all sessions, optionally filtered by project.

```typescript
// All sessions
const allSessions = sessionManager.list();

// Project-specific sessions
const projectSessions = sessionManager.list('my-project');

// Filter by status
const activeSessions = projectSessions.filter(
  s => s.status === 'working'
);
```

##### `listActive(projectId?: string): Session[]`

Lists only active sessions (pending, working, waiting_pr).

```typescript
const active = sessionManager.listActive('my-project');
console.log(`${active.length} active sessions`);
```

##### `updateStatus(sessionId: string, status: SessionStatus, extra?: Partial<Session>): Promise<Session | null>`

Updates a session's status.

```typescript
await sessionManager.updateStatus('my-project-GH-123-a1b2', 'working');

// With additional data
await sessionManager.updateStatus('session-id', 'waiting_pr', {
  pr: { number: 456, url: 'https://...', state: 'open' }
});
```

##### `complete(sessionId: string, prInfo?: { number: number; url: string }): Promise<Session | null>`

Marks a session as completed.

```typescript
await sessionManager.complete('session-id', {
  number: 456,
  url: 'https://github.com/org/repo/pull/456'
});
```

##### `kill(sessionId: string): Promise<void>`

Terminates a session.

```typescript
await sessionManager.kill('session-id');
```

##### `send(sessionId: string, message: string): Promise<void>`

Sends a message to a running session.

```typescript
await sessionManager.send('session-id', 'Please also add tests for this fix');
```

#### Types

```typescript
interface SpawnConfig {
  projectId: string;
  issueId: string;
  task: string;
  agent?: string;
  model?: string;
  branch?: string;
  workdir?: string;
}

type SessionStatus = 'pending' | 'working' | 'waiting_pr' | 'completed' | 'errored' | 'killed' | 'merged';

interface Session {
  id: string;
  projectId: string;
  issueId: string;
  branch: string;
  status: SessionStatus;
  openclawSessionId?: string;
  pr?: {
    number: number;
    url: string;
    state: string;
  };
  createdAt: string;
  lastActivityAt: string;
  metrics: {
    spawnDuration: number;
    prOpenDuration?: number;
    ciPasses: number;
    ciFailures: number;
  };
  error?: string;
  metadata?: Record<string, any>;
}
```

---

### Orchestrator

The Orchestrator provides high-level coordination for complex tasks.

#### Constructor

```typescript
import { Orchestrator } from 'rhaone-orchestrator';

const orchestrator = new Orchestrator(sessionManager, {
  maxConcurrentAgents: 5,      // Max parallel agents
  maxTotalAgents: 20,          // Max total agents in a batch
  defaultTimeoutMs: 30 * 60 * 1000,  // 30 minutes
  defaultParallel: true,       // Default to parallel execution
  defaultMaxConcurrent: 5,     // Default concurrency for batches
  failFast: true,              // Stop on first failure
  maxSubtasks: 10,             // Max subtasks per decomposition
  includeTests: true,          // Include test subtasks
  includeDocs: false,          // Include documentation subtasks
});
```

#### Methods

##### `orchestrateTask(issueId: string, task: string, options?): Promise<OrchestratedTask>`

Main method for orchestrating a complete task workflow.

```typescript
const result = await orchestrator.orchestrateTask('GH-123', 'Fix complex bug', {
  decompose: true,      // Break into subtasks
  execute: true,        // Actually execute
  parallel: true,       // Execute subtasks in parallel where possible
  maxConcurrent: 3,     // Max concurrent subtasks
});

console.log(result.id);
console.log(result.status);           // 'completed'
console.log(result.completedSubtasks); // ['subtask-1', 'subtask-2']
console.log(result.sessionIds);        // ['session-1', 'session-2']
```

##### `spawnBatch(config: BatchSpawnConfig): Promise<BatchSpawnResult>`

Spawns multiple sessions in a batch.

```typescript
const result = await orchestrator.spawnBatch({
  issues: [
    { issueId: 'GH-123', task: 'Fix bug A' },
    { issueId: 'GH-124', task: 'Fix bug B' },
    { issueId: 'GH-125', task: 'Fix bug C' },
  ],
  parallel: true,
  maxConcurrent: 2,
  continueOnError: true,
});

console.log(result.completed);  // ['GH-123', 'GH-124']
console.log(result.failed);     // ['GH-125']
console.log(result.sessions);   // Session details
```

##### `decomposeTask(task: string, issueId?: string, config?): DecomposedTask`

Decomposes a task into subtasks.

```typescript
const decomposition = orchestrator.decomposeTask(
  'Implement user authentication',
  'GH-123'
);

console.log(decomposition.subtasks);
// [
//   { id: '1', title: 'Create auth middleware', type: 'code', ... },
//   { id: '2', title: 'Add login endpoint', type: 'code', dependencies: ['1'], ... },
//   { id: '3', title: 'Write tests', type: 'test', dependencies: ['2'], ... }
// ]
```

##### `resolveDependencies(subtasks: Subtask[]): { graph: any; plan: ExecutionPlan }`

Builds dependency graph and execution plan.

```typescript
const { graph, plan } = orchestrator.resolveDependencies(subtasks);

console.log(plan.phases);
// [
//   { id: 1, tasks: ['1'], canRunParallel: true },
//   { id: 2, tasks: ['2'], canRunParallel: true },
//   { id: 3, tasks: ['3'], canRunParallel: true }
// ]
```

##### `getStatus(): OrchestratorStatus`

Gets current orchestrator status.

```typescript
const status = orchestrator.getStatus();
console.log(status.activeTasks);     // 3
console.log(status.completedTasks);  // 10
console.log(status.failedTasks);     // 1
console.log(status.resourceUsage);   // { activeSlots: 3, availableSlots: 2, ... }
```

##### `getTask(taskId: string): OrchestratedTask | undefined`

Gets a specific task by ID.

```typescript
const task = orchestrator.getTask('orch-GH-123-abc123');
console.log(task.status);
console.log(task.completedSubtasks);
```

##### `getTaskByIssue(issueId: string): OrchestratedTask | undefined`

Finds a task by issue ID.

```typescript
const task = orchestrator.getTaskByIssue('GH-123');
```

##### `cancelTask(taskId: string): Promise<void>`

Cancels a running task.

```typescript
await orchestrator.cancelTask('orch-GH-123-abc123');
```

##### `getEventHistory(limit?: number): OrchestratorEvent[]`

Gets event history for debugging.

```typescript
const events = orchestrator.getEventHistory(50);
events.forEach(e => console.log(`${e.type}: ${e.timestamp}`));
```

##### `updateResourceConfig(config: Partial<ResourceConfig>): void`

Updates resource configuration at runtime.

```typescript
orchestrator.updateResourceConfig({
  maxConcurrentAgents: 10,
  maxTotalAgents: 50,
});
```

##### `getHealth(): OrchestratorHealth`

Gets comprehensive health status.

```typescript
const health = orchestrator.getHealth();
console.log(health.healthy);           // true
console.log(health.resourceHealth);    // Resource health details
console.log(health.tasks);             // Task status summary
```

##### `cleanup(): number`

Cleans up stuck resource slots.

```typescript
const cleaned = orchestrator.cleanup();
console.log(`Cleaned up ${cleaned} stuck slots`);
```

#### Events

```typescript
orchestrator.on('taskCreated', (event) => console.log('Created:', event.taskId));
orchestrator.on('taskCompleted', (task) => console.log('Completed:', task.id));
orchestrator.on('taskFailed', (task) => console.log('Failed:', task.id, task.error));
orchestrator.on('batchProgress', (event) => console.log('Progress:', event.progress));
orchestrator.on('resourceReserved', (data) => console.log('Reserved:', data.issueId));
orchestrator.on('resourceReleased', (data) => console.log('Released:', data.issueId));
```

---

### GitHubIntegration

Handles all GitHub operations via the `gh` CLI.

#### Constructor

```typescript
import { GitHubIntegration } from 'rhaone-orchestrator';

const github = new GitHubIntegration({
  owner: 'your-org',
  repo: 'your-repo',
  token: process.env.GITHUB_TOKEN,
});
```

#### Methods

##### `getIssue(issueRef: string): Promise<GitHubIssue | null>`

Gets issue details by number or reference.

```typescript
const issue = await github.getIssue('GH-123');
// or
const issue = await github.getIssue('#123');
// or
const issue = await github.getIssue('123');

console.log(issue.title);
console.log(issue.body);
console.log(issue.labels);
```

##### `getPR(branchOrNumber: string): Promise<GitHubPR | null>`

Gets PR by branch name or PR number.

```typescript
const pr = await github.getPR('feat/GH-123-fix');
// or
const pr = await github.getPR('456');

console.log(pr.title);
console.log(pr.state);  // 'open', 'closed', 'merged'
console.log(pr.mergeable);
```

##### `getCIStatus(prNumber: number): Promise<CIStatus>`

Gets CI status for a PR.

```typescript
const status = await github.getCIStatus(456);

console.log(status.state);           // 'success', 'failure', 'pending'
console.log(status.totalChecks);     // 5
console.log(status.passedChecks);    // 4
console.log(status.failedChecks);    // 1

status.checks.forEach(check => {
  console.log(`${check.name}: ${check.conclusion}`);
});
```

##### `getReviews(prNumber: number): Promise<Review[]>`

Gets reviews for a PR.

```typescript
const reviews = await github.getReviews(456);

const approved = reviews.filter(r => r.state === 'APPROVED');
const changesRequested = reviews.filter(r => r.state === 'CHANGES_REQUESTED');
```

##### `createPR(options: PRCreationOptions): Promise<GitHubPR | null>`

Creates a new PR.

```typescript
const pr = await github.createPR({
  title: 'Fix authentication bug',
  body: 'This PR fixes #123 by...',
  head: 'feat/GH-123-fix-auth',
  base: 'main',
  draft: false,
});

console.log(pr.url);
console.log(pr.number);
```

##### `mergePR(prNumber: number, method?: 'merge' | 'squash' | 'rebase'): Promise<boolean>`

Merges a PR.

```typescript
const success = await github.mergePR(456, 'squash');
if (success) {
  console.log('PR merged successfully');
}
```

##### `closePR(prNumber: number): Promise<boolean>`

Closes a PR without merging.

```typescript
await github.closePR(456);
```

##### `getWorkflowRuns(branch: string, limit?: number): Promise<WorkflowRun[]>`

Gets recent workflow runs for a branch.

```typescript
const runs = await github.getWorkflowRuns('feat/GH-123-fix', 5);
runs.forEach(run => {
  console.log(`${run.name}: ${run.status} - ${run.conclusion}`);
});
```

##### `getLatestWorkflowRun(branch: string): Promise<WorkflowRun | null>`

Gets the most recent workflow run.

```typescript
const run = await github.getLatestWorkflowRun('main');
if (run?.conclusion === 'success') {
  console.log('Latest build passed');
}
```

---

## Phase 3: Learning Engine

### LearningEngine

Tracks performance and provides intelligent recommendations.

#### Constructor

```typescript
import { LearningEngine, createLearningEngine } from 'rhaone-orchestrator';

const learning = createLearningEngine({
  enabled: true,
  minSessionsForPattern: 5,
  minSessionsForRecommendation: 3,
  storagePath: '~/.rhaone-orchestrator/memory',
});
```

#### Methods

##### `recordSession(metrics: SessionMetrics): void`

Records a completed session.

```typescript
learning.recordSession({
  sessionId: 'session-123',
  issueId: 'GH-456',
  projectId: 'my-project',
  agentType: 'kimi',
  taskType: 'bugfix',
  success: true,
  duration: 3600,           // seconds
  linesChanged: 150,
  filesModified: 5,
  ciRetries: 1,
  reviewRounds: 0,
});
```

##### `updateSessionProgress(sessionId: string, updates: Partial<SessionMetrics>): void`

Updates metrics mid-session.

```typescript
learning.updateSessionProgress('session-123', {
  linesChanged: 50,
  filesModified: 2,
});
```

##### `getAgentMetrics(): Map<string, AgentMetrics>`

Gets performance metrics by agent type.

```typescript
const metrics = learning.getAgentMetrics();
for (const [agent, data] of metrics) {
  console.log(`${agent}: ${data.successRate}% success rate`);
  console.log(`  Avg time: ${data.avgDuration} seconds`);
}
```

##### `getPatterns(): Pattern[]`

Gets detected success/failure patterns.

```typescript
const patterns = learning.getPatterns();
patterns.forEach(p => {
  console.log(`${p.type}: ${p.description}`);
  console.log(`  Confidence: ${p.confidence}`);
});
```

##### `getRecommendation(taskType: string): Recommendation`

Gets recommendations for a task type.

```typescript
const rec = learning.getRecommendation('bugfix');

console.log(rec.agent);              // Recommended agent
console.log(rec.estimatedDuration);  // Estimated time
console.log(rec.confidence);         // Confidence score (0-1)
console.log(rec.tips);               // ['Add tests early', ...]
```

##### `classifyTask(issueTitle: string, issueBody?: string): string`

Classifies an issue by type.

```typescript
const taskType = learning.classifyTask(
  'Fix login authentication bug',
  'Users cannot log in with valid credentials...'
);
// Returns: 'bugfix', 'feature', 'refactor', 'docs', etc.
```

##### `getInsightsReport(days?: number): InsightsReport`

Generates a comprehensive insights report.

```typescript
const report = learning.getInsightsReport(7);  // Last 7 days

console.log(report.summary);
console.log(report.agentPerformance);
console.log(report.taskTypeAnalysis);
console.log(recommendations);
```

##### `getInsightsForTelegram(days?: number): string`

Gets insights formatted for Telegram.

```typescript
const message = learning.getInsightsForTelegram(7);
// Returns formatted markdown suitable for Telegram
```

##### `getCompactSummary(): string`

Gets a compact summary.

```typescript
const summary = learning.getCompactSummary();
// "7 sessions, 85% success rate, avg 45m per task"
```

##### `getProjectMetrics(projectId: string): SessionMetrics[]`

Gets metrics for a specific project.

```typescript
const metrics = learning.getProjectMetrics('my-project');
```

##### `getRecentMetrics(days?: number): SessionMetrics[]`

Gets recent metrics.

```typescript
const recent = learning.getRecentMetrics(7);
```

##### `getMetricsByAgent(agentType: string): SessionMetrics[]`

Gets metrics filtered by agent.

```typescript
const kimiMetrics = learning.getMetricsByAgent('kimi');
```

##### `cleanupOldMetrics(keepDays?: number): void`

Cleans up old metrics.

```typescript
learning.cleanupOldMetrics(90);  // Keep last 90 days
```

##### `refreshPatterns(): void`

Force recalculates patterns.

```typescript
learning.refreshPatterns();
```

---

## Phase 4: Task Intelligence

### TaskDecomposer

Breaks complex tasks into manageable subtasks.

#### Constructor

```typescript
import { TaskDecomposer } from 'rhaone-orchestrator';

const decomposer = new TaskDecomposer({
  maxSubtasks: 10,
  includeTests: true,
  includeDocs: false,
});
```

#### Methods

##### `decompose(task: string, issueId?: string): DecomposedTask`

Decomposes a task into subtasks.

```typescript
const result = decomposer.decompose(
  'Implement user authentication with JWT',
  'GH-123'
);

console.log(result.originalTask);
console.log(result.estimatedTotalEffort);
console.log(result.canParallelize);

result.subtasks.forEach(sub => {
  console.log(`${sub.id}: ${sub.title} (${sub.type})`);
  console.log(`  Effort: ${sub.estimatedEffort}`);
  console.log(`  Dependencies: ${sub.dependencies.join(', ')}`);
});
```

### DependencyResolver

Manages task dependencies and execution order.

#### Constructor

```typescript
import { DependencyResolver } from 'rhaone-orchestrator';

const resolver = new DependencyResolver();
```

#### Methods

##### `buildGraph(subtasks: Subtask[]): DependencyGraph`

Builds a dependency graph.

```typescript
const graph = resolver.buildGraph(subtasks);
console.log(graph.nodes);
console.log(graph.edges);
```

##### `detectCycles(): string[] | null`

Detects circular dependencies.

```typescript
const cycles = resolver.detectCycles();
if (cycles) {
  console.error('Circular dependencies found:', cycles);
}
```

##### `generateExecutionPlan(): ExecutionPlan`

Generates an execution plan with phases.

```typescript
const plan = resolver.generateExecutionPlan();

plan.phases.forEach(phase => {
  console.log(`Phase ${phase.id}: ${phase.tasks.length} tasks`);
  console.log(`  Can run parallel: ${phase.canRunParallel}`);
  console.log(`  Tasks: ${phase.tasks.join(', ')}`);
});
```

##### `completeTask(taskId: string, success: boolean): void`

Marks a task as completed.

```typescript
resolver.completeTask('subtask-1', true);
```

### ResourceManager

Manages system resources and concurrency.

#### Constructor

```typescript
import { ResourceManager } from 'rhaone-orchestrator';

const resources = new ResourceManager({
  maxConcurrentAgents: 5,
  maxTotalAgents: 20,
  timeoutMs: 30 * 60 * 1000,  // 30 minutes
});
```

#### Methods

##### `reserve(issueId: string): Promise<boolean>`

Reserves a resource slot.

```typescript
const reserved = await resources.reserve('GH-123');
if (reserved) {
  console.log('Resource reserved');
} else {
  console.log('No resources available');
}
```

##### `release(issueId: string): Promise<void>`

Releases a resource slot.

```typescript
await resources.release('GH-123');
```

##### `getUsage(): ResourceUsage`

Gets current resource usage.

```typescript
const usage = resources.getUsage();
console.log(usage.activeSlots);
console.log(usage.availableSlots);
console.log(usage.totalSlots);
console.log(usage.utilizationRate);
```

##### `getHealth(): ResourceHealth`

Gets resource health status.

```typescript
const health = resources.getHealth();
console.log(health.healthy);
console.log(health.activeSlots);
console.log(health.stuckSlots);
```

##### `cleanupStuckSlots(): number`

Cleans up stuck resource slots.

```typescript
const cleaned = resources.cleanupStuckSlots();
console.log(`Cleaned up ${cleaned} stuck slots`);
```

### BatchSpawner

Coordinates spawning multiple sessions.

#### Constructor

```typescript
import { BatchSpawner } from 'rhaone-orchestrator';

const batchSpawner = new BatchSpawner(sessionManager);
```

#### Methods

##### `spawn(config: BatchSpawnConfig): Promise<BatchSpawnResult>`

Spawns a batch of sessions.

```typescript
const result = await batchSpawner.spawn({
  issues: [
    { issueId: 'GH-123', task: 'Fix bug A' },
    { issueId: 'GH-124', task: 'Fix bug B' },
  ],
  parallel: true,
  maxConcurrent: 2,
  continueOnError: true,
  failFast: false,
});

console.log(result.completed.length);
console.log(result.failed.length);
console.log(result.errors);
```

##### `listBatches(): BatchStatus[]`

Lists all batch operations.

```typescript
const batches = batchSpawner.listBatches();
```

#### Events

```typescript
batchSpawner.on('progress', (event) => {
  console.log(`Progress: ${event.completed}/${event.total}`);
});

batchSpawner.on('complete', (result) => {
  console.log('Batch complete:', result);
});
```

---

## Phase 5: Performance & Error Handling

### ErrorHandler

Comprehensive error handling with recovery.

#### Constructor

```typescript
import { ErrorHandler, createErrorHandler } from 'rhaone-orchestrator';

const errorHandler = createErrorHandler({
  maxErrorHistory: 100,
  defaultStrategy: {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    maxBackoffMs: 30000,
  },
});
```

#### Methods

##### `handle<T>(operation: () => Promise<T>, context: ErrorContext): Promise<T>`

Executes an operation with error handling.

```typescript
const result = await errorHandler.handle(
  () => github.getIssue('GH-123'),
  { operation: 'getIssue', issueId: 'GH-123' }
);
```

##### `classifyError(error: Error): ErrorCategory`

Classifies an error.

```typescript
const category = errorHandler.classifyError(error);
// Returns: 'network', 'github', 'git', 'session', 'config', 'system', 'unknown'
```

##### `determineSeverity(error: Error, category: ErrorCategory): ErrorSeverity`

Determines error severity.

```typescript
const severity = errorHandler.determineSeverity(error, category);
// Returns: 'low', 'medium', 'high', 'critical'
```

##### `getErrorHistory(filter?): ErrorRecord[]`

Gets error history.

```typescript
const errors = errorHandler.getErrorHistory({
  category: 'network',
  severity: 'high',
  limit: 10,
});
```

##### `getStats(timeWindowMs?: number): ErrorStats`

Gets error statistics.

```typescript
const stats = errorHandler.getStats(24 * 60 * 60 * 1000);  // Last 24 hours
console.log(stats.total);
console.log(stats.byCategory);
console.log(stats.recoveryRate);
```

##### `wrap<T>(fn: T, context: ErrorContext): T`

Wraps a function with error handling.

```typescript
const safeGetIssue = errorHandler.wrap(
  github.getIssue.bind(github),
  { operation: 'getIssue' }
);

const issue = await safeGetIssue('GH-123');
```

### Performance Optimizer

Caching and performance utilities.

#### OptimizedCache

```typescript
import { createCache } from 'rhaone-orchestrator';

const cache = createCache<string>({
  maxSize: 1000,
  defaultTTL: 5 * 60 * 1000,  // 5 minutes
  maxMemoryMB: 100,
});

// Set value
cache.set('key', 'value', 60000);  // 1 minute TTL

// Get value
const value = cache.get('key');

// Get or compute
const result = await cache.getOrCompute('key', async () => {
  return await fetchData();
});

// Get metrics
const metrics = cache.getMetrics();
console.log(metrics.hitRate);
console.log(metrics.cacheHits);
console.log(metrics.cacheMisses);
```

#### LazyLoader

```typescript
import { createLazyLoader } from 'rhaone-orchestrator';

const loader = createLazyLoader<GitHubIssue>({
  maxSize: 100,
  defaultTTL: 60000,
});

// Register a loader
loader.register('issue-123', {
  loader: () => github.getIssue('GH-123'),
  ttl: 60000,
  preload: true,
});

// Load data
const issue = await loader.load('issue-123');

// Invalidate
loader.invalidate('issue-123');
loader.invalidateAll();
```

#### Utility Functions

```typescript
import { debounce, throttle, memoize } from 'rhaone-orchestrator';

// Debounce
const debounced = debounce(saveData, 1000, { leading: false, trailing: true });
debounced('data');  // Will execute after 1s of inactivity
debounced.cancel(); // Cancel pending execution
debounced.flush();  // Execute immediately

// Throttle
const throttled = throttle(updateUI, 100);
throttled('data');  // Executes at most every 100ms
throttled.cancel(); // Cancel

// Memoize
const memoized = memoize(expensiveCalculation, {
  maxSize: 100,
  ttl: 60000,
  keyGenerator: (a, b) => `${a}-${b}`,
});

const result = memoized(1, 2);
memoized.clear();  // Clear cache
memoized.size();   // Get cache size
```

---

## Configuration API

### Loading Configuration

```typescript
import { loadConfig, loadGlobalConfig, loadProjectConfig } from 'rhaone-orchestrator';

// Load global config
const global = loadGlobalConfig('~/.rhaone-orchestrator/config.yaml');

// Load project config
const project = loadProjectConfig('/path/to/project');

// Load combined config
const config = loadConfig('/path/to/project');
```

### Configuration Types

```typescript
interface GlobalConfig {
  defaults: {
    agent: string;
    model: string;
  };
  github: {
    token?: string;
    owner?: string;
    repo?: string;
  };
  telegram: {
    chatId?: string;
  };
  learning: {
    enabled: boolean;
    minSessionsForPattern: number;
  };
}

interface ProjectConfig {
  project: {
    name: string;
    repo: string;
    path: string;
    defaultBranch: string;
  };
  agents: Record<string, {
    permissions: string;
    model?: string;
  }>;
  reactions: Record<string, {
    action: string;
    autoRetry?: boolean;
    maxRetries?: number;
    requireCI?: boolean;
  }>;
}
```

---

## CLI API

### Programmatic CLI Usage

```typescript
import { init, runTask, status, cleanupTask } from 'rhaone-orchestrator';

// Initialize context
const ctx = await init({
  configPath: '~/.rhaone-orchestrator/config.yaml',
  projectRoot: '/path/to/project',
});

// Run a task
const { sessionId, worktreePath } = await runTask('GH-123', {
  context: ctx,
  description: 'Additional context',
  priority: 'high',
  timeout: 300,
});

// Check status
const stats = await status(sessionId, { context: ctx });

// Cleanup
await cleanupTask(sessionId, { context: ctx, keepBranch: false });
```

### CLI Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `init` | Initialize configuration | `rhaone init` |
| `spawn <issue>` | Spawn session for issue | `rhaone spawn 123` |
| `list` | List all sessions | `rhaone list` |
| `status [id]` | Get session status | `rhaone status abc123` |
| `kill <id>` | Cleanup session | `rhaone kill abc123` |
| `insights` | Show learning insights | `rhaone insights` |
| `batch <issues...>` | Batch spawn | `rhaone batch 123 124 125` |

---

## Type Reference

### Core Types

```typescript
// Session
interface Session {
  id: string;
  projectId: string;
  issueId: string;
  branch: string;
  status: SessionStatus;
  openclawSessionId?: string;
  pr?: {
    number: number;
    url: string;
    state: string;
  };
  createdAt: string;
  lastActivityAt: string;
  metrics: SessionMetrics;
  error?: string;
  metadata?: Record<string, any>;
}

type SessionStatus = 'pending' | 'working' | 'waiting_pr' | 'completed' | 'errored' | 'killed' | 'merged';

// Orchestrated Task
interface OrchestratedTask {
  id: string;
  issueId: string;
  task: string;
  decomposition?: DecomposedTask;
  executionPlan?: ExecutionPlan;
  status: 'pending' | 'decomposing' | 'ready' | 'running' | 'completed' | 'failed';
  currentPhase?: number;
  completedSubtasks: string[];
  sessionIds: string[];
  error?: string;
}

// Subtask
interface Subtask {
  id: string;
  title: string;
  description: string;
  type: 'code' | 'test' | 'docs' | 'refactor' | 'config';
  estimatedEffort: number;
  dependencies: string[];
}

// Execution Plan
interface ExecutionPlan {
  phases: Phase[];
  totalTasks: number;
}

interface Phase {
  id: number;
  tasks: string[];
  canRunParallel: boolean;
}

// Error Types
type ErrorCategory = 'network' | 'github' | 'git' | 'session' | 'config' | 'system' | 'unknown';
type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

interface ErrorRecord {
  id: string;
  timestamp: Date;
  severity: ErrorSeverity;
  category: ErrorCategory;
  message: string;
  stack?: string;
  context: ErrorContext;
  recovered: boolean;
  recoveryAttempts: number;
}

// Learning Types
interface SessionMetrics {
  sessionId: string;
  issueId: string;
  projectId: string;
  agentType: string;
  taskType: string;
  success: boolean;
  duration: number;
  linesChanged: number;
  filesModified: number;
  ciRetries: number;
  reviewRounds: number;
  failureReason?: string;
}

interface Pattern {
  type: string;
  description: string;
  confidence: number;
  occurrences: number;
  successRate: number;
}

interface Recommendation {
  agent: string;
  estimatedDuration: number;
  confidence: number;
  tips: string[];
}

interface InsightsReport {
  period: { start: Date; end: Date };
  summary: {
    totalSessions: number;
    successRate: number;
    avgDuration: number;
  };
  agentPerformance: AgentMetrics[];
  taskTypeAnalysis: TaskTypeMetrics[];
  patterns: Pattern[];
  recommendations: Recommendation[];
}
```

---

## Error Handling

All async methods may throw errors. Use try/catch or the ErrorHandler for robust error handling:

```typescript
import { errorHandler } from 'rhaone-orchestrator';

// Using error handler wrapper
try {
  const result = await errorHandler.handle(
    () => orchestrator.orchestrateTask('GH-123', 'Fix bug'),
    { operation: 'orchestrateTask', issueId: 'GH-123' }
  );
} catch (error) {
  console.error('Operation failed after retries:', error);
}

// Manual error handling
try {
  const session = await sessionManager.spawn(config);
} catch (error) {
  if (error.message.includes('rate limit')) {
    // Handle rate limiting
  } else if (error.message.includes('not found')) {
    // Handle not found
  } else {
    // Handle other errors
  }
}
```