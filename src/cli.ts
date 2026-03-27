/**
 * Rhaone Orchestrator CLI
 * Command-line interface for orchestrator operations
 */

import { SessionManager, sessionManager } from './lib/session-manager';
import { GitWorktreeHandler, gitWorktree } from './lib/git-worktree';
import { GitHubIntegration } from './lib/github';
import { PRCreator } from './lib/pr-creator';
import { LineageTracker } from './lib/lineage-tracker';

export interface CliContext {
  sessionManager: SessionManager;
  worktreeHandler: GitWorktreeHandler;
  github?: GitHubIntegration;
  prCreator?: PRCreator;
}

/**
 * Initialize the orchestrator
 */
export async function init(): Promise<CliContext> {
  return {
    sessionManager,
    worktreeHandler: gitWorktree,
  };
}

/**
 * Run a task in a new session
 */
export async function runTask(
  issueId: string,
  task: string,
  options?: {
    projectId?: string;
    agent?: string;
    model?: string;
  }
): Promise<{ sessionId: string; branch: string }> {
  const session = await sessionManager.spawn({
    projectId: options?.projectId || 'default',
    issueId,
    task,
    agent: options?.agent,
    model: options?.model,
  });

  return {
    sessionId: session.id,
    branch: session.branch,
  };
}

/**
 * Get status of a session
 */
export function getSession(sessionId: string) {
  return sessionManager.get(sessionId);
}

/**
 * List all sessions
 */
export function listSessions(projectId?: string) {
  return sessionManager.list(projectId);
}

/**
 * Complete a session
 */
export async function completeSession(sessionId: string): Promise<void> {
  await sessionManager.complete(sessionId);
}

