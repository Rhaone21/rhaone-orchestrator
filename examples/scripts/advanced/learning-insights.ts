/**
 * Advanced Example: Generate insights from learning engine
 *
 * This example demonstrates how to use the learning engine to
 * analyze patterns and generate recommendations.
 */

import { init, learningEngine, createLearningEngine } from 'rhaone-orchestrator';

async function main() {
  console.log(`🦞 Rhaone Orchestrator - Learning Insights Example`);
  console.log(`==================================================`);

  // Parse arguments
  const days = parseInt(process.argv[2]) || 7;

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

    // Create learning engine
    const learning = createLearningEngine({
      dataDir: process.env.RHAONE_DATA_DIR || '~/.rhaone-orchestrator',
      minSessionsForPattern: 5,
      minSessionsForRecommendation: 3,
    });

    console.log(`\n📊 Generating insights for last ${days} days...\n`);

    // Get insights report
    const report = learning.getInsightsReport(days);

    // Display summary
    console.log('📋 Summary');
    console.log('='.repeat(50));
    console.log(report.summary);

    // Display patterns
    console.log('\n🔍 Patterns Detected');
    console.log('='.repeat(50));
    if (report.patterns.length === 0) {
      console.log('No patterns detected yet. Need more data.');
    } else {
      for (const pattern of report.patterns) {
        console.log(`\n  📌 ${pattern.name}`);
        console.log(`     Type: ${pattern.type}`);
        console.log(`     Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
        console.log(`     Description: ${pattern.description}`);
      }
    }

    // Display recommendations
    console.log('\n💡 Recommendations');
    console.log('='.repeat(50));
    if (report.recommendations.length === 0) {
      console.log('No recommendations available yet.');
    } else {
      for (const rec of report.recommendations) {
        const priorityEmoji = {
          'high': '🔴',
          'medium': '🟡',
          'low': '🟢',
        }[rec.priority] || '⚪';

        console.log(`\n  ${priorityEmoji} ${rec.title}`);
        console.log(`     Priority: ${rec.priority}`);
        console.log(`     Description: ${rec.description}`);
        if (rec.action) {
          console.log(`     Action: ${rec.action}`);
        }
      }
    }

    // Display metrics
    console.log('\n📈 Metrics');
    console.log('='.repeat(50));
    console.log(`   Total Sessions: ${report.metrics.totalSessions}`);
    console.log(`   Success Rate: ${(report.metrics.successRate * 100).toFixed(1)}%`);
    console.log(`   Avg Duration: ${Math.round(report.metrics.averageDuration / 60)} minutes`);

    // Get specific recommendations
    console.log('\n🎯 Task-Specific Recommendations');
    console.log('='.repeat(50));

    const taskTypes = ['bugfix', 'feature', 'refactor', 'docs'];
    for (const taskType of taskTypes) {
      const rec = learning.getRecommendation(taskType);
      if (rec) {
        console.log(`\n  ${taskType.toUpperCase()}:`);
        console.log(`     Recommended Agent: ${rec.agent}`);
        console.log(`     Estimated Duration: ${rec.estimatedDuration} minutes`);
        console.log(`     Confidence: ${(rec.confidence * 100).toFixed(1)}%`);
      }
    }

    // Export insights
    console.log('\n💾 Exporting insights...');
    const exportPath = `./insights-${new Date().toISOString().split('T')[0]}.json`;
    await learning.exportInsights(exportPath);
    console.log(`   ✅ Exported to: ${exportPath}`);

    console.log('\n✅ Insights generation