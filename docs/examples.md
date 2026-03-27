# Examples

Practical examples for common use cases.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Session Management](#session-management)
- [GitHub Integration](#github-integration)
- [CI/CD Monitoring](#cicd-monitoring)
- [Learning Engine](#learning-engine)
- [Batch Operations](#batch-operations)
- [Task Decomposition](#task-decomposition)
- [Error Handling](#error-handling)
- [Custom Reactions](#custom-reactions)
- [Telegram Notifications](#telegram-notifications)

## Basic Usage

### Initialize and Run a Task

```typescript
import { init, runTask, status, cleanupTask } from 'rhaone-orchestrator';

async function main() {
  // Initialize
  const ctx = await init();
  
  // Run a task
  const { sessionId } = await runTask('GH-123');
  
  // Check status
  const stats = await status(sessionId);
  console.log('Status:', stats);
  
  // Cleanup when done
  await cleanupTask(sessionId);
}

main().catch(console.error);
```

### Simple Session Creation

```typescript
import { SessionManager } from 'rhaone-orchestrator';

const manager = new SessionManager();

const session = await manager.create({
  projectId: 'my-project',
  issueId: 'GH-456',
  task: 'Fix the login bug',
});

console.log('Created:', session.id);
```

## Session Management

### List and Filter Sessions

```typescript
import { sessionManager } from 'rhaone-orchestrator';

// All sessions
const all = sessionManager.list();

// By project
const projectSessions = sessionManager.list('my-project');

// Active only
const active = sessionManager.listActive();

// Filter by status
const working = all.filter(s => s.status === 'working');
const completed = all.filter(s => s.status === 'completed');

// Sort by date
const sorted = all.sort((a, b) => 
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
);
```

### Monitor Session Progress

```typescript
import { SessionManager } from 'rhaone-orchestrator';

const manager = new SessionManager();

async function monitorSession(sessionId: string) {
  const session = manager.get(sessionId);
  if (!session) {
    console.log('Session not found');
    return;
  }
  
  console.log(`Session ${session.id}:`);
  console.log(`  Status: ${session.status}`);
  console.log(`  Issue: ${session.issueId}`);
  console.log(`  Branch: ${session.branch}`);
  console.log(`  Created: ${session.createdAt}`);
  
  if (session.pr) {
    console.log(`  PR: #${session.pr.number} (${session.pr.state})`);
    console.log(`  URL: ${session.pr.url}`);
  }
  
  if (session.error) {
    console.log(`  Error: ${session.error}`);
  }
}
```

### Bulk Session Operations

```typescript
import { sessionManager } from 'rhaone-orchestrator';

// Kill all errored sessions
const errored = sessionManager.list()
  .filter(s => s.status === 'errored');

for (const session of errored) {
  await sessionManager.kill(session.id);
  console.log(`Killed ${session.id}`);
}

// Complete all sessions for a merged PR
const completed = sessionManager.list()
  .filter(s => s.pr?.state === 'merged' && s.status !== 'completed');

for (const session of completed) {
  await sessionManager.updateStatus(session.id, 'completed');
}
```

## GitHub Integration

### Create and Manage PRs

```typescript
import { GitHubIntegration } from 'rhaone-orchestrator';

const github = new GitHubIntegration({
  owner: 'my-org',
  repo: 'my-repo',
  token: process.env.GITHUB_TOKEN,
});

// Create PR
const pr = await github.createPR({
  title: 'Fix: Resolve memory leak',
  body: `Fixes #123

This PR addresses the memory leak issue by:
- Properly closing database connections
- Cleaning up event listeners
- Adding garbage collection hints`,
  head: 'fix/memory-leak',
  base: 'main',
  draft: false,
});

if (pr) {
  console.log(`Created PR #${pr.number}: ${pr.url}`);
  
  // Check if mergeable
  if (pr.mergeable) {
    // Merge with squash
    const merged = await github.mergePR(pr.number, 'squash');
    if (merged) {
      console.log('Merged successfully!');
    }
  }
}
```

### Monitor CI Status

```typescript
import { GitHubIntegration } from 'rhaone-orchestrator';

const github = new GitHubIntegration({
  owner: 'my-org',
  repo: 'my-repo',
  token: process.env.GITHUB_TOKEN,
});

async function checkCI(prNumber: number) {
  const status = await github.getCIStatus(prNumber);
  
  console.log(`CI Status: ${status.state}`);
  console.log(`Checks: ${status.passedChecks}/${status.totalChecks} passed`);
  
  if (status.failedChecks > 0) {
    console.log('Failed checks:');
    for (const check of status.checks) {
      if (check.conclusion === 'failure') {
        console.log(`  - ${check.name}: ${check.url}`);
      }
    }
  }
  
  return status.state === 'success';
}
```

### Get Issue Details

```typescript
import { GitHubIntegration } from 'rhaone-orchestrator';

const github = new GitHubIntegration({
  owner: 'my-org',
  repo: 'my-repo',
  token: process.env.GITHUB_TOKEN,
});

// Get issue
const issue = await github.getIssue('GH-123');
// or
const issue = await github.getIssue('#123');
// or
const issue = await github.getIssue('123');

if (issue) {
  console.log(`#${issue.number}: ${issue.title}`);
  console.log(`State: ${issue.state}`);
  console.log(`Labels: ${issue.labels.join(', ')}`);
  console.log(`Body: ${issue.body}`);
}
```

## CI/CD Monitoring

### Basic CI Polling

```typescript
import { SessionManager, OptimizedCIPoller } from 'rhaone-orchestrator';
import { GitHubIntegration } from 'rhaone-orchestrator';

const sessionManager = new SessionManager();
const github = new GitHubIntegration({
  owner: 'my-org',
  repo: 'my-repo',
  token: process.env.GITHUB_TOKEN,
});

const ciPoller = new OptimizedCIPoller({
  sessionManager,
  github,
  pollInterval: 30000,
  adaptivePolling: true,
});

// Listen for status changes
ciPoller.on('statusChange', (event) => {
  console.log(`CI ${event.type} for ${event.sessionId}`);
  
  if (event.type === 'ci.passed') {
    console.log('✅ CI passed!');
  } else if (event.type === 'ci.failed') {
    console.log('❌ CI failed!');
  }
});

// Start polling for a session
const session = await sessionManager.create({
  projectId: 'my-project',
  issueId: 'GH-123',
  task: 'Fix bug',
});

ciPoller.startPolling(session.id);

// Stop when done
setTimeout(() => {
  ciPoller.stopPolling(session.id);
}, 600000); // 10 minutes
```

### Auto-Merge on CI Pass

```typescript
import { LifecycleManager } from 'rhaone-orchestrator';

const lifecycle = new LifecycleManager({
  sessionManager,
  github,
  ciPoller,
});

// Configure auto-merge
lifecycle.updateConfig({
  ciPassed: {
    enabled: true,
    action: 'auto_merge',
  },
});

// Handle CI passed
lifecycle.on('ci.passed', async (event) => {
  await lifecycle.handleCIPassed(event.session.id);
});
```

## Learning Engine

### Record Session Metrics

```typescript
import { learningEngine } from 'rhaone-orchestrator';

// Record successful session
learningEngine.recordSession({
  sessionId: 'session-123',
  issueId: 'GH-456',
  projectId: 'my-project',
  agentType: 'kimi',
  taskType: 'bugfix',
  success: true,
  duration: 1800,  // 30 minutes
  ciRetries: 0,
  linesChanged: 150,
  testsAdded: 5,
});

// Record failed session
learningEngine.recordSession({
  sessionId: 'session-124',
  issueId: 'GH-457',
  projectId: 'my-project',
  agentType: 'kimi',
  taskType: 'feature',
  success: false,
  duration: 3600,
  ciRetries: 3,
});
```

### Get Recommendations

```typescript
import { learningEngine } from 'rhaone-orchestrator';

// Get recommendation for task type
const rec = learningEngine.getRecommendation('bugfix');

console.log('Recommendation:');
console.log(`  Agent: ${rec.agent}`);
console.log(`  Estimated time: ${rec.estimatedDuration} minutes`);
console.log(`  Confidence: ${(rec.confidence * 100).toFixed(1)}%`);
console.log(`  Reasoning: ${rec.reasoning}`);

// Get all patterns
const patterns = learningEngine.getPatterns();
for (const pattern of patterns) {
  console.log(`${pattern.type}: ${pattern.description}`);
  console.log(`  Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
  console.log(`  Occurrences: ${pattern.occurrences}`);
}
```

### Generate Insights Report

```typescript
import { learningEngine } from 'rhaone-orchestrator';

// Generate 7-day report
const report = learningEngine.getInsightsReport(7);

console.log('=== Insights Report ===');
console.log(`Period: ${report.period.start.toDateString()} - ${report.period.end.toDateString()}`);
console.log('');

console.log('Summary:');
console.log(`  Total sessions: ${report.summary.totalSessions}`);
console.log(`  Success rate: ${(report.summary.successRate * 100).toFixed(1)}%`);
console.log(`  Average duration: ${Math.round(report.summary.averageDuration / 60)} minutes`);
console.log('');

console.log('Top Patterns:');
for (const pattern of report.patterns.slice(0, 5)) {
  console.log(`  - ${pattern.description}`);
}

console.log('');
console.log('Recommendations:');
for (const rec of report.recommendations) {
  console.log(`  - ${rec.taskType}: use ${rec.agent} (${(rec.confidence * 100).toFixed(0)}% confidence)`);
}

// Send to Telegram
const telegramMessage = learningEngine.getInsightsForTelegram(7);
// await telegramBot.sendMessage(chatId, telegramMessage);
```

## Batch Operations

### Spawn Multiple Sessions

```typescript
import { Orchestrator } from 'rhaone-orchestrator';

const orchestrator = new Orchestrator(sessionManager, {
  maxConcurrentAgents: 5,
  defaultParallel: true,
});

// Define issues to process
const issues = [
  { issueId: 'GH-101', task: 'Fix login bug' },
  { issueId: 'GH-102', task: 'Update documentation' },
  { issueId: 'GH-103', task: 'Refactor auth module' },
  { issueId: 'GH-104', task: 'Add tests' },
  { issueId: 'GH-105', task: 'Optimize queries' },
];

// Spawn in batch
const results = await orchestrator.spawnBatch({
  issues,
  parallel: true,
  maxConcurrent: 3,
  failFast: false, // Continue even if some fail
});

console.log('Batch complete:');
console.log(`  Successful: ${results.successful.length}`);
console.log(`  Failed: ${results.failed.length}`);
console.log(`  Sessions: ${results.sessions.map(s => s.id).join(', ')}`);

// Check individual results
for (const result of results.results) {
  if (result.success) {
    console.log(`✅ ${result.issueId}: ${result.sessionId}`);
  } else {
    console.log(`❌ ${result.issueId}: ${result.error}`);
  }
}
```

### Process Issues from Label

```typescript
import { GitHubIntegration, Orchestrator } from 'rhaone-orchestrator';

const github = new GitHubIntegration({ owner, repo, token });
const orchestrator = new Orchestrator(sessionManager);

async function processLabelledIssues(label: string) {
  // Get issues with label (using gh CLI)
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  const { stdout } = await execAsync(
    `gh issue list --label "${label}" --json number,title --limit 10`
  );
  
  const issues = JSON.parse(stdout);
  
  // Convert to batch config
  const batchIssues = issues.map(issue => ({
    issueId: `GH-${issue.number}`,
    task: issue.title,
  }));
  
  // Process in batch
  const results = await orchestrator.spawnBatch({
    issues: batchIssues,
    parallel: true,
    maxConcurrent: 3,
  });
  
  return results;
}

// Process all "good first issue" items
await processLabelledIssues('good first issue');
```

## Task Decomposition

### Decompose Complex Tasks

```typescript
import { Orchestrator } from 'rhaone-orchestrator';

const orchestrator = new Orchestrator(sessionManager);

// Decompose a complex task
const decomposed = orchestrator.decomposeTask(
  'Implement user authentication system with OAuth, JWT tokens, and refresh token rotation',
  'GH-200'
);

console.log(`Decomposed into ${decomposed.subtasks.length} subtasks:`);
console.log(`Estimated total time: ${decomposed.estimatedTotalTime} minutes`);
console.log(`Can parallelize: ${decomposed.canParallelize}`);

for (const subtask of decomposed.subtasks) {
  console.log(`\n${subtask.id}: ${subtask.title}`);
  console.log(`  Type: ${subtask.type}`);
  console.log(`  Estimated: ${subtask.estimatedTime} minutes`);
  console.log(`  Dependencies: ${subtask.dependencies.join(', ') || 'none'}`);
  console.log(`  Description: ${subtask.description}`);
}
```

### Execute with Dependencies

```typescript
import { Orchestrator } from 'rhaone-orchestrator';

const orchestrator = new Orchestrator(sessionManager);

// Orchestrate with full pipeline
const task = await orchestrator.orchestrateTask('GH-201', 
  'Build REST API with authentication, rate limiting, and documentation',
  {
    decompose: true,
    execute: true,
    parallel: true,
    maxConcurrent: 3,
  }
);

console.log(`Task ${task.id} ${task.status}`);
console.log(`Completed subtasks: ${task.completedSubtasks.join(', ')}`);
console.log(`Sessions: ${task.sessionIds.join(', ')}`);

// Get execution plan
if (task.executionPlan) {
  console.log(`\nExecution plan:`);
  for (const phase of task.executionPlan.phases) {
    console.log(`  Phase ${phase.id}: ${phase.tasks.join(', ')}`);
  }
}
```

## Error Handling

### Wrap Operations with Retry

```typescript
import { ErrorHandler } from 'rhaone-orchestrator';

const errorHandler = new ErrorHandler({
  defaultStrategy: {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
  },
});

// Wrap GitHub operations
const safeGetIssue = errorHandler.wrap(
  github.getIssue.bind(github),
  { sessionId: 'session-123' }
);

// This will retry on transient failures
const issue = await safeGetIssue('123');
```

### Custom Error Handling

```typescript
import { ErrorHandler } from 'rhaone-orchestrator';

const errorHandler = new ErrorHandler({
  onCriticalError: (error) => {
    console.error('CRITICAL ERROR:', error);
    // Send alert to PagerDuty/Slack
    sendAlert(error);
  },
  onRecoveryFailure: (error) => {
    console.error('Recovery failed:', error);
    // Log to error tracking service
    trackError(error);
  },
});

// Execute with custom strategy
try {
  const result = await errorHandler.handle(
    () => github.createPR({ title, body, head, base }),
    { operation: 'createPR', sessionId: 'session-123' },
    {
      maxRetries: 5,
      backoffMs: 2000,
      fallbackAction: async () => {
        console.log('PR creation failed, creating issue instead');
        await github.createIssue({ title, body });
      },
    }
  );
} catch (error) {
  console.error('All retries exhausted:', error);
}
```

### Error Statistics

```typescript
import { errorHandler } from 'rhaone-orchestrator';

// Get error stats
const stats = errorHandler.getStats(24 * 60 * 60 * 1000); // Last 24 hours

console.log('Error Statistics:');
console.log(`  Total: ${stats.total}`);
console.log(`  Recovery rate: ${(stats.recoveryRate * 100).toFixed(1)}%`);

console.log('By Category:');
for (const [category, count] of Object.entries(stats.byCategory)) {
  if (count > 0) {
    console.log(`  ${category}: ${count}`);
  }
}

console.log('By Severity:');
for (const [severity, count] of Object.entries(stats.bySeverity)) {
  if (count > 0) {
    console.log(`  ${severity}: ${count}`);
  }
}
```

## Custom Reactions

### Register Custom Reaction

```typescript
import { LifecycleManager } from 'rhaone-orchestrator';

const lifecycle = new LifecycleManager({
  sessionManager,
  github,
  ciPoller,
});

// Register custom reaction for CI failure
lifecycle.registerReaction(
  'ci.failed',
  {
    enabled: true,
    action: 'notify',
    autoRetry: true,
    maxRetries: 3,
  },
  async (event) => {
    console.log(`CI failed for ${event.session.issueId}`);
    
    // Get CI logs
    const status = await github.getCIStatus(event.session.pr!.number);
    
    // Send to Slack
    await sendSlackNotification({
      text: `CI Failed for ${event.session.issueId}`,
      attachments: status.checks
        .filter(c => c.conclusion === 'failure')
        .map(c => ({
          title: c.name,
          title_link: c.url,
          color: 'danger',
        })),
    });
    
    // Auto-retry if configured
    if (event.session.metadata?.ciRetries < 3) {
      console.log('Scheduling retry...');
      // Retry logic here
    }
  }
);

// Register reaction for review approval
lifecycle.registerReaction(
  'review.approved',
  {
    enabled: true,
    action: 'notify',
  },
  async (event) => {
    const { session, data } = event;
    
    console.log(`PR approved for ${session.issueId}`);
    
    // Check if CI passed
    const ciStatus = await github.getCIStatus(session.pr!.number);
    
    if (ciStatus.state === 'success') {
      // Auto-merge
      await github.mergePR(session.pr!.number, 'squash');
      await sessionManager.updateStatus(session.id, 'merged');
      
      console.log('Auto-merged!');
    } else {
      console.log('CI not passed, waiting...');
    }
  }
);
```

### Conditional Reactions

```typescript
import { LifecycleManager } from 'rhaone-orchestrator';

const lifecycle = new LifecycleManager({ sessionManager, github, ciPoller });

// Only auto-merge if no "WIP" in PR title
lifecycle.registerReaction(
  'ci.passed',
  { enabled: true, action: 'auto_merge' },
  async (event) => {
    const pr = await github.getPR(event.session.pr!.number.toString());
    
    if (pr && !pr.title.toLowerCase().includes('wip')) {
      await github.mergePR(pr.number, 'squash');
      console.log('Auto-merged');
    } else {
      console.log('Skipping merge - WIP in title');
    }
  }
);

// Only notify on first failure
const notifiedSessions = new Set<string>();

lifecycle.registerReaction(
  'ci.failed',
  { enabled: true, action: 'notify' },
  async (event) => {
    if (notifiedSessions.has(event.session.id)) {
      return; // Already notified
    }
    
    notifiedSessions.add(event.session.id);
    
    await sendNotification({
      session: event.session,
      message: 'CI failed for the first time',
    });
  }
);
```

## Telegram Notifications

### Basic Setup

```typescript
import { Telegraf } from 'telegraf';
import { LifecycleManager } from 'rhaone-orchestrator';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const chatId = process.env.TELEGRAM_CHAT_ID;

const lifecycle = new LifecycleManager({
  sessionManager,
  github,
  ciPoller,
  telegram: bot,
});

// Start bot
bot.launch();
```

### Custom Notification Format

```typescript
import { LifecycleManager } from 'rhaone-orchestrator';

// Override notification formatting
lifecycle.on('session.started', async (event) => {
  const { session } = event;
  
  const message = `
🚀 *New Session Started*

*Project:* ${session.projectId}
*Issue:* ${session.issueId}
*Branch:* \`${session.branch}\`
*Started:* ${new Date(session.createdAt).toLocaleString()}

Agent is now working on this issue.
  `.trim();
  
  await bot.telegram.sendMessage(chatId, message, {
    parse_mode: 'MarkdownV2',
  });
});

lifecycle.on('ci.passed', async (event) => {
  const { session } = event;
  
  const message = `
✅ *CI Passed*

*Issue:* ${session.issueId}
*PR:* [#${session.pr?.number}](${session.pr?.url})
*Status:* All checks passed

Ready to merge\!
  `.trim();
  
  await bot.telegram.sendMessage(chatId, message, {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [[
        { text: 'View PR', url: session.pr?.url },
        { text: 'Merge', callback_data: `merge:${session.id}` },
      ]],
    },
  });
});
```

### Interactive Buttons

```typescript
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Handle callback queries
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, sessionId] = data.split(':');
  
  const session = sessionManager.get(sessionId);
  if (!session) {
    await ctx.answerCbQuery('Session not found');
    return;
  }
  
  switch (action) {
    case 'merge':
      await github.mergePR(session.pr!.number, 'squash');
      await sessionManager.updateStatus(sessionId, 'merged');
      await ctx.answerCbQuery('Merged successfully!');
      await ctx.editMessageText('✅ PR merged');
      break;
      
    case 'retry':
      // Retry failed CI
      await ctx.answerCbQuery('Retrying CI...');
      // Trigger retry logic
      break;
      
    case 'kill':
      await sessionManager.kill(sessionId);
      await ctx.answerCbQuery('Session killed');
      await ctx.editMessageText('❌ Session killed');
      break;
  }
});

// Send message with action buttons
async function sendActionNotification(session: Session) {
  await bot.telegram.sendMessage(chatId, `
⚠️ *CI Failed*

Session: ${session.id}
Issue: ${session.issueId}

What would you like to do?
  `.trim(), {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔁 Retry', callback_data: `retry:${session.id}` },
          { text: '🗑️ Kill', callback_data: `kill:${session.id}` },
        ],
        [
          { text: '👀 View PR', url: session.pr?.url },
        ],
      ],
    },
  });
}
```

## Performance Optimization

### Cache Configuration

```typescript
import { OptimizedCache } from 'rhaone-orchestrator';

