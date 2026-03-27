/**
 * Basic Example: List all active sessions
 *
 * This example shows how to query and display session information.
 */

import { init, SessionManager } from 'rhaone-orchestrator';

async function main() {
  console.log(`🦞 Rhaone Orchestrator - List Sessions Example`);
  console.log(`==============================================`);

  try {
    // Initialize the orchestrator
    const ctx = init({
      github: {
        owner: process.env.GITHUB_OWNER || 'your-org',
        repo: process.env.GITHUB_REPO || 'your-repo',
        token: process.env.GITHUB_TOKEN,
      },
    });

    // Get all sessions
    const sessions = ctx.sessionManager.list();

    if (sessions.length === 0) {
      console.log('\n📭 No sessions found');
      return;
    }

    console.log(`\n📋 Found ${sessions.length} session(s):\n`);

    // Group sessions by status
    const byStatus = sessions.reduce((acc, session) => {
      acc[session.status] = acc[session.status] || [];
      acc[session.status].push(session);
      return acc;
    }, {} as Record<string, typeof sessions>);

    // Display sessions by status
    const statusOrder = ['working', 'pending', 'completed', 'failed'];
    for (const status of statusOrder) {
      const statusSessions = byStatus[status];
      if (!statusSessions || statusSessions.length === 0) continue;

      const emoji = {
        working: '🔵',
        pending: '⏳',
        completed: '✅',
        failed: '❌',
      }[status] || '⚪';

      console.log(`${emoji} ${status.toUpperCase()} (${statusSessions.length})`);
      console.log('-'.repeat(50));

      for (const session of statusSessions) {
        console.log(`  ID: ${session.id}`);
        console.log(`  Issue: ${session.issueId}`);
        console.log(`  Task: ${session.task}`);
        console.log(`  Project: ${session.projectId}`);
        console.log(`  Branch: ${session.branch}`);
        console.log(`  Created: ${session.createdAt.toISOString()}`);
        if (session.prNumber) {
          console.log(`  PR: #${session.prNumber}`);
        }
        console.log('');
      }
    }

    // Summary
    console.log('\n📊 Summary:');
    console.log(`   Total: ${sessions.length}`);
    console.log(`   Active: ${sessions.filter(s => s.status === 'working').length}`);
    console.log(`   Pending: ${sessions.filter(s => s.status === 'pending').length}`);
    console.log(`   Completed: ${sessions.filter(s => s.status === 'completed').length}`);
    console.log(`   Failed: ${sessions.filter(s => s.status === 'failed').length}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
