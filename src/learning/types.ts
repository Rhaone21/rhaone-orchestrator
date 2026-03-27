/**
 * Learning Engine Types
 * Phase 3: Performance tracking, pattern analysis, and recommendations
 */

export interface SessionMetrics {
  sessionId: string;
  projectId: string;
  agentType: string;
  model?: string;
  taskType: string;
  issueId?: string;
  
  // Performance data
  spawnDuration: number;
  timeToPR?: number;
  timeToMerge?: number;
  
  // CI data
  ciPasses: number;
  ciFailures: number;
  ciRetries: number;
  
  // Code quality
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;
  
  // Review data
  reviewRounds: number;
  
  // Outcome
  success: boolean;
  failureReason?: string;
  status: SessionStatus;
  
  // Timestamps
  createdAt: string;
  completedAt?: string;
}

export type SessionStatus = 
  | 'pending' 
  | 'spawning' 
  | 'working' 
  | 'pr_open' 
  | 'ci_running' 
  | 'reviewing' 
  | 'completed' 
  | 'errored' 
  | 'killed';

export interface AgentMetrics {
  agentType: string;
  model?: string;
  taskType: string;
  
  // Aggregated metrics
  totalSessions: number;
  successfulSessions: number;
  successRate: number;
  
  // Time metrics
  avgTimeToPR: number;
  avgTimeToMerge: number;
  avgSpawnDuration: number;
  
  // CI metrics
  avgCIRetries: number;
  avgPassRate: number;
  ciFailures: number;
  
  // Quality metrics
  avgLinesChanged: number;
  avgFilesModified: number;
  avgReviewRounds: number;
  
  // Patterns
  commonFailures: string[];
  successfulStrategies: string[];
  
  // Last updated
  lastUpdated: string;
}

export interface TaskType {
  name: string;
  keywords: string[];
  description: string;
}

export interface Pattern {
  id: string;
  taskType: string;
  agentType: string;
  strategy: string;
  successRate: number;
  sampleSize: number;
  avgTime: number;
  tips: string[];
}

export interface Recommendation {
  suggestedAgent: string;
  suggestedModel?: string;
  confidence: number;
  estimatedTime: number;
  tips: string[];
  basedOnPatterns: string[];
}

export interface InsightsReport {
  generatedAt: string;
  period: {
    start: string;
    end: string;
  };
  
  // Overview
  totalSessions: number;
  successRate: number;
  avgTimeToPR: number;
  
  // By agent
  agentPerformance: AgentMetrics[];
  
  // By model
  modelPerformance: ModelPerformance[];
  
  // Patterns
  topPatterns: Pattern[];
  
  // Recommendations
  recommendations: Recommendation[];
  
  // Trends
  trends: {
    successRateTrend: 'improving' | 'declining' | 'stable';
    avgTimeTrend: 'improving' | 'declining' | 'stable';
  };
}

export interface ModelPerformance {
  model: string;
  totalSessions: number;
  successRate: number;
  avgTimeToPR: number;
  avgCIRetries: number;
}

export interface LearningConfig {
  enabled: boolean;
  minSessionsForPattern: number;
  minSessionsForRecommendation: number;
  storagePath: string;
}

// Default task types for classification
export const DEFAULT_TASK_TYPES: TaskType[] = [
  { name: 'bugfix', keywords: ['fix', 'bug', 'error', 'issue', 'broken'], description: 'Bug fixes' },
  { name: 'feature', keywords: ['feat', 'feature', 'add', 'implement', 'new'], description: 'New features' },
  { name: 'refactor', keywords: ['refactor', 'cleanup', 'improve', 'restructure'], description: 'Code refactoring' },
  { name: 'docs', keywords: ['docs', 'documentation', 'readme', 'comment'], description: 'Documentation' },
  { name: 'test', keywords: ['test', 'spec', 'coverage', 'unit'], description: 'Tests' },
  { name: 'security', keywords: ['security', 'vulnerability', 'auth', 'permission'], description: 'Security fixes' },
  { name: 'performance', keywords: ['performance', 'optimize', 'speed', 'fast'], description: 'Performance improvements' },
  { name: 'ui', keywords: ['ui', 'frontend', 'css', 'style', 'design'], description: 'UI/UX changes' },
  { name: 'api', keywords: ['api', 'endpoint', 'rest', 'graphql'], description: 'API changes' },
  { name: 'database', keywords: ['db', 'database', 'migration', 'schema'], description: 'Database changes' },
];

// Pattern type classification
export type PatternType = 
  | 'success'
  | 'failure'
  | 'strategy'
  | 'optimization';

// Insight type classification
export type InsightType =
  | 'performance'
  | 'quality'
  | 'efficiency'
  | 'trend'
  | 'recommendation';

// Recommendation priority levels
export type RecommendationPriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

// Individual insight item
export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  priority: RecommendationPriority;
  metric?: string;
  value?: number;
  trend?: 'up' | 'down' | 'stable';
  timestamp: string;
}