/**
 * Recommendation Engine
 * Suggests the best agent for a given task type
 */

import { SessionMetrics, AgentMetrics, Recommendation, Pattern } from './types';

export class RecommendationEngine {
  private minSamples: number;
  
  constructor(minSamples: number = 3) {
    this.minSamples = minSamples;
  }
  
  /**
   * Get recommendation for a specific task type
   */
  recommend(
    taskType: string,
    agentMetrics: Map<string, AgentMetrics>,
    patterns: Pattern[]
  ): Recommendation {
    // Find metrics for this task type
    const taskMetrics: AgentMetrics[] = [];
    
    for (const [, metrics] of agentMetrics) {
      if (metrics.taskType === taskType && metrics.totalSessions >= this.minSamples) {
        taskMetrics.push(metrics);
      }
    }
    
    if (taskMetrics.length === 0) {
      // No history - return default recommendation
      return this.getDefaultRecommendation(taskType, patterns);
    }
    
    // Find best agent by success rate
    taskMetrics.sort((a, b) => b.successRate - a.successRate);
    const best = taskMetrics[0];
    
    // Calculate confidence based on sample size
    const confidence = Math.min(0.5 + (best.totalSessions * 0.05), 0.95);
    
    // Get tips from patterns
    const relevantPatterns = patterns.filter(p => p.taskType === taskType && p.agentType === best.agentType);
    const tips = relevantPatterns.flatMap(p => p.tips).slice(0, 5);
    
    // Estimate time based on historical data
    const estimatedTime = Math.round(best.avgTimeToPR || best.avgSpawnDuration * 2);
    
    return {
      suggestedAgent: best.agentType,
      suggestedModel: best.model,
      confidence,
      estimatedTime,
      tips: tips.length > 0 ? tips : this.getDefaultTips(taskType),
      basedOnPatterns: relevantPatterns.map(p => p.strategy),
    };
  }
  
  /**
   * Get recommendation for multiple task types (batch)
   */
  recommendBatch(
    taskTypes: string[],
    agentMetrics: Map<string, AgentMetrics>,
    patterns: Pattern[]
  ): Map<string, Recommendation> {
    const recommendations = new Map<string, Recommendation>();
    
    for (const taskType of taskTypes) {
      recommendations.set(taskType, this.recommend(taskType, agentMetrics, patterns));
    }
    
    return recommendations;
  }
  
  /**
   * Get default recommendation when no history exists
   */
  private getDefaultRecommendation(taskType: string, patterns: Pattern[]): Recommendation {
    const knownPatterns = patterns.filter(p => p.taskType === taskType);
    
    if (knownPatterns.length > 0) {
      // Use existing pattern data
      const bestPattern = knownPatterns.sort((a, b) => b.successRate - a.successRate)[0];
      return {
        suggestedAgent: bestPattern.agentType,
        confidence: 0.4, // Lower confidence without direct history
        estimatedTime: Math.round(bestPattern.avgTime),
        tips: bestPattern.tips.slice(0, 3),
        basedOnPatterns: [bestPattern.strategy],
      };
    }
    
    // Completely new task type
    return {
      suggestedAgent: 'claude-code',
      confidence: 0.3,
      estimatedTime: 60, // Default 1 hour estimate
      tips: this.getDefaultTips(taskType),
      basedOnPatterns: [],
    };
  }
  
  /**
   * Get default tips based on task type
   */
  private getDefaultTips(taskType: string): string[] {
    const tipsByType: Record<string, string[]> = {
      bugfix: [
        'Start by reproducing the bug locally',
        'Write a test case that fails before fixing',
        'Check for similar issues in the codebase',
      ],
      feature: [
        'Clarify the full scope of the feature',
        'Check for existing similar features for reference',
        'Plan for tests and documentation',
      ],
      refactor: [
        'Ensure full test coverage before starting',
        'Make incremental changes',
        'Run tests after each significant change',
      ],
      security: [
        'Check for similar vulnerabilities in the codebase',
        'Consider edge cases and attack vectors',
        'Add security tests if possible',
      ],
      performance: [
        'Profile first to identify actual bottlenecks',
        'Benchmark before and after changes',
        'Consider impact on different data sizes',
      ],
      docs: [
        'Check existing documentation style',
        'Include code examples where helpful',
        'Keep it consistent with the codebase',
      ],
      test: [
        'Cover edge cases and error conditions',
        'Use descriptive test names',
        'Keep tests independent and isolated',
      ],
    };
    
    return tipsByType[taskType] || [
      'Break down the task into smaller steps',
      'Test changes thoroughly before submitting',
      'Document any assumptions made',
    ];
  }
  
  /**
   * Compare agents for a task type and return analysis
   */
  compareAgents(
    taskType: string,
    agentMetrics: Map<string, AgentMetrics>
  ): { agent: string; successRate: number; avgTime: number; recommendation: string }[] {
    const comparisons: { agent: string; successRate: number; avgTime: number; recommendation: string }[] = [];
    
    for (const [key, metrics] of agentMetrics) {
      if (metrics.taskType !== taskType) continue;
      
      comparisons.push({
        agent: metrics.agentType,
        successRate: Math.round(metrics.successRate * 100) / 100,
        avgTime: Math.round(metrics.avgTimeToPR || 0),
        recommendation: this.getAgentRecommendation(metrics),
      });
    }
    
    return comparisons.sort((a, b) => b.successRate - a.successRate);
  }
  
  /**
   * Get recommendation text for an agent based on its metrics
   */
  private getAgentRecommendation(metrics: AgentMetrics): string {
    if (metrics.successRate >= 0.8) {
      return 'Highly recommended';
    } else if (metrics.successRate >= 0.6) {
      return 'Good option';
    } else if (metrics.successRate >= 0.4) {
      return 'Use with caution';
    } else {
      return 'Not recommended for this task type';
    }
  }
  
  /**
   * Find best model for a specific agent and task type
   */
  findBestModel(
    agentType: string,
    taskType: string,
    metrics: Map<string, AgentMetrics>
  ): { model: string; successRate: number } | null {
    const candidates: { model: string; successRate: number }[] = [];
    
    for (const [key, m] of metrics) {
      if (m.agentType === agentType && m.taskType === taskType && m.model) {
        candidates.push({
          model: m.model,
          successRate: m.successRate,
        });
      }
    }
    
    if (candidates.length === 0) return null;
    
    candidates.sort((a, b) => b.successRate - a.successRate);
    return candidates[0];
  }
}