/**
 * Learning Data Storage
 * Persists metrics and patterns to JSON files
 */

import * as fs from 'fs';
import * as path from 'path';
import { SessionMetrics, AgentMetrics, Pattern, LearningConfig } from './types';

export class LearningStorage {
  private basePath: string;
  private metricsFile: string;
  private patternsFile: string;
  private configFile: string;
  
  constructor(basePath: string = '/root/.openclaw/workspace/rhaone-orchestrator/memory') {
    this.basePath = basePath;
    this.metricsFile = path.join(basePath, 'metrics.json');
    this.patternsFile = path.join(basePath, 'patterns.json');
    this.configFile = path.join(basePath, 'config.json');
    
    this.ensureDirectory();
  }
  
  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }
  
  // Metrics operations
  loadMetrics(): SessionMetrics[] {
    try {
      if (fs.existsSync(this.metricsFile)) {
        const data = fs.readFileSync(this.metricsFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading metrics:', error);
    }
    return [];
  }
  
  saveMetrics(metrics: SessionMetrics[]): void {
    try {
      fs.writeFileSync(this.metricsFile, JSON.stringify(metrics, null, 2));
    } catch (error) {
      console.error('Error saving metrics:', error);
    }
  }
  
  addMetric(metric: SessionMetrics): void {
    const metrics = this.loadMetrics();
    // Check if already exists (update) or new
    const existingIndex = metrics.findIndex(m => m.sessionId === metric.sessionId);
    if (existingIndex >= 0) {
      metrics[existingIndex] = metric;
    } else {
      metrics.push(metric);
    }
    this.saveMetrics(metrics);
  }
  
  // Agent metrics operations
  loadAgentMetrics(): Map<string, AgentMetrics> {
    try {
      const metrics = this.loadMetrics();
      return this.aggregateAgentMetrics(metrics);
    } catch (error) {
      console.error('Error loading agent metrics:', error);
      return new Map();
    }
  }
  
  private aggregateAgentMetrics(sessions: SessionMetrics[]): Map<string, AgentMetrics> {
    const agentMap = new Map<string, AgentMetrics>();
    
    // Group by agent + task type
    for (const session of sessions) {
      const key = `${session.agentType}:${session.taskType}:${session.model || 'default'}`;
      
      if (!agentMap.has(key)) {
        agentMap.set(key, {
          agentType: session.agentType,
          model: session.model,
          taskType: session.taskType,
          totalSessions: 0,
          successfulSessions: 0,
          successRate: 0,
          avgTimeToPR: 0,
          avgTimeToMerge: 0,
          avgSpawnDuration: 0,
          avgCIRetries: 0,
          avgPassRate: 0,
          ciFailures: 0,
          avgLinesChanged: 0,
          avgFilesModified: 0,
          avgReviewRounds: 0,
          commonFailures: [],
          successfulStrategies: [],
          lastUpdated: new Date().toISOString(),
        });
      }
      
      const metrics = agentMap.get(key)!;
      metrics.totalSessions++;
      
      if (session.success) {
        metrics.successfulSessions++;
      }
      
      // Accumulate for averaging
      metrics.avgTimeToPR += session.timeToPR || 0;
      metrics.avgTimeToMerge += session.timeToMerge || 0;
      metrics.avgSpawnDuration += session.spawnDuration;
      metrics.avgCIRetries += session.ciRetries;
      metrics.avgLinesChanged += session.linesAdded + session.linesRemoved;
      metrics.avgFilesModified += session.filesModified;
      metrics.avgReviewRounds += session.reviewRounds;
      
      if (session.failureReason && !metrics.commonFailures.includes(session.failureReason)) {
        metrics.commonFailures.push(session.failureReason);
      }
      
      metrics.lastUpdated = new Date().toISOString();
    }
    
    // Calculate averages and rates
    for (const [, metrics] of agentMap) {
      if (metrics.totalSessions > 0) {
        metrics.successRate = metrics.successfulSessions / metrics.totalSessions;
        metrics.avgTimeToPR = metrics.avgTimeToPR / metrics.totalSessions;
        metrics.avgTimeToMerge = metrics.avgTimeToMerge / metrics.totalSessions;
        metrics.avgSpawnDuration = metrics.avgSpawnDuration / metrics.totalSessions;
        metrics.avgCIRetries = metrics.avgCIRetries / metrics.totalSessions;
        metrics.avgLinesChanged = metrics.avgLinesChanged / metrics.totalSessions;
        metrics.avgFilesModified = metrics.avgFilesModified / metrics.totalSessions;
        metrics.avgReviewRounds = metrics.avgReviewRounds / metrics.totalSessions;
        metrics.avgPassRate = metrics.totalSessions > 0 
          ? (metrics.totalSessions - metrics.ciFailures) / metrics.totalSessions 
          : 0;
      }
    }
    
    return agentMap;
  }
  
  // Pattern operations
  loadPatterns(): Pattern[] {
    try {
      if (fs.existsSync(this.patternsFile)) {
        const data = fs.readFileSync(this.patternsFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading patterns:', error);
    }
    return [];
  }
  
  savePatterns(patterns: Pattern[]): void {
    try {
      fs.writeFileSync(this.patternsFile, JSON.stringify(patterns, null, 2));
    } catch (error) {
      console.error('Error saving patterns:', error);
    }
  }
  
  // Config operations
  loadConfig(): LearningConfig {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
    return {
      enabled: true,
      minSessionsForPattern: 5,
      minSessionsForRecommendation: 3,
      storagePath: this.basePath,
    };
  }
  
  saveConfig(config: LearningConfig): void {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Error saving config:', error);
    }
  }
  
  // Utility methods
  getMetricsByAgent(agentType: string): SessionMetrics[] {
    const metrics = this.loadMetrics();
    return metrics.filter(m => m.agentType === agentType);
  }
  
  getMetricsByTaskType(taskType: string): SessionMetrics[] {
    const metrics = this.loadMetrics();
    return metrics.filter(m => m.taskType === taskType);
  }
  
  getMetricsByProject(projectId: string): SessionMetrics[] {
    const metrics = this.loadMetrics();
    return metrics.filter(m => m.projectId === projectId);
  }
  
  getRecentMetrics(days: number = 7): SessionMetrics[] {
    const metrics = this.loadMetrics();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return metrics.filter(m => new Date(m.createdAt) >= cutoff);
  }
  
  clearOldMetrics(keepDays: number = 90): void {
    const metrics = this.loadMetrics();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const filtered = metrics.filter(m => new Date(m.createdAt) >= cutoff);
    this.saveMetrics(filtered);
  }
}