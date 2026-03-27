/**
 * Custom Example: Slack Integration
 *
 * This example demonstrates how to integrate with Slack for notifications
 * instead of or in addition to Telegram.
 */

import { init, LifecycleManager } from 'rhaone-orchestrator';

// Slack webhook URL (configure in your Slack app)
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

async function sendSlackMessage(message: {
  text?: string;
  blocks?: any[];
  attachments?: any[];
}) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('   ⚠️  SLACK_WEBHOOK_URL not set, skipping Slack notification');
    return;
  }

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status}`);
    }

    console.log('   ✅ Slack notification sent');
  } catch (error) {
    console.error('   ❌ Failed to send Slack notification:', error);
  }
}

async function notifySessionStarted(session: any) {
  await sendSlackMessage({
    text: `🚀 Session started for issue ${session.issueId}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🦞 Rhaone Orchestrator',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Session ID:*\n${session.id}`,
          },
          {
            type: 'mrkdwn',
            text: `*Issue:*\n${session.issueId}`,
          },
          {
            type: 'mrkdwn',
            text: `*Status:*\n${session.status}`,
          },
          {
            type: 'mrkdwn',
            text: `*Branch:*\n${session.branch}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Task:*\n${session.task}`,
        },
      },
    ],
  });
}

async function notifySessionCompleted(session: any, pr?: any) {
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '✅ Session Completed',
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Session ID:*\n${session.id}`,
        },
        {
          type: 'mrkdwn',
          text: `*Issue:*\n${session.issueId}`,
        },
        {
          type: 'mrkdwn',
          text: `*Duration:*\n${Math.round(session.duration / 60)} minutes`,
        },
      ],
    },
  ];

  if (pr) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Pull Request:*\n<${pr.url}|#${pr.number}>`,
      },
    });
  }

  await sendSlackMessage({ blocks });
}

async function notifyCIStatus(session: any, status: string, details?: string) {
  const emoji = status === 'success' ? '🟢' : status === 'failure' ? '🔴' : '🟡';

  await sendSlackMessage({
    text: `${emoji} CI ${status.toUpperCase()} for ${session.issueId}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} CI ${status.toUpperCase()}`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Session:*\n${session.id}`,
          },
          {
            type: 'mrkdwn',
            text: `*Issue:*\n${session.issueId}`,
          },
        ],
      },
      ...(details ? [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details:*\n${details}`,
        },
      }] : []),
    ],
  });
}

async function main() {
  console.log(`🦞 Rhaone Orchestrator - Slack Integration Example`);
  console.log(`===================================================`);

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

    console.log('\n📱 Slack Integration Setup');
    console.log('='.repeat(50));

    if (!SLACK_WEBHOOK_URL) {
      console.log('\n⚠️  SLACK_WEBHOOK_URL not set');
      console.log('   Set it with: export SLACK_WEBHOOK_URL=https://hooks.slack.com/...');
      console.log('\n💡 To create a webhook:');
      console.log('   1. Go to your Slack workspace');
      console.log('   2. Apps → Incoming Webhooks → Add to Slack');
      console.log('   3. Choose a channel and copy the webhook URL');
    } else {
      console.log('\n✅ Slack webhook configured');
    }

    // Create lifecycle manager with Slack notifications
    const lifecycleManager = new LifecycleManager({
      sessionManager: ctx.sessionManager,
      github: ctx.github,
      ciPoller: ctx.ciPoller,
    });

    // Add Slack notification handlers
    lifecycleManager.on('sessionStarted', async (event) => {
      console.log('\n📤 Sending Slack notification: Session Started');
      await notifySessionStarted({
        id: event.sessionId,
        issueId: event.issueId,
        status: 'working',
        branch: event.branch,
        task: event.task,
      });
    });

    lifecycleManager.on('sessionCompleted', async (event) => {
      console.log('\n📤 Sending Slack notification: Session Completed');
      await notifySessionCompleted(
        {
          id: event.sessionId,
          issueId: event.issueId,
          duration: event.duration || 3600,
        },
        event.prNumber ? { number: event.prNumber, url: event.prUrl } : undefined
      );
    });

    lifecycleManager.on('ciStatusChanged', async (event) => {
      console.log(`\n📤 Sending Slack notification: CI ${event.status}`);
      await notifyCIStatus(
        { id: event.sessionId, issueId: event.issueId },
        event.status,
        event.details
      );
    });

    // Simulate events
    console.log('\n🎮 Simulating events...\n');

    await lifecycleManager.emit('sessionStarted', {
      type: 'sessionStarted',
      sessionId: 'session-123',
      issueId: 'GH-456',
      branch: 'feat/auto-fix-456',
      task: 'Fix authentication bug',
      timestamp: new Date(),
    });

    await lifecycleManager.emit('ciStatusChanged', {
      type: 'ciStatusChanged',
      sessionId: 'session-123',
      issueId: 'GH-456',
      status: 'success',
      timestamp: new Date(),
    });

    await lifecycleManager.emit('sessionCompleted', {
      type: 'sessionCompleted',
      sessionId: 'session-123',
      issueId: 'GH-456',
      prNumber: 789,
      prUrl: 'https://github.com/org/repo/pull/789',
      duration: 1800,
      timestamp: new Date(),
    });

    console.log('\n✅ Slack integration example complete!');
    console.log('\n💡 To use in production:');
    console.log('   1. Set SLACK_WEBHOOK_URL environment variable');
    console.log('   2. The lifecycle manager will auto-send notifications');
    console.log('   3. Customize the message format as needed');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
