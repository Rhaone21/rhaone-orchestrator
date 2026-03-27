/**
 * Insights Report Generator
 * Creates dashboard reports for Telegram
 */

import { SessionMetrics, InsightsReport, AgentMetrics, ModelPerformance, Pattern, Recommendation } from './types';
import { PatternAnalyzer } from './patterns';

export class InsightsGenerator {
  private patternAnalyzer: PatternAnalyzer;
  
  constructor() {
    this.patternAnalyzer = new PatternAnalyzer();
  }
  
  /**
   * Generate a complete insights report
   */
  generate(
    metrics: SessionMetrics[],
    agentMetrics: Map<string, AgentMetrics>,
    patterns: Pattern[],
    days: number = 7
  ): InsightsReport {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    
    // Filter to time period
    const periodMetrics = metrics.filter(m => new Date(m.createdAt) >= startDate);
    
    // Calculate overview stats
    const totalSessions = periodMetrics.length;
    const successfulSessions = periodMetrics.filter(m => m.success).length;
    const successRate = totalSessions > 0 ? successfulSessions / totalSessions : 0;
    const avgTimeToPR = this.calculateAvgTime(periodMetrics, 'timeToPR');
    
    // Get agent performance
    const agentPerformance = this.getAgentPerformance(agentMetrics, totalSessions > 0 ? totalSessions : 1);
    
    // Get model performance
    const modelPerformance = this.getModelPerformance(periodMetrics);
    
    // Get top patterns
    const topPatterns = patterns.slice(0, 5);
    
    // Get recommendations
    const recommendations = this.generateRecommendations(agentMetrics, patterns);
    
    // Calculate trends
    const trends = this.calculateTrends(metrics);
    
    return {
      generatedAt: now.toISOString(),
      period: {
        start: startDate.toISOString(),
        end: now.toISOString(),
      },
      totalSessions,
      successRate: Math.round(successRate * 100) / 100,
      avgTimeToPR: Math.round(avgTimeToPR),
      agentPerformance,
      modelPerformance,
      topPatterns,
      recommendations,
      trends,
    };
  }
  