// ============================================================
// CLI Entry Point — process.argv handling
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const cmdArgs = args.slice(1);

  const lineageTracker = new LineageTracker(sessionManager);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    // ── list ─────────────────────────────────────────────────
    case 'list': {
      const sessions = sessionManager.list();
      if (sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }
      console.log(`\nSessions (${sessions.length} total):\n`);
      sessions.forEach(s => {
        const icon = s.status === 'completed' ? '✅'
                   : s.status === 'working'   ? '🔄'
                   : s.status === 'errored'   ? '❌'
                   : s.status === 'killed'    ? '💀'
                   : s.status === 'merged'    ? '🎉'
                   : '⏳';
        const lineageTag = s.lineage ? ` [subtask: ${s.lineage.subtaskTitle}]` : '';
        console.log(`  ${icon} ${s.id} (${s.status})${lineageTag}`);
        console.log(`     Branch: ${s.branch}`);
        if (s.lineage) {
          console.log(`     Parent task: ${s.lineage.parentTaskId}`);
        }
      });
      break;
    }

    // ── spawn ────────────────────────────────────────────────
    case 'spawn': {
      const issueId = cmdArgs[0];
      const task = cmdArgs.slice(1).join(' ');
      if (!issueId) {
        console.error('Usage: rhaone spawn <issueId> [task description]');
        process.exit(1);
      }
      const session = await sessionManager.spawn({
        projectId: 'default',
        issueId,
        task: task || `Work on ${issueId}`,
      });
      console.log(`Session created: ${session.id}`);
      console.log(`Branch: ${session.branch}`);
      break;
    }

    // ── status ───────────────────────────────────────────────
    case 'status': {
      const sessionId = cmdArgs[0];
      if (!sessionId) {
        console.error('Usage: rhaone status <sessionId>');
        process.exit(1);
      }
      const session = sessionManager.get(sessionId);
      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        process.exit(1);
      }
      console.log(`\nSession: ${session.id}`);
      console.log(`Status:  ${session.status}`);
      console.log(`Branch:  ${session.branch}`);
      console.log(`Issue:   ${session.issueId}`);
      console.log(`Created: ${session.createdAt}`);
      if (session.pr) {
        console.log(`PR:      #${session.pr.number} — ${session.pr.url}`);
      }
      if (session.error) {
        console.log(`Error:   ${session.error}`);
      }
      if (session.lineage) {
        console.log(`\nLineage:`);
        console.log(`  Parent task: ${session.lineage.parentTaskId}`);
        console.log(`  Subtask:     ${session.lineage.subtaskTitle} (${session.lineage.subtaskType})`);
        console.log(`  Level:       ${session.lineage.decompositionLevel}`);
      }
      console.log(`\nMetrics:`);
      console.log(`  Spawn duration: ${session.metrics.spawnDuration}ms`);
      console.log(`  CI passes:      ${session.metrics.ciPasses}`);
      console.log(`  CI failures:    ${session.metrics.ciFailures}`);
      break;
    }

    // ── decompose ────────────────────────────────────────────
    case 'decompose': {
      const issueId = cmdArgs[0];
      const task = cmdArgs.slice(1).join(' ');
      if (!issueId || !task) {
        console.error('Usage: rhaone decompose <issueId> <task description>');
        process.exit(1);
      }
      console.log(`Decomposing task for issue ${issueId}...`);
      const lineage = await lineageTracker.decomposeAndSpawn(
        'default',
        issueId,
        task
      );
      console.log(`\nTask ID:    ${lineage.taskId}`);
      console.log(`Complexity: ${lineage.decomposition.complexity}`);
      console.log(`Subtasks:   ${lineage.decomposition.subtasks.length}`);
      console.log(`Phases:     ${lineage.executionPlan.phases.length}`);
      console.log('\nSubtasks:');
      lineage.decomposition.subtasks.forEach((s, i) => {
        const sessionId = lineage.subtaskSessions[s.id];
        console.log(`  ${i + 1}. [${s.type}] ${s.title}`);
        if (sessionId) console.log(`     Session: ${sessionId}`);
        if (s.dependencies.length > 0) {
          console.log(`     Depends on: ${s.dependencies.join(', ')}`);
        }
      });
      break;
    }

    // ── lineage ──────────────────────────────────────────────
    case 'lineage': {
      const id = cmdArgs[0];
      if (!id) {
        console.error('Usage: rhaone lineage <taskId or issueId>');
        process.exit(1);
      }

      // Try by taskId first, then fall back to issueId search
      let tree = lineageTracker.getLineageTree(id);
      if (!tree) {
        const byIssue = lineageTracker.findLineageByIssue(id);
        if (byIssue) tree = lineageTracker.getLineageTree(byIssue.taskId);
      }

      if (!tree) {
        console.error(`No lineage found for: ${id}`);
        console.error('Tip: use "rhaone tasks" to list all tracked tasks');
        process.exit(1);
      }

      console.log(`\nTask:    ${tree.title}`);
      console.log(`Issue:   ${tree.issueId}`);
      console.log(`ID:      ${tree.taskId}`);
      console.log(`Status:  ${tree.status}  |  Complexity: ${tree.complexity}`);
      console.log(`Progress: ${tree.summary.completed}/${tree.summary.total} completed` +
        ` (${tree.summary.running} running, ${tree.summary.pending} pending, ${tree.summary.failed} failed)`);
      console.log('\nSubtask Tree:');

      tree.subtasks.forEach(node => {
        const icon = node.status === 'completed' ? '✅'
                   : node.status === 'running'   ? '🔄'
                   : node.status === 'failed'    ? '❌'
                   : '⏳';
        console.log(`  ${icon} [${node.type}] ${node.title}`);
        if (node.sessionId) {
          console.log(`       Session: ${node.sessionId} (${node.sessionStatus})`);
        }
        if (node.branch) {
          console.log(`       Branch:  ${node.branch}`);
        }
        if (node.dependencies.length > 0) {
          console.log(`       Deps:    ${node.dependencies.join(', ')}`);
        }
      });
      break;
    }

    // ── tasks ────────────────────────────────────────────────
    case 'tasks': {
      const tasks = lineageTracker.listTasks();
      if (tasks.length === 0) {
        console.log('No decomposed tasks found.');
        console.log('Tip: use "rhaone decompose <issueId> <task>" to decompose a task');
        return;
      }
      console.log(`\nDecomposed Tasks (${tasks.length} total):\n`);
      tasks.forEach(t => {
        const icon = t.status === 'completed' ? '✅'
                   : t.status === 'running'   ? '🔄'
                   : t.status === 'failed'    ? '❌'
                   : '⏳';
        console.log(`  ${icon} ${t.taskId}`);
        console.log(`     Issue: ${t.issueId}  |  Status: ${t.status}`);
        console.log(`     Task:  ${t.title}`);
        console.log(`     Created: ${t.createdAt}`);
      });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Rhaone Orchestrator CLI

Usage: rhaone <command> [options]

Commands:
  list                            List all sessions
  spawn <issueId> [task]          Spawn a new agent session
  status <sessionId>              Show session details
  decompose <issueId> <task>      Decompose task into subtasks & spawn agents
  lineage <taskId|issueId>        Show task decomposition tree & session status
  tasks                           List all decomposed tasks
  help                            Show this help

Examples:
  rhaone list
  rhaone spawn AUTH-001 "Fix login bug"
  rhaone status default-AUTH001-a3f9b2c1
  rhaone decompose AUTH-001 "Implement JWT authentication system"
  rhaone lineage AUTH-001
  rhaone tasks
`);
}

// Run CLI if this is the main module
if (require.main === module) {
  main().catch(err => {
    console.error('[CLI] Fatal error:', err);
    process.exit(1);
  });
}
