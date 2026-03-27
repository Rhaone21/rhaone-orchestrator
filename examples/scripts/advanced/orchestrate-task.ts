/**
 * Advanced Example: Orchestrate a complex task with decomposition
 *
 * This example demonstrates the full orchestrator with task decomposition,
 * dependency resolution, and parallel execution.
 */

import { init, Orchestrator, TaskDecomposer } from 'rhaone-orchestrator';

async function main() {
  console.log(`🦞 Rhaone Orchestrator - Task Orchestration Example`);
  console.log(`===================================================`);

  const issueNumber = process.argv[2];
  if (!issueNumber) {
    console.error('Usage: npx tsx orchestrate-task.ts <issue-number>');
    process.exit(1);
  }

  try {
    // Initialize the orchestrator
    console.log('\n📦 Initializing orchestrator...');
    const ctx = init({
      github: {
        owner: process.env.GITHUB_OWNER || 'your-org',
        repo: process.env.GITHUB_REPO || 'your-repo',
        token: process.env.GITHUB_TOKEN,
      },
    });

    // Create the main orchestrator
    const orchestrator = new Orchestrator(ctx.sessionManager, {
      maxConcurrentAgents: 5,
      maxTotalAgents: 20,
      defaultTimeoutMs: 30 * 60 * 1000, // 30 minutes
    });

    console.log(`\n🚀 Orchestrating task for issue #${issueNumber}...`);
    console.log('   Features enabled:');
    console.log('   • Task decomposition');
    console.log('   • Dependency resolution');
    console.log('   • Parallel execution');
    console.log('   • Resource management\n');

    // Orchestrate the task with full features
    const task = await orchestrator.orchestrateTask(
      `GH-${issueNumber}`,
      `Implement feature for issue #${issueNumber}`,
      {
        decompose: true,      // Enable task decomposition
        execute: true,        // Execute subtasks
        parallel: true,       // Enable parallel execution
        maxConcurrent: 3,     // Max 3 concurrent subtasks
      }
    );

    console.log('✅ Task orchestrated successfully!\n');
    console.log('📋 Task Details:');
    console.log(`   ID: ${task.id}`);
    console.log(`   Issue: ${task.issueId}`);
    console.log(`   Status: ${task.status}`);
    console.log(`   Subtasks: ${task.subtasks?.length || 0}`);

    if (task.subtasks && task.subtasks.length > 0) {
      console.log('\n📋 Subtasks:');
      for (const subtask of task.subtasks) {
        const statusEmoji = {
          'pending': '⏳',
          'in_progress': '🔵',
          'completed': '✅',
          'failed': '❌',
        }[subtask.status] || '⚪';

        console.log(`   ${statusEmoji} ${subtask.id}: ${subtask.description}`);
        if (subtask.dependencies.length > 0) {
          console.log(`      Dependencies: ${subtask.dependencies.join(', ')}`);
        }
      }
    }

    // Get orchestrator status
    const status = orchestrator.getStatus();
    console.log('\n📊 Orchestrator Status:');
    console.log(`   Active Tasks: ${status.activeTasks}`);
    console.log(`   Completed Tasks: ${status.completedTasks}`);
    console.log(`   Failed Tasks: ${status.failedTasks}`);
    console.log(`   Available Slots: ${status.availableSlots}`);

    // Monitor progress
    console.log('\n⏳ Monitoring progress...');
    console.log('   (Press Ctrl+C to stop)');

    const interval = setInterval(() => {
      const currentStatus = orchestrator.getStatus();
      console.log(`   [${new Date().toISOString()}] Active: ${currentStatus.activeTasks}, Completed: ${currentStatus.completedTasks}`);

      if (currentStatus.activeTasks === 0) {
        console.log('\n✅ All tasks completed!');
        clearInterval(interval);
      }
    }, 10000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping...');
      clearInterval(interval);
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
