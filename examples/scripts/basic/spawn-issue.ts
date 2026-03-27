/**
 * Basic Example: Spawn a session for a single GitHub issue
 *
 * This example demonstrates the simplest use case:
 * 1. Initialize the orchestrator
 * 2. Spawn a session for an issue
 * 3. Wait for completion
 * 4. Cleanup
 */

import { init, runTask, cleanupTask, status } from 'rhaone-orchestrator';

async function main() {
  // Get issue number from command line
  const issueNumber = process.argv[2];
  if (!issueNumber) {
    console.error('Usage: npx tsx spawn-issue.ts <issue-number>');
    process.exit(1);
  }

  console.log(`🦞 Rhaone Orchestrator - Spawn Issue Example`);
  console.log(`============================================`);

  try {
    // Step 1: Initialize the orchestrator
    console.log('\n📦 Initializing orchestrator...');
    const ctx = init({
      github: {
        owner: process.env.GITHUB_OWNER || 'your-org',
        repo: process.env.GITHUB_REPO || 'your-repo',
        token: process.env.GITHUB_TOKEN,
      },
    });
    console.log('✅ Orchestrator initialized');

    // Step 2: Spawn a session for the issue
    console.log(`\n🚀 Spawning session for issue #${issueNumber}...`);
    const result = await runTask(`GH-${issueNumber}`, `Fix issue #${issueNumber}`, {
      autoCreatePR: true,
    });

    console.log('✅ Session spawned successfully:');
    console.log(`   Session ID: ${result.sessionId}`);
    console.log(`   Branch: ${result.branch}`);
    console.log(`   Status: ${result.status}`);

    // Step 3: Poll for status (in real usage, this would be event-driven)
    console.log('\n⏳ Monitoring session status...');
    console.log('   (Press Ctrl+C to stop monitoring)');

    const checkInterval = setInterval(() => {
      const currentStatus = status();
      console.log(`   Active: ${currentStatus.sessions.active}, Completed: ${currentStatus.sessions.completed}`);
    }, 30000); // Check every 30 seconds

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      clearInterval(checkInterval);

      // Step 4: Cleanup
      console.log(`🧹 Cleaning up session ${result.sessionId}...`);
      await cleanupTask(result.sessionId);
      console.log('✅ Cleanup complete');

      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