  /**
   * Format report as Telegram message
   */
  formatForTelegram(report: InsightsReport): string {
    const lines: string[] = [];
    
    // Header
    lines.push('📊 *Rhaone Insights Report*');
    lines.push('');
    
    // Overview
    lines.push('*Overview*');
    lines.push(`• Sessions: ${report.totalSessions}`);
    lines.push(`• Success Rate: ${(report.successRate * 100).toFixed(1)}%`);
    lines.push(`• Avg Time to PR: ${report.avgTimeToPR}m`);
    lines.push('');
    
    // Trends
    lines.push('*Trends*');
    lines.push(`• Success Rate: ${this.formatTrend(report.trends.successRateTrend)}`);
    lines.push(`• Avg Time: ${this.formatTrend(report.trends.avgTimeTrend)}`);
    lines.push('');
    
    // Top patterns
    if (report.topPatterns.length > 0) {
      lines.push('*Top Performing Patterns*');
      for (const pattern of report.topPatterns.slice(0, 3)) {
        lines.push(`• ${pattern.agentType} + ${pattern.taskType}: ${(pattern.successRate * 100).toFixed(0)}% success`);
      }
      lines.push('');
    }
    
    // Agent performance
    if (report.agentPerformance.length > 0) {
      lines.push('*Agent Performance*');
      for (const agent of report.agentPerformance.slice(0, 4)) {
        lines.push(`• ${agent.agentType}: ${(agent.successRate * 100).toFixed(0)}% (${agent.totalSessions} sessions)`);
      }
      lines.push('');
    }
    
    // Model performance
    if (report.modelPerformance.length > 0) {
      lines.push('*Model Performance*');
      for (const model of report.modelPerformance.slice(0, 3)) {
        lines.push(`• ${model.model}: ${(model.successRate * 100).toFixed(0)}% avg`);
      }
      lines.push('');
    }
    
    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('*Recommendations*');
      for (const rec of report.recommendations.slice(0, 2)) {
        lines.push(`• Use ${rec.suggestedAgent} for ${rec.tips[0] || 'general tasks'}`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Format compact summary for quick view
   */
  formatCompact(report: InsightsReport): string {
    const emoji = report.successRate >= 0.7 ? '✅' : report.successRate >= 0.4 ? '⚠️' : '❌';
    return `${emoji} Last ${report.period.end ? this.getDaysAgo(report.period.end) : '7'}d: ${report.totalSessions} sessions, ${(report.successRate * 100).toFixed(0)}% success, ${report.avgTimeToPR}m avg`;
  }
  
  /**
   * Get detailed session breakdown
   */
  getDetailedBreakdown(metrics: SessionMetrics[]): string {
    const lines: string[] = [];
    
    // Status breakdown
    const statusCounts = new Map<string, number>();
    for (const m of metrics) {
      statusCounts.set(m.status, (statusCounts.get(m.status) || 0) + 1);
    }
    
    lines.push('*Status Breakdown*');
    for (const [status, count] of statusCounts) {
      lines.push(`• ${status}: ${count}`);
    }
    lines.push('');
    
    // Failure reasons
    const failures = metrics.filter(m => !m.success && m.failureReason);
    if (failures.length > 0) {
      lines.push('*Common Failures*');
      const reasonCounts = new Map<string, number>();
      for (const f of failures) {
        const reason = f.failureReason || 'unknown';
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }
      for (const [reason, count] of Array.from(reasonCounts.entries()).slice(0, 5)) {
        lines.push(`• ${reason}: ${count}`);
      }
    }
    
    return lines.join('\n');
  }
  
  // Helper methods
  private calculateAvgTime(metrics: SessionMetrics[], field: 'timeToPR' | 'timeToMerge'): number {
    const valid = metrics.filter(m => m[field] !== undefined && m[field] > 0);
    if (valid.length === 0) return 0;
    const total = valid.reduce((sum, m) => sum + (m[field] || 0), 0);
    return total / valid.length;
  }
  
  private getAgentPerformance(agentMetrics: Map<string, AgentMetrics>, scale: number): AgentMetrics[] {
    const agents: AgentMetrics[] = [];
    for (const [, m] of agentMetrics) {
      // Weight by sample size relative to scale
      const weight = Math.min(m.totalSessions / scale, 1);
      agents.push({
        ...m,
        successRate: Math.round(m.successRate * 100) / 100,
        avgTimeToPR: Math.round(m.avgTimeToPR),
        avgTimeToMerge: Math.round(m.avgTimeToMerge),
        avgCIRetries: Math.round(m.avgCIRetries * 100) / 100,
      });
    }
    return agents.sort((a, b) => b.successRate - a.successRate).slice(0, 5);
  }
  
  private getModelPerformance(metrics: SessionMetrics[]): ModelPerformance[] {
    const modelMap = new Map<string, ModelPerformance>();
    
    for (const m of metrics) {
      const model = m.model || 'default';
      if (!modelMap.has(model)) {
        modelMap.set(model, {
          model,
          totalSessions: 0,
          successRate: 0,
          avgTimeToPR: 0,
          avgCIRetries: 0,
        });
      }
      
      const p = modelMap.get(model)!;
      p.totalSessions++;
      if (m.success) {
        p.avgTimeToPR += m.timeToPR || 0;
      }
      p.avgCIRetries += m.ciRetries;
    }
    
    const result: ModelPerformance[] = [];
    for (const [, p] of modelMap) {
      if (p.totalSessions > 0) {
        const successful = metrics.filter(m => (m.model || 'default') === p.model && m.success).length;
        result.push({
          ...p,
          successRate: Math.round((successful / p.totalSessions) * 100) / 100,
          avgTimeToPR: p.totalSessions > 0 ? Math.round(p.avgTimeToPR / p.totalSessions) : 0,
          avgCIRetries: Math.round((p.avgCIRetries / p.totalSessions) * 100) / 100,
        });
      }
    }
    
    return result.sort((a, b) => b.successRate - a.successRate);
  }
  
  private generateRecommendations(
    agentMetrics: Map<string, AgentMetrics>,
    patterns: Pattern[]
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const taskTypes = new Set(Array.from(agentMetrics.values()).map(m => m.taskType));
    
    for (const taskType of taskTypes) {
      const taskMetrics = Array.from(agentMetrics.values())
        .filter(m => m.taskType === taskType)
        .sort((a, b) => b.successRate - a.successRate);
      
      if (taskMetrics.length > 0 && taskMetrics[0].totalSessions >= 3) {
        const best = taskMetrics[0];
        recommendations.push({
          suggestedAgent: best.agentType,
          suggestedModel: best.model,
          confidence: Math.min(0.5 + best.totalSessions * 0.1, 0.9),
          estimatedTime: Math.round(best.avgTimeToPR),
          tips: patterns.filter(p => p.taskType === taskType && p.agentType === best.agentType).slice(0, 3).flatMap(p => p.tips),
          basedOnPatterns: [taskType],
        });
      }
    }
    
    return recommendations.slice(0, 5);
  }
  
  private calculateTrends(metrics: SessionMetrics[]): { successRateTrend: 'improving' | 'declining' | 'stable'; avgTimeTrend: 'improving' | 'declining' | 'stable' } {
    // Split into two periods
    const sorted = [...metrics].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    if (sorted.length < 10) {
      return { successRateTrend: 'stable', avgTimeTrend: 'stable' };
    }
    
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);
    
    const firstSuccess = firstHalf.filter(m => m.success).length / firstHalf.length;
    const secondSuccess = secondHalf.filter(m => m.success).length / secondHalf.length;
    
    const firstTime = firstHalf.filter(m => m.timeToPR).reduce((sum, m) => sum + (m.timeToPR || 0), 0) / firstHalf.filter(m => m.timeToPR).length;
    const secondTime = secondHalf.filter(m => m.timeToPR).reduce((sum, m) => sum + (m.timeToPR || 0), 0) / secondHalf.filter(m => m.timeToPR).length;
    
    const successDiff = secondSuccess - firstSuccess;
    const timeDiff = firstTime - secondTime; // Positive = improving (faster)
    
    return {
      successRateTrend: successDiff > 0.1 ? 'improving' : successDiff < -0.1 ? 'declining' : 'stable',
      avgTimeTrend: timeDiff > 5 ? 'improving' : timeDiff < -5 ? 'declining' : 'stable',
    };
  }
  
  private formatTrend(trend: 'improving' | 'declining' | 'stable'): string {
    switch (trend) {
      case 'improving': return '📈 Improving';
      case 'declining': return '📉 Declining';
      case 'stable': return '➡️ Stable';
    }
  }
  
  private getDaysAgo(isoDate: string): number {
    const diff = Date.now() - new Date(isoDate).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }
}