// Create optimized cache
const cache = new OptimizedCache<CIStatus>({
  maxSize: 1000,
  defaultTTL: 30000,        // 30 seconds
  maxMemoryMB: 100,
  cleanupInterval: 60000,   // 1 minute
});

// Monitor cache performance
setInterval(() => {
  const metrics = cache.getMetrics();
  console.log(`Cache hit rate: ${(metrics.hitRate * 100).toFixed(2)}%`);
  console.log(`Evictions: ${metrics.evictions}`);
  console.log(`Memory: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
}, 60000);
```

### Debounced Operations

```typescript
import { debounce } from 'rhaone-orchestrator';

// Debounce status updates
const debouncedUpdate = debounce(
  async (sessionId: string, status: SessionStatus) => {
    await sessionManager.updateStatus(sessionId, status);
    console.log(`Updated ${sessionId} to ${status}`);
  },
  1000,  // Wait 1 second after last call
  { leading: false, trailing: true }
);

// Call multiple times - only last one executes
for (let i = 0; i < 10; i++) {
  debouncedUpdate('session-123', 'working');
}
```

### Throttled Operations

```typescript
import { throttle } from 'rhaone-orchestrator';

// Throttle CI checks
const throttledCheck = throttle(
  async (sessionId: string) => {
    const status = await ciPoller.forceRefresh(sessionId);
    return status;
  },
  5000  // Max once per 5 seconds
);

// This will only execute once per 5 seconds
setInterval(() => {
  throttledCheck('session-123');
}, 1000);
```

## Complete Workflow Example

```typescript
import {
  SessionManager,
  GitHubIntegration,
  OptimizedCIPoller,
  LifecycleManager,
  Orchestrator,
  LearningEngine,
  ErrorHandler,
} from 'rhaone-orchestrator';
import { Telegraf } from 'telegraf';

async function main() {
  // Initialize components
  const sessionManager = new SessionManager();
  const github = new GitHubIntegration({
    owner: process.env.GITHUB_OWNER!,
    repo: process.env.GITHUB_REPO!,
    token: process.env.GITHUB_TOKEN!,
  });
  
  const errorHandler = new ErrorHandler({
    onCriticalError: (error) => {
      console.error('CRITICAL:', error);
      process.exit(1);
    },
  });
  
  const ciPoller = new OptimizedCIPoller({
    sessionManager,
    github,
    adaptivePolling: true,
    errorHandler,
  });
  
  const telegram = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
  
  const lifecycle = new LifecycleManager({
    sessionManager,
    github,
    ciPoller,
    telegram,
  });
  
  const orchestrator = new Orchestrator(sessionManager, {
    maxConcurrentAgents: 5,
    defaultParallel: true,
  });
  
  const learningEngine = new LearningEngine();
  
  // Configure reactions
  lifecycle.updateConfig({
    ciPassed: { enabled: true, action: 'auto_merge' },
    ciFailed: { enabled: true, action: 'notify', autoRetry: true, maxRetries: 3 },
    reviewApproved: { enabled: true, action: 'auto_merge' },
  });
  
  // Start Telegram bot
  telegram.launch();
  
  // Process issues
  const issues = [
    { issueId: 'GH-101', task: 'Fix login bug' },
    { issueId: 'GH-102', task: 'Update docs' },
    { issueId: 'GH-103', task: 'Add tests' },
  ];
  
  // Spawn batch
  const results = await orchestrator.spawnBatch({
    issues,
    parallel: true,
    maxConcurrent: 3,
  });
  
  console.log('Batch complete:', results);
  
  // Record metrics
  for (const session of results.sessions) {
    learningEngine.recordSession({
      sessionId: session.id,
      issueId: session.issueId,
      projectId: session.projectId,
      agentType: 'kimi',
      taskType: 'bugfix',
      success: session.status === 'completed',
      duration: Math.round(
        (Date.now() - new Date(session.createdAt).getTime()) / 1000
      ),
    });
  }
  
  // Generate insights
  const report = learningEngine.getInsightsReport(7);
  console.log('Insights:', report.summary);
  
  // Cleanup
  lifecycle.destroy();
  ciPoller.destroy();
  orchestrator.destroy();
  telegram.stop();
}

main().catch(console.error);
```
