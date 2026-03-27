/**
 * Rhaone Learning Engine
 * Phase 3: Performance tracking, pattern analysis, and recommendations
 */

import { SessionMetrics, AgentMetrics, Pattern, Recommendation, InsightsReport, LearningConfig } from './types';
import { LearningStorage } from './storage';
import { PatternAnalyzer } from './patterns';
import { RecommendationEngine } from './recommendations';
import { InsightsGenerator } from './insights';

export class LearningEngine {
  private storage: LearningStorage;
  private patternAnalyzer: PatternAnalyzer;
  private recommendationEngine: RecommendationEngine;
  private insightsGenerator: InsightsGenerator;
  private config: LearningConfig;
  
  constructor(config?: Partial<LearningConfig>) {
    this.storage = new LearningStorage();
    this.patternAnalyzer = new PatternAnalyzer();
    this.recommendationEngine = new RecommendationEngine();
    this.insightsGenerator = new InsightsGenerator();
    this.config = {
      enabled: true,
      minSessionsForPattern: 5,
      minSessionsForRecommendation: 3,
      storagePath: '/root/.openclaw/workspace/rhaone-orchestrator/memory',
      ...config,
    };
  }
  
  // ============ Metrics Recording ============
  
  /**
   * Record session completion - call when a session finishes
   */
  recordSession(metrics: SessionMetrics): void {
    if (!this.config.enabled) return;
    
    this.storage.addMetric(metrics);
    console.log(`[Learning] Recorded session ${metrics.sessionId}: ${metrics.success ? 'SUCCESS' : 'FAILED'}`);
  }
  
  /**
   * Update session metrics mid-flight (for progress tracking)
   */
  updateSessionProgress(sessionId: string, updates: Partial<SessionMetrics>): void {
    if (!this.config.enabled) return;
    
    const metrics = this.storage.loadMetrics();
    const index = metrics.findIndex(m => m.sessionId === sessionId);
    
    if (index >= 0) {
      metrics[index] = { ...metrics[index], ...updates };
      this.storage.saveMetrics(metrics);
    }
  }
  
  // ============ Analysis ============
  
  /**
   * Get agent performance metrics
   */
  getAgentMetrics(): Map<string, AgentMetrics> {
    return this.storage.loadAgentMetrics();
  }
  
  /**
   * Get all patterns
   */
  getPatterns(): Pattern[] {
    const metrics = this.storage.loadMetrics();
    return this.patternAnalyzer.analyzeAllPatterns(metrics, this.config.minSessionsForPattern);
  }
  
  /**
   * Get recommendation for a specific task type
   */
  getRecommendation(taskType: string): Recommendation {
    const agentMetrics = this.getAgentMetrics();
    const patterns = this.getPatterns();
    return this.recommendationEngine.recommend(taskType, agentMetrics, patterns);
  }
  
  /**
   * Classify a task based on issue content
   */
  classifyTask(issueTitle: string, issueBody?: string): string {
    return this.patternAnalyzer.classifyTask(issueTitle, issueBody);
  }
  
  // ============ Reports ============
  
  /**
   * Generate insights report
   */
  getInsightsReport(days: number = 7): InsightsReport {
    const metrics = this.storage.loadMetrics();
    const agentMetrics = this.getAgentMetrics();
    const patterns = this.getPatterns();
    
    return this.insightsGenerator.generate(metrics, agentMetrics, patterns, days);
  }
  
  /**
   * Get insights formatted for Telegram
   */
  getInsightsForTelegram(days: number = 7): string {
    const report = this.getInsightsReport(days);
    return this.insightsGenerator.formatForTelegram(report);
  }
  
  /**
   * Get compact insights summary
   */
  getCompactSummary(): string {
    const report = this.getInsightsReport(7);
    return this.insightsGenerator.formatCompact(report);
  }
  
  // ============ Queries ============
  
  /**
   * Get metrics for a specific project
   */
  getProjectMetrics(projectId: string): SessionMetrics[] {
    return this.storage.getMetricsByProject(projectId);
  }
  
  /**
   * Get recent metrics
   */
  getRecentMetrics(days: number = 7): SessionMetrics[] {
    return this.storage.getRecentMetrics(days);
  }
  
  /**
   * Get metrics by agent type
   */
  getMetricsByAgent(agentType: string): SessionMetrics[] {
    return this.storage.getMetricsByAgent(agentType);
  }
  
  // ============ Configuration ============
  
  /**
   * Get current config
   */
  getConfig(): LearningConfig {
    return { ...this.config };
  }
  
  /**
   * Update config
   */
  updateConfig(updates: Partial<LearningConfig>): void {
    this.config = { ...this.config, ...updates };
    this.storage.saveConfig(this.config);
  }
  
  /**
   * Enable/disable learning
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.storage.saveConfig(this.config);
  }
  
  // ============ Maintenance ============
  
  /**
   * Clean up old metrics
   */
  cleanupOldMetrics(keepDays: number = 90): void {
    this.storage.clearOldMetrics(keepDays);
  }
  
  /**
   * Force refresh patterns (recalculate)
   */
  refreshPatterns(): void {
    const metrics = this.storage.loadMetrics();
    const patterns = this.patternAnalyzer.analyzeAllPatterns(metrics, this.config.minSessionsForPattern);
    this.storage.savePatterns(patterns);
  }
}

// Export singleton instance
export const learningEngine = new LearningEngine();

// Factory function
export function createLearningEngine(config?: Partial<LearningConfig>): LearningEngine {
  return new LearningEngine(config);
}

// Re-export types
export { 
  SessionMetrics, 
  AgentMetrics, 
  Pattern, 
  Recommendation, 
  InsightsReport, 
  LearningConfig,
  PatternType,
  InsightType,
  RecommendationPriority,
  Insight,
  TaskType,
  ModelPerformance,
  SessionStatus,
  DEFAULT_TASK_TYPES
} from './types';
export { LearningStorage } from './storage';
export { PatternAnalyzer } from './patterns';
export { RecommendationEngine } from './recommendations';
export { InsightsGenerator } from './insights';
export { 
  MetricsCollector, 
  metricsCollector, 
  createMetricsCollector,
  MetricsCollectorConfig,
  SessionStartData,
  SessionUpdateData
} from './metrics-collector';