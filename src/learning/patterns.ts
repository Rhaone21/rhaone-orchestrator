/**
 * Pattern Recognition Engine
 * Identifies successful strategies and failure patterns
 */

import { SessionMetrics, AgentMetrics, Pattern, DEFAULT_TASK_TYPES, TaskType } from './types';

export class PatternAnalyzer {
  private taskTypes: TaskType[];
  
  constructor(taskTypes: TaskType[] = DEFAULT_TASK_TYPES) {
    this.taskTypes = taskTypes;
  }
  
  /**
   * Classify a task/issue into a task type based on keywords
   */
  classifyTask(issueTitle: string, issueBody?: string): string {
    const text = `${issueTitle} ${issueBody || ''}`.toLowerCase();
    
    let bestMatch = 'general';
    let maxScore = 0;
    
    for (const taskType of this.taskTypes) {
      let score = 0;
      for (const keyword of taskType.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score++;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        bestMatch = taskType.name;
      }
    }
    
    return bestMatch;
  }
  
  /**
   * Analyze patterns for a specific task type
   */
  analyzePatterns(metrics: SessionMetrics[], taskType: string, minSamples: number = 3): Pattern[] {
    const taskMetrics = metrics.filter(m => m.taskType === taskType);
    
    if (taskMetrics.length < minSamples) {
      return [];
    }
    
    const patterns: Pattern[] = [];
    
    // Group by agent type
    const byAgent = new Map<string, SessionMetrics[]>();
    for (const m of taskMetrics) {
      const list = byAgent.get(m.agentType) || [];
      list.push(m);
      byAgent.set(m.agentType, list);
    }
    
    // For each agent, analyze their success patterns
    for (const [agentType, sessions] of byAgent) {
      if (sessions.length < 2) continue;
      
      const successful = sessions.filter(s => s.success);
      const successRate = sessions.length > 0 ? successful.length / sessions.length : 0;
      
      if (successRate >= 0.5) {
        // Identify successful strategies
        const avgTime = sessions.reduce((sum, s) => sum + (s.timeToPR || s.spawnDuration), 0) / sessions.length;
        const avgRetries = sessions.reduce((sum, s) => sum + s.ciRetries, 0) / sessions.length;
        
        const tips = this.generateTips(successful, agentType);
        
        patterns.push({
          id: `${taskType}-${agentType}-${Date.now()}`,
          taskType,
          agentType,
          strategy: this.inferStrategy(successful),
          successRate,
          sampleSize: sessions.length,
          avgTime,
          tips,
        });
      }
    }
    
    // Sort by success rate
    return patterns.sort((a, b) => b.successRate - a.successRate);
  }
  
  /**
   * Generate tips based on successful sessions
   */
  private generateTips(sessions: SessionMetrics[], agentType: string): string[] {
    const tips: string[] = [];
    
    // Check if they commonly retry CI
    const avgRetries = sessions.reduce((sum, s) => sum + s.ciRetries, 0) / sessions.length;
    if (avgRetries > 0.5) {
      tips.push('Expect CI retries - run tests locally first');
    }
    
    // Check average file changes
    const avgFiles = sessions.reduce((sum, s) => sum + s.filesModified, 0) / sessions.length;
    if (avgFiles > 5) {
      tips.push('This task type typically touches multiple files - consider smaller PRs');
    }
    
    // Check review rounds
    const avgReviews = sessions.reduce((sum, s) => sum + s.reviewRounds, 0) / sessions.length;
    if (avgReviews > 1) {
      tips.push('Expect multiple review rounds - add thorough tests upfront');
    }
    
    // Agent-specific tips
    if (agentType === 'claude-code' || agentType === 'kimi') {
      tips.push('Provide clear step-by-step instructions');
      tips.push('Include relevant code context in prompts');
    }
    
    return tips;
  }
  
  /**
   * Infer the strategy used based on session characteristics
   */
  private inferStrategy(sessions: SessionMetrics[]): string {
    if (sessions.length === 0) return 'unknown';
    
    const avgFiles = sessions.reduce((sum, s) => sum + s.filesModified, 0) / sessions.length;
    const avgLines = sessions.reduce((sum, s) => sum + s.linesAdded + s.linesRemoved, 0) / sessions.length;
    
    if (avgFiles > 10 && avgLines > 500) {
      return 'comprehensive';
    } else if (avgFiles <= 2 && avgLines <= 100) {
      return 'minimal';
    } else if (avgLines > avgFiles * 50) {
      return 'deep-change';
    } else {
      return 'incremental';
    }
  }
  
  /**
   * Analyze failure patterns
   */
  analyzeFailures(metrics: SessionMetrics[]): Map<string, { count: number; examples: string[] }> {
    const failures = new Map<string, { count: number; examples: string[] }>();
    
    for (const m of metrics) {
      if (!m.success && m.failureReason) {
        const existing = failures.get(m.failureReason) || { count: 0, examples: [] };
        existing.count++;
        if (existing.examples.length < 3) {
          existing.examples.push(m.sessionId);
        }
        failures.set(m.failureReason, existing);
      }
    }
    
    return failures;
  }
  
  /**
   * Calculate trend based on historical data
   */
  calculateTrend(values: number[], windowSize: number = 5): 'improving' | 'declining' | 'stable' {
    if (values.length < windowSize * 2) {
      return 'stable';
    }
    
    const recent = values.slice(-windowSize);
    const previous = values.slice(-windowSize * 2, -windowSize);
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;
    
    const diff = recentAvg - previousAvg;
    const threshold = previousAvg * 0.1; // 10% change
    
    if (diff > threshold) return 'improving';
    if (diff < -threshold) return 'declining';
    return 'stable';
  }
  
  /**
   * Get all patterns across all task types
   */
  analyzeAllPatterns(metrics: SessionMetrics[], minSamples: number = 3): Pattern[] {
    const allPatterns: Pattern[] = [];
    
    // Get unique task types
    const taskTypes = new Set(metrics.map(m => m.taskType));
    
    for (const taskType of taskTypes) {
      const patterns = this.analyzePatterns(metrics, taskType, minSamples);
      allPatterns.push(...patterns);
    }
    
    return allPatterns.sort((a, b) => b.successRate - a.successRate);
  }
}