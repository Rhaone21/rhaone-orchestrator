/**
 * Advanced Example: Custom CI/CD reactions
 *
 * This example demonstrates how to define custom reactions to CI events
 * with different actions based on event type.
 */

import { init, LifecycleManager, LifecycleEvent } from 'rhaone-orchestrator';

async function main() {
  console.log(`🦞 Rhaone Orchestrator - Custom Reactions Example`);
  console.log(`=================================================`);

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

    // Define custom reactions
    const customReactions = {
      ciFailed: {
        enabled: true,
        action: 'auto_fix',      // Options: 'notify', 'auto_fix', 'retry'
        autoRetry: true,
        maxRetries: 3,
        notifyChannels: ['telegram', 'console'],
      },
      ciPassed: {
        enabled: true,
        action: 'auto_merge',    // Options: 'notify', 'auto_merge', 'none'
        requireApproval: false,
        notifyChannels: ['telegram'],
      },
      prCreated: {
        enabled: true,
        action: 'notify',
        notifyChannels: ['telegram', 'console'],
        includeDiff: true,
      },
      sessionCompleted: {
        enabled: true,
        action: 'notify',
        notifyChannels: ['console'],
      },
    };

    console.log('\n⚙️  Custom Reactions Configured:');
    console.log(JSON.stringify(customReactions, null, 2));

    // Create lifecycle manager with custom reactions
    const lifecycleManager = new LifecycleManager({
      sessionManager: ctx.sessionManager,
      github: ctx.github,
      ciPoller: ctx.ciPoller,
      reactions: customReactions,
    });

    // Register custom event handlers
    lifecycleManager.on('ciFailed', async (event: LifecycleEvent) => {
      console.log(`\n🔴 CI Failed for ${event.sessionId}`);
      console.log(`   Issue: ${event.issueId}`);
      console.log(`   Action: Auto-fix enabled`);

      // Custom logic: Analyze failure and attempt fix
      if (customReactions.ciFailed.autoRetry) {
        console.log('   🔄 Attempting auto-retry...');
        // Implementation would retry the session
      }
    });

    lifecycleManager.on('ciPassed', async (event: LifecycleEvent) => {
      console.log(`\n🟢 CI Passed for ${event.sessionId}`);
      console.log(`   Issue: ${event.issueId}`);
      console.log(`   Action: Auto-merge enabled`);

      if (customReactions.ciPassed.action === 'auto_merge') {
        console.log('   🔄 Attempting auto-merge...');
        // Implementation would merge the PR
      }
    });

    lifecycleManager.on('prCreated', async (event: LifecycleEvent) => {
      console.log(`\n📋 PR Created for ${event.sessionId}`);
      console.log(`   Issue: ${event.issueId}`);
      console.log(`   PR: #${event.prNumber}`);

      if (customReactions.prCreated.includeDiff) {
        console.log('   📊 Including diff in notification...');
      }
    });

    // Simulate events (in real usage, these would come from actual CI/CD)
    console.log('\n🎮 Simulating events...');
    console.log('   (In production, these are triggered by actual CI/CD)\n');

    // Example: Simulate a CI passed event
    await lifecycleManager.emit('ciPassed', {
      type: 'ciPassed',
      sessionId: 'session-123',
      issueId: 'GH-456',
      prNumber: 789,
      timestamp: new Date(),
    });

    // Example: Simulate a CI failed event
    await lifecycleManager.emit('ciFailed', {
      type: 'ciFailed',
      sessionId: 'session-124',
      issueId: 'GH-457',
      timestamp: new Date(),
      error: 'Test failure in auth module',
    });

    // Example: Simulate a PR created event
    await lifecycleManager.emit('prCreated', {
      type: 'prCreated',
      sessionId: 'session-123',
      issueId: 'GH-456',
      prNumber: 789,
      timestamp: new Date(),
    });

    console.log('\n✅ Custom reactions example complete!');
    console.log('\n💡 To use in production:');
    console.log('   1. Configure reactions in your config.yaml');
    console.log('   2. The lifecycle manager will auto-handle events');
    console.log('   3. Customize handlers for your workflow');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
