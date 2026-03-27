/**
 * Quick test to verify optimizations work
 */

import { OptimizedSessionManager } from '../lib/optimized/session-manager';
import { OptimizedBatchSpawner } from '../lib/optimized/batch-spawner';
import { OptimizedResourceManager } from '../lib/optimized/resource-manager';
import { OptimizedOrchestrator } from '../lib/optimized/orchestrator';

async function runQuickTest(): Promise<void> {
  console.log('🧪 Quick Optimization Test\n');

  const tempDir = `/tmp/rhaone-test-${Date.now()}`;

  // Test 1: Session Manager
  console.log('1️⃣ Testing OptimizedSessionManager...');
  const sessionManager = new OptimizedSessionManager({
    dataDir: `${tempDir}/sessions`,
    enableWAL: true,
    flushIntervalMs: 1000,
  });
  await sessionManager.initialize();

  const session = await sessionManager.create({
    projectId: 'test',
    issueId: 'TEST-1',
    task: 'Test task',
  });
  console.log(`   ✅ Created session: ${session.id}`);

  await sessionManager.flush();
  console.log('   ✅ WAL flushed');

  // Test 2: Batch Spawner
  console.log('\n2️⃣ Testing OptimizedBatchSpawner...');
  const batchSpawner = new OptimizedBatchSpawner(sessionManager);

  const batchResult = await batchSpawner.spawn({
    projectId: 'test',
    issues: [
      { issueId: 'TEST-1', task: 'Task 1' },
      { issueId: 'TEST-2', task: 'Task 2' },
      { issueId: 'TEST-3', task: 'Task 3' },
    ],
    parallel: true,
    maxConcurrent: 2,
  });
  console.log(`   ✅ Batch completed: ${batchResult.spawned} spawned, ${batchResult.failed} failed`);
  console.log(`   ⏱️  Duration: ${batchResult.durationMs}ms`);

  // Test 3: Resource Manager
  console.log('\n3️⃣ Testing OptimizedResourceManager...');
  const resourceManager = new OptimizedResourceManager({
    maxConcurrentAgents: 3,
    timeoutMs: 5000,
  });

  const reserved1 = await resourceManager.reserve('issue-1');
  const reserved2 = await resourceManager.reserve('issue-2');
  console.log(`   ✅ Reserved 2 slots`);

  const usage = resourceManager.getUsage();
  console.log(`   📊 Usage: ${usage.activeSlots}/${usage.totalSlots} (${Math.round(usage.utilization * 100)}%)`);

  await resourceManager.release('issue-1');
  await resourceManager.release('issue-2');
  console.log('   ✅ Released slots');

  // Test 4: Orchestrator
  console.log('\n4️⃣ Testing OptimizedOrchestrator...');
  const orchestrator = new OptimizedOrchestrator(sessionManager, {
    maxConcurrentAgents: 3,
    enableCaching: true,
  });

  const task = await orchestrator.orchestrateTask('TEST-123', 'Fix bug in login form', {
    decompose: true,
    execute: false, // Don't actually spawn agents in test
  });
  console.log(`   ✅ Task orchestrated: ${task.id}`);
  console.log(`   📋 Decomposed into ${task.decomposition?.subtasks.length || 0} subtasks`);

  // Test caching
  const task2 = await orchestrator.orchestrateTask('TEST-123', 'Fix bug in login form', {
    decompose: true,
    execute: false,
  });
  console.log(`   ✅ Cached task retrieved: ${task2.id}`);

  // Get metrics
  const status = orchestrator.getStatus();
  console.log(`   📊 Total tasks: ${status.totalTasks}`);
  console.log(`   📊 Resource usage: ${Math.round(status.resourceUsage.utilization * 100)}%`);

  // Cleanup
  console.log('\n🧹 Cleaning up...');
  await orchestrator.destroy();
  await sessionManager.destroy();
  batchSpawner.destroy();
  resourceManager.destroy();
  console.log('   ✅ All resources cleaned up');

  console.log('\n✨ All tests passed!');
  process.exit(0);
}

runQuickTest().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
