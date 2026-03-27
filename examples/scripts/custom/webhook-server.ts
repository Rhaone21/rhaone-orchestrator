/**
 * Custom Example: Webhook Server Integration
 *
 * This example demonstrates how to create a custom webhook server
 * that receives GitHub webhooks and triggers orchestrator actions.
 */

import { createServer } from 'http';
import { init, runTask } from 'rhaone-orchestrator';

// Simple webhook handler
async function handleWebhook(payload: any, event: string) {
  console.log(`\n📥 Received webhook: ${event}`);

  switch (event) {
    case 'issues':
      if (payload.action === 'opened' || payload.action === 'labeled') {
        const issueNumber = payload.issue?.number;
        const labels = payload.issue?.labels?.map((l: any) => l.name) || [];

        console.log(`   Issue #${issueNumber} ${payload.action}`);
        console.log(`   Labels: ${labels.join(', ')}`);

        // Auto-spawn for issues with specific labels
        if (labels.includes('auto-fix') || labels.includes('bug')) {
          console.log('   🚀 Auto-spawning session...');
          const result = await runTask(
            `GH-${issueNumber}`,
            `Fix issue #${issueNumber}: ${payload.issue?.title}`,
            { autoCreatePR: true }
          );
          console.log(`   ✅ Session spawned: ${result.sessionId}`);
        }
      }
      break;

    case 'pull_request':
      if (payload.action === 'opened') {
        console.log(`   PR #${payload.pull_request?.number} opened`);
        console.log(`   Title: ${payload.pull_request?.title}`);
        // Could trigger notifications here
      }
      break;

    case 'workflow_run':
      console.log(`   Workflow ${payload.workflow_run?.name}: ${payload.workflow_run?.status}`);
      if (payload.workflow_run?.status === 'completed') {
        console.log(`   Conclusion: ${payload.workflow_run?.conclusion}`);
      }
      break;

    default:
      console.log(`   Unhandled event type: ${event}`);
  }
}

async function main() {
  console.log(`🦞 Rhaone Orchestrator - Webhook Server Example`);
  console.log(`================================================`);

  const PORT = process.env.PORT || 3000;

  try {
    // Initialize the orchestrator
    console.log('\n📦 Initializing orchestrator...');
    init({
      github: {
        owner: process.env.GITHUB_OWNER || 'your-org',
        repo: process.env.GITHUB_REPO || 'your-repo',
        token: process.env.GITHUB_TOKEN,
      },
    });
    console.log('✅ Orchestrator initialized');

    // Create HTTP server
    const server = createServer(async (req, res) => {
      // Only handle POST requests to /webhook
      if (req.method !== 'POST' || req.url !== '/webhook') {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      // Get GitHub event type from headers
      const event = req.headers['x-github-event'] as string;
      const signature = req.headers['x-hub-signature-256'] as string;

      if (!event) {
        res.statusCode = 400;
        res.end('Missing X-GitHub-Event header');
        return;
      }

      // Read body
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          // In production, verify webhook signature here
          // verifySignature(body, signature, WEBHOOK_SECRET);

          const payload = JSON.parse(body);
          await handleWebhook(payload, event);

          res.statusCode = 200;
          res.end('OK');
        } catch (error) {
          console.error('Error processing webhook:', error);
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });
    });

    server.listen(PORT, () => {
      console.log(`\n🌐 Webhook server listening on port ${PORT}`);
      console.log(`   Endpoint: http://localhost:${PORT}/webhook`);
      console.log('\n📋 Supported events:');
      console.log('   • issues (opened, labeled)');
      console.log('   • pull_request (opened)');
      console.log('   • workflow_run');
      console.log('\n💡 Configure this URL in your GitHub repository settings');
      console.log('   Settings → Webhooks → Add webhook');
      console.log('\n⚠️  In production, use a proper webhook verification');
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Shutting down...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
