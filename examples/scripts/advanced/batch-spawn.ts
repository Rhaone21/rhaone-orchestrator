/**
 * Advanced Example: Batch spawn multiple issues
 *
 * This example demonstrates how to spawn multiple sessions in parallel
 * with concurrency control and progress tracking.
 */

import { init, BatchSpawner } from 'rhaone-orchestrator';

async function main() {
  console.log(`🦞 Rhaone Orchestrator - Batch Spawn Example`);
  console.log(`============================================`);

  // Example issue numbers (in real usage, these would come from args or API)
  const issueNumbers = process.argv.slice(2);
  if (issueNumbers.length === 0) {
    console.error('Usage: npx tsx batch-spawn.ts <issue-1> <issue-2> ...');
    console.error('Example: npx tsx batch-spawn.ts 123 124 125');
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

    // Create batch spawner with concurrency control
    const batchSpawner = new BatchSpawner(ctx.sessionManager, {
      maxConcurrent: 3,           // Max 3 concurrent sessions
      maxTotal: 10,               // Max 10 total sessions
      continueOnError: true,      // Continue if one fails
      autoCleanup: false,         // Manual cleanup for demo
    });

    // Prepare issues
    const issues = issueNumbers.map(num => ({
      issueId: `GH-${num}`,
      task: `Fix issue #${num}`,
      projectId: 'default',
    }));

    console.log(`\n🚀 Batch spawning ${issues.length} issues...`);
    console.log(`   Max concurrent: 3`);
    console.log(`   Continue on error: true\n`);

    // Track progress
    batchSpawner.on('progress', (event) => {
      const percent = Math.round((event.completed / event.total) * 100);
      console.log(`   📊 Progress: ${event.completed}/${event.total} (${percent}%) - ${event.status}`);
    });

    batchSpawner.on('sessionSpawned', (result) => {
      console.log(`   ✅ Spawned: ${result.issueId} → ${result.sessionId}`);
    });

    batchSpawner.on('sessionFailed', (result) => {
      console.log(`   ❌ Failed: ${result.issueId} - ${result.error}`);
    });

    // Execute batch spawn
    const startTime = Date.now();
    const results = await batchSpawner.spawnBatch(issues, {
      parallel: true,
      maxConcurrent: 3,
    });
    const duration = Date.now() - startTime;

    // Display results
    console.log('\n📋 Batch Results:');
    console.log('='.repeat(50));

    const successful = results.results.filter(r => r.success);
    const failed = results.results.filter(r => !r.success);

    console.log(`\n✅ Successful: ${successful.length}`);
    for (const result of successful) {
      console.log(`   • ${result.issueId} → ${result.sessionId}`);
    }

    if (failed.length > 0) {
      console.log(`\n❌ Failed: ${failed.length}`);
      for (const result of failed) {
        console.log(`   • ${result.issueId}: ${result.error}`);
      }
    }

    console.log(`\n⏱️  Duration: ${duration}ms`);
    console.log(`📊 Stats:`, results.stats);

    // Summary
    console.log('\n📊 Summary:');
    console.log(`   Total: ${results.stats.total}`);
    console.log(`   Successful: ${results.stats.successful}`);
    console.log(`   Failed: ${results.stats.failed}`);
    console.log(`   Duration: ${results.stats.durationMs}ms`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
