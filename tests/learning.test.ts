/**
 * Learning Engine Tests
 * Tests for metrics collection, pattern analysis, and recommendations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  LearningEngine, 
  createLearningEngine,
  MetricsCollector,
  createMetricsCollector,
  PatternAnalyzer,
  RecommendationEngine,
  InsightsGenerator,
  LearningStorage,
  SessionMetrics,
  AgentMetrics,
  Pattern,
  Recommendation,
  InsightsReport,
  SessionStatus
} from '../src/learning';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Learning Engine', () => {
  let testDir: string;
  let engine: LearningEngine;

  beforeEach(() => {
    testDir = join(tmpdir(), `rhaone-learning-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    engine = createLearningEngine({ storagePath: testDir, enabled: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Basic Operations', () => {
    it('should create a learning engine with default config', () => {
      const defaultEngine = new LearningEngine();
      expect(defaultEngine).toBeDefined();
      expect(defaultEngine.getConfig().enabled).toBe(true);
    });

    it('should create a learning engine with custom config', () => {
      const customEngine = createLearningEngine({
        enabled: false,
        minSessionsForPattern: 10,
        minSessionsForRecommendation: 5,
      });
      const config = customEngine.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.minSessionsForPattern).toBe(10);
      expect(config.minSessionsForRecommendation).toBe(5);
    });

    it('should enable/disable learning', () => {
      expect(engine.getConfig().enabled).toBe(true);
      engine.setEnabled(false);
      expect(engine.getConfig().enabled).toBe(false);
      engine.setEnabled(true);
      expect(engine.getConfig().enabled).toBe(true);
    });

    it('should update config', () => {
      engine.updateConfig({ minSessionsForPattern: 15 });
      expect(engine.getConfig().minSessionsForPattern).toBe(15);
    });
  });

  describe('Session Recording', () => {
    it('should record a successful session', () => {
      const metrics: SessionMetrics = {
        sessionId: 'test-1',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 30,
        timeToPR: 45,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      engine.recordSession(metrics);
      
      const recentMetrics = engine.getRecentMetrics(1);
      expect(recentMetrics.length).toBeGreaterThan(0);
      expect(recentMetrics[0].sessionId).toBe('test-1');
      expect(recentMetrics[0].success).toBe(true);
    });

    it('should record a failed session', () => {
      const metrics: SessionMetrics = {
        sessionId: 'test-2',
        projectId: 'test-project',
        agentType: 'kimi',
        taskType: 'feature',
        spawnDuration: 20,
        ciPasses: 0,
        ciFailures: 2,
        ciRetries: 2,
        linesAdded: 100,
        linesRemoved: 50,
        filesModified: 5,
        reviewRounds: 0,
        success: false,
        failureReason: 'CI failed',
        status: 'errored',
        createdAt: new Date().toISOString(),
      };

      engine.recordSession(metrics);
      
      const recentMetrics = engine.getRecentMetrics(1);
      const failedSession = recentMetrics.find(m => m.sessionId === 'test-2');
      expect(failedSession).toBeDefined();
      expect(failedSession?.success).toBe(false);
      expect(failedSession?.failureReason).toBe('CI failed');
    });

    it('should update session progress', () => {
      const metrics: SessionMetrics = {
        sessionId: 'test-3',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'refactor',
        spawnDuration: 15,
        ciPasses: 0,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 0,
        linesRemoved: 0,
        filesModified: 0,
        reviewRounds: 0,
        success: false,
        status: 'working',
        createdAt: new Date().toISOString(),
      };

      engine.recordSession(metrics);
      engine.updateSessionProgress('test-3', { status: 'pr_open', timeToPR: 30 });
      
      const updated = engine.getRecentMetrics(1).find(m => m.sessionId === 'test-3');
      expect(updated?.status).toBe('pr_open');
      expect(updated?.timeToPR).toBe(30);
    });
  });

  describe('Pattern Analysis', () => {
    it('should classify tasks based on keywords', () => {
      expect(engine.classifyTask('Fix login bug', 'Users cannot login')).toBe('bugfix');
      expect(engine.classifyTask('Add new feature', 'Implement user profiles')).toBe('feature');
      expect(engine.classifyTask('Refactor auth module', 'Clean up code')).toBe('refactor');
      expect(engine.classifyTask('Update README', 'Documentation changes')).toBe('docs');
      expect(engine.classifyTask('Add unit tests', 'Test coverage')).toBe('test');
    });

    it('should return general for unknown tasks', () => {
      expect(engine.classifyTask('Random task', 'No keywords')).toBe('general');
    });

    it('should analyze patterns with sufficient data', () => {
      // Add multiple sessions for pattern analysis
      for (let i = 0; i < 5; i++) {
        engine.recordSession({
          sessionId: `pattern-test-${i}`,
          projectId: 'test-project',
          agentType: 'claude-code',
          taskType: 'bugfix',
          spawnDuration: 20 + i,
          timeToPR: 30 + i * 5,
          ciPasses: 1,
          ciFailures: 0,
          ciRetries: 0,
          linesAdded: 50,
          linesRemoved: 20,
          filesModified: 3,
          reviewRounds: 1,
          success: true,
          status: 'completed',
          createdAt: new Date().toISOString(),
        });
      }

      const patterns = engine.getPatterns();
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  describe('Recommendations', () => {
    it('should provide default recommendation for unknown task types', () => {
      const rec = engine.getRecommendation('unknown-task');
      expect(rec.suggestedAgent).toBeDefined();
      expect(rec.confidence).toBeLessThan(0.5);
      expect(rec.tips.length).toBeGreaterThan(0);
    });

    it('should provide recommendation based on historical data', () => {
      // Add sessions for a specific task type
      for (let i = 0; i < 5; i++) {
        engine.recordSession({
          sessionId: `rec-test-${i}`,
          projectId: 'test-project',
          agentType: 'claude-code',
          taskType: 'security',
          spawnDuration: 25,
          timeToPR: 40,
          ciPasses: 1,
          ciFailures: 0,
          ciRetries: 0,
          linesAdded: 30,
          linesRemoved: 10,
          filesModified: 2,
          reviewRounds: 1,
          success: true,
          status: 'completed',
          createdAt: new Date().toISOString(),
        });
      }

      const rec = engine.getRecommendation('security');
      expect(rec.suggestedAgent).toBe('claude-code');
      expect(rec.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('Insights Report', () => {
    it('should generate an insights report', () => {
      // Add some test data
      for (let i = 0; i < 3; i++) {
        engine.recordSession({
          sessionId: `insight-test-${i}`,
          projectId: 'test-project',
          agentType: 'claude-code',
          taskType: 'feature',
          spawnDuration: 25,
          timeToPR: 40,
          ciPasses: 1,
          ciFailures: 0,
          ciRetries: 0,
          linesAdded: 50,
          linesRemoved: 20,
          filesModified: 3,
          reviewRounds: 1,
          success: true,
          status: 'completed',
          createdAt: new Date().toISOString(),
        });
      }

      const report = engine.getInsightsReport(7);
      expect(report).toBeDefined();
      expect(report.totalSessions).toBeGreaterThan(0);
      expect(report.successRate).toBeGreaterThanOrEqual(0);
      expect(report.successRate).toBeLessThanOrEqual(1);
    });

    it('should format insights for Telegram', () => {
      // Add test data
      engine.recordSession({
        sessionId: 'telegram-test',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 30,
        timeToPR: 45,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      const telegramOutput = engine.getInsightsForTelegram(7);
      expect(telegramOutput).toContain('Rhaone Insights Report');
      expect(telegramOutput).toContain('Sessions');
    });

    it('should generate compact summary', () => {
      engine.recordSession({
        sessionId: 'compact-test',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 30,
        timeToPR: 45,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      const summary = engine.getCompactSummary();
      expect(summary.length).toBeGreaterThan(0);
    });
  });

  describe('Query Methods', () => {
    it('should get metrics by project', () => {
      engine.recordSession({
        sessionId: 'project-test-1',
        projectId: 'project-a',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 30,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      engine.recordSession({
        sessionId: 'project-test-2',
        projectId: 'project-b',
        agentType: 'kimi',
        taskType: 'feature',
        spawnDuration: 25,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 100,
        linesRemoved: 50,
        filesModified: 5,
        reviewRounds: 2,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      const projectAMetrics = engine.getProjectMetrics('project-a');
      expect(projectAMetrics.length).toBe(1);
      expect(projectAMetrics[0].projectId).toBe('project-a');
    });

    it('should get metrics by agent', () => {
      engine.recordSession({
        sessionId: 'agent-test-1',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 30,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      const claudeMetrics = engine.getMetricsByAgent('claude-code');
      expect(claudeMetrics.length).toBeGreaterThan(0);
      expect(claudeMetrics[0].agentType).toBe('claude-code');
    });
  });
});

describe('MetricsCollector', () => {
  let testDir: string;
  let collector: MetricsCollector;

  beforeEach(() => {
    testDir = join(tmpdir(), `rhaone-metrics-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const storage = new LearningStorage(testDir);
    collector = createMetricsCollector({ storage, enabled: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Session Lifecycle', () => {
    it('should start a session', () => {
      const metrics = collector.startSession({
        sessionId: 'collector-test-1',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
      });

      expect(metrics).toBeDefined();
      expect(metrics.sessionId).toBe('collector-test-1');
      expect(metrics.status).toBe('pending');
      expect(collector.getActiveSession('collector-test-1')).toBeDefined();
    });

    it('should update session metrics', () => {
      collector.startSession({
        sessionId: 'collector-test-2',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
      });

      const updated = collector.updateSession('collector-test-2', {
        status: 'working',
        spawnDuration: 30,
      });

      expect(updated?.status).toBe('working');
      expect(updated?.spawnDuration).toBe(30);
    });

    it('should complete a successful session', () => {
      collector.startSession({
        sessionId: 'collector-test-3',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
      });

      const completed = collector.completeSession('collector-test-3', true);

      expect(completed?.success).toBe(true);
      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeDefined();
      expect(collector.getActiveSession('collector-test-3')).toBeUndefined();
    });

    it('should complete a failed session', () => {
      collector.startSession({
        sessionId: 'collector-test-4',
        projectId: 'test-project',
        agentType: 'kimi',
        taskType: 'feature',
      });

      const completed = collector.completeSession('collector-test-4', false, 'Test failure');

      expect(completed?.success).toBe(false);
      expect(completed?.status).toBe('errored');
      expect(completed?.failureReason).toBe('Test failure');
    });
  });

  describe('Event Recording', () => {
    it('should record CI events', () => {
      collector.startSession({
        sessionId: 'ci-test',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
      });

      collector.recordCIEvent('ci-test', true, 0);
      collector.recordCIEvent('ci-test', false, 1);

      const metrics = collector.getSessionMetrics('ci-test');
      expect(metrics?.ciPasses).toBe(1);
      expect(metrics?.ciFailures).toBe(1);
      expect(metrics?.ciRetries).toBe(1);
    });

    it('should record code changes', () => {
      collector.startSession({
        sessionId: 'code-test',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'refactor',
      });

      collector.recordCodeChanges('code-test', 100, 50, 5);

      const metrics = collector.getSessionMetrics('code-test');
      expect(metrics?.linesAdded).toBe(100);
      expect(metrics?.linesRemoved).toBe(50);
      expect(metrics?.filesModified).toBe(5);
    });

    it('should record PR opened', () => {
      collector.startSession({
        sessionId: 'pr-test',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'feature',
      });

      collector.recordPROpened('pr-test', 45);

      const metrics = collector.getSessionMetrics('pr-test');
      expect(metrics?.status).toBe('pr_open');
      expect(metrics?.timeToPR).toBe(45);
    });

    it('should record review rounds', () => {
      collector.startSession({
        sessionId: 'review-test',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
      });

      collector.recordReview('review-test', 2);

      const metrics = collector.getSessionMetrics('review-test');
      expect(metrics?.status).toBe('reviewing');
      expect(metrics?.reviewRounds).toBe(2);
    });
  });

  describe('Configuration', () => {
    it('should respect enabled flag', () => {
      const disabledCollector = createMetricsCollector({ enabled: false });
      
      const metrics = disabledCollector.startSession({
        sessionId: 'disabled-test',
        projectId: 'test-project',
        agentType: 'claude-code',
        taskType: 'bugfix',
      });

      // Should return empty metrics when disabled
      expect(metrics.sessionId).toBe('disabled-test');
      expect(disabledCollector.isEnabled()).toBe(false);
    });

    it('should enable/disable dynamically', () => {
      expect(collector.isEnabled()).toBe(true);
      collector.setEnabled(false);
      expect(collector.isEnabled()).toBe(false);
      collector.setEnabled(true);
      expect(collector.isEnabled()).toBe(true);
    });
  });
});

describe('PatternAnalyzer', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  describe('Task Classification', () => {
    it('should classify bugfix tasks', () => {
      expect(analyzer.classifyTask('Fix critical bug', '')).toBe('bugfix');
      expect(analyzer.classifyTask('Error in login', 'Users report broken')).toBe('bugfix');
    });

    it('should classify feature tasks', () => {
      expect(analyzer.classifyTask('Add new feature', '')).toBe('feature');
      expect(analyzer.classifyTask('Implement auth', '')).toBe('feature');
    });

    it('should classify refactor tasks', () => {
      expect(analyzer.classifyTask('Refactor codebase', '')).toBe('refactor');
      expect(analyzer.classifyTask('Code cleanup', '')).toBe('refactor');
    });

    it('should classify documentation tasks', () => {
      expect(analyzer.classifyTask('Update docs', '')).toBe('docs');
      expect(analyzer.classifyTask('Update documentation', '')).toBe('docs');
    });

    it('should classify test tasks', () => {
      expect(analyzer.classifyTask('Add test coverage', '')).toBe('test');
      expect(analyzer.classifyTask('Unit test', '')).toBe('test');
    });

    it('should default to general for unknown tasks', () => {
      expect(analyzer.classifyTask('Random stuff', '')).toBe('general');
    });
  });

  describe('Pattern Analysis', () => {
    it('should analyze patterns from metrics', () => {
      const metrics: SessionMetrics[] = [
        {
          sessionId: '1',
          projectId: 'p1',
          agentType: 'claude-code',
          taskType: 'bugfix',
          spawnDuration: 20,
          ciPasses: 1,
          ciFailures: 0,
          ciRetries: 0,
          linesAdded: 50,
          linesRemoved: 20,
          filesModified: 3,
          reviewRounds: 1,
          success: true,
          status: 'completed',
          createdAt: new Date().toISOString(),
        },
        {
          sessionId: '2',
          projectId: 'p1',
          agentType: 'claude-code',
          taskType: 'bugfix',
          spawnDuration: 25,
          ciPasses: 1,
          ciFailures: 0,
          ciRetries: 0,
          linesAdded: 60,
          linesRemoved: 25,
          filesModified: 4,
          reviewRounds: 1,
          success: true,
          status: 'completed',
          createdAt: new Date().toISOString(),
        },
      ];

      const patterns = analyzer.analyzePatterns(metrics, 'bugfix', 2);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should return empty patterns for insufficient data', () => {
      const metrics: SessionMetrics[] = [];
      const patterns = analyzer.analyzePatterns(metrics, 'bugfix', 5);
      expect(patterns).toEqual([]);
    });
  });

  describe('Failure Analysis', () => {
    it('should analyze failure patterns', () => {
      const metrics: SessionMetrics[] = [
        {
          sessionId: '1',
          projectId: 'p1',
          agentType: 'claude-code',
          taskType: 'bugfix',
          spawnDuration: 20,
          ciPasses: 0,
          ciFailures: 1,
          ciRetries: 0,
          linesAdded: 0,
          linesRemoved: 0,
          filesModified: 0,
          reviewRounds: 0,
          success: false,
          failureReason: 'CI failed',
          status: 'errored',
          createdAt: new Date().toISOString(),
        },
        {
          sessionId: '2',
          projectId: 'p1',
          agentType: 'kimi',
          taskType: 'feature',
          spawnDuration: 20,
          ciPasses: 0,
          ciFailures: 1,
          ciRetries: 0,
          linesAdded: 0,
          linesRemoved: 0,
          filesModified: 0,
          reviewRounds: 0,
          success: false,
          failureReason: 'CI failed',
          status: 'errored',
          createdAt: new Date().toISOString(),
        },
      ];

      const failures = analyzer.analyzeFailures(metrics);
      expect(failures.get('CI failed')?.count).toBe(2);
    });
  });

  describe('Trend Calculation', () => {
    it('should detect improving trend', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const trend = analyzer.calculateTrend(values, 5);
      expect(trend).toBe('improving');
    });

    it('should detect declining trend', () => {
      const values = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
      const trend = analyzer.calculateTrend(values, 5);
      expect(trend).toBe('declining');
    });

    it('should detect stable trend', () => {
      const values = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
      const trend = analyzer.calculateTrend(values, 5);
      expect(trend).toBe('stable');
    });

    it('should return stable for insufficient data', () => {
      const values = [1, 2, 3];
      const trend = analyzer.calculateTrend(values, 5);
      expect(trend).toBe('stable');
    });
  });
});

describe('RecommendationEngine', () => {
  let engine: RecommendationEngine;

  beforeEach(() => {
    engine = new RecommendationEngine(3);
  });

  describe('Recommendations', () => {
    it('should provide recommendation with sufficient data', () => {
      const agentMetrics = new Map<string, AgentMetrics>();
      agentMetrics.set('claude-code:bugfix:default', {
        agentType: 'claude-code',
        taskType: 'bugfix',
        totalSessions: 10,
        successfulSessions: 8,
        successRate: 0.8,
        avgTimeToPR: 45,
        avgTimeToMerge: 60,
        avgSpawnDuration: 20,
        avgCIRetries: 0.5,
        avgPassRate: 0.9,
        avgLinesChanged: 100,
        avgFilesModified: 3,
        avgReviewRounds: 1,
        commonFailures: [],
        successfulStrategies: ['minimal'],
        lastUpdated: new Date().toISOString(),
      });

      const patterns: Pattern[] = [];
      const rec = engine.recommend('bugfix', agentMetrics, patterns);

      expect(rec.suggestedAgent).toBe('claude-code');
      expect(rec.confidence).toBeGreaterThan(0.5);
    });

    it('should provide default recommendation for new task types', () => {
      const agentMetrics = new Map<string, AgentMetrics>();
      const patterns: Pattern[] = [];
      const rec = engine.recommend('unknown', agentMetrics, patterns);

      expect(rec.suggestedAgent).toBe('claude-code');
      expect(rec.confidence).toBeLessThan(0.5);
      expect(rec.tips.length).
 toBeGreaterThan(0);
    });
  });

  describe('Agent Comparison', () => {
    it('should compare agents for a task type', () => {
      const agentMetrics = new Map<string, AgentMetrics>();
      agentMetrics.set('claude-code:bugfix:default', {
        agentType: 'claude-code',
        taskType: 'bugfix',
        totalSessions: 10,
        successfulSessions: 8,
        successRate: 0.8,
        avgTimeToPR: 45,
        avgTimeToMerge: 60,
        avgSpawnDuration: 20,
        avgCIRetries: 0.5,
        avgPassRate: 0.9,
        avgLinesChanged: 100,
        avgFilesModified: 3,
        avgReviewRounds: 1,
        commonFailures: [],
        successfulStrategies: [],
        lastUpdated: new Date().toISOString(),
      });
      agentMetrics.set('kimi:bugfix:default', {
        agentType: 'kimi',
        taskType: 'bugfix',
        totalSessions: 5,
        successfulSessions: 3,
        successRate: 0.6,
        avgTimeToPR: 60,
        avgTimeToMerge: 90,
        avgSpawnDuration: 25,
        avgCIRetries: 1,
        avgPassRate: 0.8,
        avgLinesChanged: 120,
        avgFilesModified: 4,
        avgReviewRounds: 2,
        commonFailures: [],
        successfulStrategies: [],
        lastUpdated: new Date().toISOString(),
      });

      const comparisons = engine.compareAgents('bugfix', agentMetrics);
      expect(comparisons.length).toBe(2);
      expect(comparisons[0].agent).toBe('claude-code'); // Higher success rate first
    });
  });
});

describe('InsightsGenerator', () => {
  let generator: InsightsGenerator;

  beforeEach(() => {
    generator = new InsightsGenerator();
  });

  describe('Report Generation', () => {
    it('should generate a complete report', () => {
      const metrics: SessionMetrics[] = [
        {
          sessionId: '1',
          projectId: 'p1',
          agentType: 'claude-code',
          model: 'claude-sonnet',
          taskType: 'bugfix',
          spawnDuration: 20,
          timeToPR: 45,
          ciPasses: 1,
          ciFailures: 0,
          ciRetries: 0,
          linesAdded: 50,
          linesRemoved: 20,
          filesModified: 3,
          reviewRounds: 1,
          success: true,
          status: 'completed',
          createdAt: new Date().toISOString(),
        },
      ];

      const agentMetrics = new Map<string, AgentMetrics>();
      agentMetrics.set('claude-code:bugfix:claude-sonnet', {
        agentType: 'claude-code',
        model: 'claude-sonnet',
        taskType: 'bugfix',
        totalSessions: 1,
        successfulSessions: 1,
        successRate: 1,
        avgTimeToPR: 45,
        avgTimeToMerge: 0,
        avgSpawnDuration: 20,
        avgCIRetries: 0,
        avgPassRate: 1,
        avgLinesChanged: 70,
        avgFilesModified: 3,
        avgReviewRounds: 1,
        commonFailures: [],
        successfulStrategies: [],
        lastUpdated: new Date().toISOString(),
      });

      const patterns: Pattern[] = [];
      const report = generator.generate(metrics, agentMetrics, patterns, 7);

      expect(report).toBeDefined();
      expect(report.totalSessions).toBe(1);
      expect(report.successRate).toBe(1);
      expect(report.agentPerformance.length).toBeGreaterThan(0);
    });
  });

  describe('Formatting', () => {
    it('should format for Telegram', () => {
      const report: InsightsReport = {
        generatedAt: new Date().toISOString(),
        period: { start: new Date().toISOString(), end: new Date().toISOString() },
        totalSessions: 10,
        successRate: 0.8,
        avgTimeToPR: 45,
        agentPerformance: [],
        modelPerformance: [],
        topPatterns: [],
        recommendations: [],
        trends: { successRateTrend: 'improving', avgTimeTrend: 'stable' },
      };

      const formatted = generator.formatForTelegram(report);
      expect(formatted).toContain('Rhaone Insights Report');
      expect(formatted).toContain('Sessions: 10');
      expect(formatted).toContain('80.0%');
    });

    it('should format compact summary', () => {
      const report: InsightsReport = {
        generatedAt: new Date().toISOString(),
        period: { start: new Date().toISOString(), end: new Date().toISOString() },
        totalSessions: 10,
        successRate: 0.8,
        avgTimeToPR: 45,
        agentPerformance: [],
        modelPerformance: [],
        topPatterns: [],
        recommendations: [],
        trends: { successRateTrend: 'improving', avgTimeTrend: 'stable' },
      };

      const compact = generator.formatCompact(report);
      expect(compact.length).toBeGreaterThan(0);
      expect(compact).toContain('10 sessions');
      expect(compact).toContain('80%');
    });
  });
});

describe('LearningStorage', () => {
  let testDir: string;
  let storage: LearningStorage;

  beforeEach(() => {
    testDir = join(tmpdir(), `rhaone-storage-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    storage = new LearningStorage(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Metrics Storage', () => {
    it('should save and load metrics', () => {
      const metrics: SessionMetrics = {
        sessionId: 'storage-test',
        projectId: 'p1',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 20,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };

      storage.addMetric(metrics);
      const loaded = storage.loadMetrics();

      expect(loaded.length).toBe(1);
      expect(loaded[0].sessionId).toBe('storage-test');
    });

    it('should update existing metrics', () => {
      const metrics: SessionMetrics = {
        sessionId: 'update-test',
        projectId: 'p1',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 20,
        ciPasses: 0,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 0,
        linesRemoved: 0,
        filesModified: 0,
        reviewRounds: 0,
        success: false,
        status: 'working',
        createdAt: new Date().toISOString(),
      };

      storage.addMetric(metrics);
      
      const updated: SessionMetrics = { ...metrics, status: 'completed', success: true };
      storage.addMetric(updated);

      const loaded = storage.loadMetrics();
      expect(loaded.length).toBe(1);
      expect(loaded[0].status).toBe('completed');
    });

    it('should filter metrics by agent', () => {
      storage.addMetric({
        sessionId: '1',
        projectId: 'p1',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 20,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      storage.addMetric({
        sessionId: '2',
        projectId: 'p1',
        agentType: 'kimi',
        taskType: 'feature',
        spawnDuration: 25,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 100,
        linesRemoved: 50,
        filesModified: 5,
        reviewRounds: 2,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      const claudeMetrics = storage.getMetricsByAgent('claude-code');
      expect(claudeMetrics.length).toBe(1);
      expect(claudeMetrics[0].agentType).toBe('claude-code');
    });

    it('should filter metrics by project', () => {
      storage.addMetric({
        sessionId: '1',
        projectId: 'project-a',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 20,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      storage.addMetric({
        sessionId: '2',
        projectId: 'project-b',
        agentType: 'kimi',
        taskType: 'feature',
        spawnDuration: 25,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 100,
        linesRemoved: 50,
        filesModified: 5,
        reviewRounds: 2,
        success: true,
        status: 'completed',
        createdAt: new Date().toISOString(),
      });

      const projectMetrics = storage.getMetricsByProject('project-a');
      expect(projectMetrics.length).toBe(1);
      expect(projectMetrics[0].projectId).toBe('project-a');
    });

    it('should get recent metrics', () => {
      const today = new Date().toISOString();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      storage.addMetric({
        sessionId: '1',
        projectId: 'p1',
        agentType: 'claude-code',
        taskType: 'bugfix',
        spawnDuration: 20,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 50,
        linesRemoved: 20,
        filesModified: 3,
        reviewRounds: 1,
        success: true,
        status: 'completed',
        createdAt: today,
      });

      storage.addMetric({
        sessionId: '2',
        projectId: 'p1',
        agentType: 'kimi',
        taskType: 'feature',
        spawnDuration: 25,
        ciPasses: 1,
        ciFailures: 0,
        ciRetries: 0,
        linesAdded: 100,
        linesRemoved: 50,
        filesModified: 5,
        reviewRounds: 2,
        success: true,
        status: 'completed',
        createdAt: oldDate.toISOString(),
      });

      const recent = storage.getRecentMetrics(7);
      expect(recent.length).toBe(1);
      expect(recent[0].sessionId).toBe('1');
    });
  });

  describe('Config Storage', () => {
    it('should save and load config', () => {
      const config = {
        enabled: true,
        minSessionsForPattern: 10,
        minSessionsForRecommendation: 5,
        storagePath: testDir,
      };

      storage.saveConfig(config);
      const loaded = storage.loadConfig();

      expect(loaded.enabled).toBe(true);
      expect(loaded.minSessionsForPattern).toBe(10);
    });

    it('should return default config if file does not exist', () => {
      const loaded = storage.loadConfig();
      expect(loaded.enabled).toBe(true);
      expect(loaded.minSessionsForPattern).toBe(5);
    });
  });

  describe('Agent Metrics Aggregation', () => {
    it('should aggregate agent metrics', () => {
      // Add multiple sessions for same agent/task
      for (let i = 0; i < 5; i++) {
        storage.addMetric({
          sessionId: `agg-test-${i}`,
          projectId: 'p1',
          agentType: 'claude-code',
          taskType: 'bugfix',
          spawnDuration: 20 + i,
          timeToPR: 40 + i * 5,
          ciPasses: 1,
          ciFailures: i > 3 ? 1 : 0,
          ciRetries: i > 3 ? 1 : 0,
          linesAdded: 50 + i * 10,
          linesRemoved: 20 + i * 5,
          filesModified: 3,
          reviewRounds: 1,
          success: i <= 3,
          status: i <= 3 ? 'completed' : 'errored',
          createdAt: new Date().toISOString(),
        });
      }

      const agentMetrics = storage.loadAgentMetrics();
      expect(agentMetrics.size).toBeGreaterThan(0);

      const key = 'claude-code:bugfix:default';
      const metrics = agentMetrics.get(key);
      expect(metrics).toBeDefined();
      expect(metrics?.totalSessions).toBe(5);
      expect(metrics?.successfulSessions).toBe(4);
      expect(metrics?.successRate).toBe(0.8);
    });
  });
});
