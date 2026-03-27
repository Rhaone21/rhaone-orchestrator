/**
 * Basic Example: Cleanup completed sessions
 *
 * This example demonstrates how to cleanup old sessions and their worktrees.
 */

import { init } from 'rhaone-orchestrator';

async function main() {
  console.log(`🦞 Rhaone Orchestrator - Cleanup Example`);
  console.log(`========================================`);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const olderThan = args.includes('--older-than')
    ? parseInt(args[args.indexOf('--older-than') + 1]) || 7
    : 7; // Default: 7 days

  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
  }

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
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThan);

    console.log(`\n🧹 Looking for sessions older than ${olderThan} days...`);
    console.log(`   Cutoff date: ${cutoffDate.toISOString()}\n`);

    // Find sessions to cleanup
    const toCleanup = sessions.filter(session => {
      // Cleanup completed or failed sessions older than cutoff
      return (session.status === 'completed' || session.status === 'failed') &&
             session.createdAt < cutoffDate;
    });

    if (toCleanup.length === 0) {
      console.log('✅ No sessions need cleanup');
      return;
    }

    console.log(`Found ${toCleanup.length} session(s) to cleanup:\n`);

    for (const session of toCleanup) {
      console.log(`  🗑️  ${session.id}`);
      console.log(`     Issue: ${session.issueId}`);
      console.log(`     Status: ${session.status}`);
      console.log(`     Created: ${session.createdAt.toISOString()}`);

      if (!dryRun) {
        try {
          await ctx.sessionManager.complete(session.id);
          console.log(`     ✅ Cleaned up successfully`);
        } catch (error) {
          console.log(`     ❌ Error: ${error}`);
        }
      }
      console.log('');
    }

    if (dryRun) {
      console.log('\n🔍 Dry run complete. Run without --dry-run to actually cleanup.');
    } else {
      console.log(`\n✅ Cleanup complete. Removed ${toCleanup.length} session(s).`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
