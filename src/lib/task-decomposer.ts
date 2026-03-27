/**
 * Rhaone Orchestrator - Task Decomposer
 * Break down complex tasks into manageable subtasks
 */

import { EventEmitter } from 'events';
import { withErrorHandling, withRetry, withGracefulDegradation } from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface DecomposedTask {
  id: string;
  title: string;
  description: string;
  complexity: 'simple' | 'moderate' | 'complex';
  estimatedSubtasks: number;
  subtasks: Subtask[];
}

export interface Subtask {
  id: string;
  title: string;
  description: string;
  type: 'code' | 'test' | 'docs' | 'refactor' | 'config' | 'research';
  priority: number;
  estimatedComplexity: number;
  dependencies: string[];
  implementation?: string;
  validation?: string;
}

export interface TaskDecompositionConfig {
  maxSubtasks?: number;
  minSubtaskSize?: 'small' | 'medium' | 'large';
  includeTests?: boolean;
  includeDocs?: boolean;
  groupByType?: boolean;
}

const DEFAULT_CONFIG: TaskDecompositionConfig = {
  maxSubtasks: 10,
  minSubtaskSize: 'medium',
  includeTests: true,
  includeDocs: false,
  groupByType: false,
};

/**
 * Task Decomposer - analyzes and breaks down complex tasks
 */
export class TaskDecomposer extends EventEmitter {
  private config: TaskDecompositionConfig;
  // Cache for decomposed tasks
  private decompositionCache: LRUCache<string, DecomposedTask>;
  // Memoized complexity detection
  private memoizedDetectComplexity: (task: string) => 'simple' | 'moderate' | 'complex';

  constructor(config: Partial<TaskDecompositionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize caches
    this.decompositionCache = new LRUCache({ maxSize: 100, ttlMs: 10 * 60 * 1000 });
    
    // Memoize complexity detection
    this.memoizedDetectComplexity = memoize(
      (task: string) => this.detectComplexityInternal(task),
      { maxSize: 50 }
    );
  }

  /**
   * Decompose a complex task into subtasks with error handling and caching
   */
  decompose(task: string, issueId?: string): DecomposedTask {
    const taskId = issueId || `task-${Date.now().toString(36)}`;
    
    // Check cache
    const cacheKey = `${taskId}-${task.slice(0, 100)}`;
    const cached = this.decompositionCache.get(cacheKey);
    if (cached) {
      console.log(`[TaskDecomposer] Using cached decomposition for ${taskId}`);
      return cached;
    }

    try {
      const complexity = this.memoizedDetectComplexity(task);
      const subtasks = this.generateSubtasks(task, taskId, complexity);

      console.log(`[TaskDecomposer] Decomposed "${taskId}" into ${subtasks.length} subtasks (${complexity})`);

      const result: DecomposedTask = {
        id: taskId,
        title: this.extractTitle(task),
        description: task,
        complexity,
        estimatedSubtasks: subtasks.length,
        subtasks,
      };

      // Cache the result
      this.decompositionCache.set(cacheKey, result);
      
      this.emit('decomposed', { taskId, subtaskCount: subtasks.length });
      return result;
    } catch (error) {
      console.error(`[TaskDecomposer] Error decomposing task:`, error);
      // Return a simple fallback decomposition
      return this.createFallbackDecomposition(task, taskId);
    }
  }

  /**
   * Detect task complexity with memoization
   */
  detectComplexity(task: string): 'simple' | 'moderate' | 'complex' {
    return this.memoizedDetectComplexity(task);
  }

  private detectComplexityInternal(task: string): 'simple' | 'moderate' | 'complex' {
    const lower = task.toLowerCase();
    
    const simpleIndicators = [
      'fix', 'typo', 'update', 'change', 'set', 'add simple',
      'remove', 'delete', 'bump', 'bump version'
    ];
    
    const complexIndicators = [
      'redesign', 'refactor', 'implement', 'create new',
      'migrate', 'architect', 'scale', 'optimize performance',
      'restructure', 'overhaul', 'multiple', 'various'
    ];

    const simpleCount = simpleIndicators.filter(i => lower.includes(i)).length;
    const complexCount = complexIndicators.filter(i => lower.includes(i)).length;
    const wordCount = task.split(/\s+/).length;

    if (complexCount > simpleCount || wordCount > 100) {
      return 'complex';
    } else if (simpleCount > complexCount && wordCount < 30) {
      return 'simple';
    }
    
    return 'moderate';
  }

  private extractTitle(task: string): string {
    const firstSentence = task.split(/[.!?]/)[0];
    if (firstSentence.length <= 50) return firstSentence;
    return task.substring(0, 50) + '...';
  }

  private generateSubtasks(task: string, taskId: string, complexity: 'simple' | 'moderate' | 'complex'): Subtask[] {
    const subtasks: Subtask[] = [];
    const lower = task.toLowerCase();
    let subtaskIndex = 1;

    // Always start with analysis/understanding subtask
    subtasks.push({
      id: `${taskId}-${subtaskIndex++}`,
      title: 'Analyze and understand the requirements',
      description: 'Review the issue, understand the context, and identify what needs to be changed',
      type: 'research',
      priority: 1,
      estimatedComplexity: 1,
      dependencies: [],
      validation: 'Understand what the task requires and confirm the scope',
    });

    const isFix = lower.includes('fix') || lower.includes('bug') || lower.includes('error');
    const isFeature = lower.includes('feature') || lower.includes('add') || lower.includes('implement');
    const isRefactor = lower.includes('refactor') || lower.includes('cleanup') || lower.includes('improve');
    const isTest = lower.includes('test') || lower.includes('coverage');
    const isDocs = lower.includes('doc') || lower.includes('readme') || lower.includes('comment');

    if (isFix) {
      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Locate the source of the issue',
        description: 'Find the code that needs to be modified to fix the issue',
        type: 'research',
        priority: 2,
        estimatedComplexity: 2,
        dependencies: [`${taskId}-1`],
        validation: 'Found the exact location(s) that need changes',
      });

      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Implement the fix',
        description: 'Make the necessary code changes to resolve the issue',
        type: 'code',
        priority: 3,
        estimatedComplexity: complexity === 'simple' ? 1 : 2,
        dependencies: [`${taskId}-2`],
        validation: 'Code changes are complete and compile successfully',
      });

      if (this.config.includeTests) {
        subtasks.push({
          id: `${taskId}-${subtaskIndex++}`,
          title: 'Add or update tests',
          description: 'Write or update tests to cover the fix',
          type: 'test',
          priority: 4,
          estimatedComplexity: 2,
          dependencies: [`${taskId}-3`],
          validation: 'Tests pass and cover the fix',
        });
      }
    } else if (isFeature) {
      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Design the solution',
        description: 'Plan how the feature will be implemented',
        type: 'research',
        priority: 2,
        estimatedComplexity: 2,
        dependencies: [`${taskId}-1`],
        validation: 'Have a clear design approach',
      });

      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Implement core feature',
        description: 'Implement the main functionality',
        type: 'code',
        priority: 3,
        estimatedComplexity: complexity === 'complex' ? 4 : 3,
        dependencies: [`${taskId}-2`],
        validation: 'Core functionality works as expected',
      });

      if (complexity === 'complex') {
        subtasks.push({
          id: `${taskId}-${subtaskIndex++}`,
          title: 'Handle edge cases',
          description: 'Implement handling for edge cases and error scenarios',
          type: 'code',
          priority: 4,
          estimatedComplexity: 3,
          dependencies: [`${taskId}-3`],
          validation: 'Edge cases are handled gracefully',
        });
      }

      if (this.config.includeTests) {
        subtasks.push({
          id: `${taskId}-${subtaskIndex++}`,
          title: 'Write tests for the feature',
          description: 'Create comprehensive tests for the new feature',
          type: 'test',
          priority: 5,
          estimatedComplexity: 2,
          dependencies: [`${taskId}-${subtaskIndex - 2}`],
          validation: 'Tests cover the feature adequately',
        });
      }
    } else if (isRefactor) {
      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Identify code to refactor',
        description: 'Find and analyze the code that needs refactoring',
        type: 'research',
        priority: 2,
        estimatedComplexity: 2,
        dependencies: [`${taskId}-1`],
        validation: 'Identified all code that needs refactoring',
      });

      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Perform refactoring',
        description: 'Refactor the identified code',
        type: 'refactor',
        priority: 3,
        estimatedComplexity: complexity === 'complex' ? 4 : 2,
        dependencies: [`${taskId}-2`],
        validation: 'Refactoring complete, all tests pass',
      });
    } else if (isTest) {
      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Identify code needing tests',
        description: 'Find code that needs test coverage',
        type: 'research',
        priority: 2,
        estimatedComplexity: 1,
        dependencies: [`${taskId}-1`],
      });

      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Write tests',
        description: 'Write tests for the identified code',
        type: 'test',
        priority: 3,
        estimatedComplexity: 2,
        dependencies: [`${taskId}-2`],
        validation: 'Tests written and passing',
      });
    } else {
      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Implement the task',
        description: 'Complete the main implementation',
        type: 'code',
        priority: 2,
        estimatedComplexity: 2,
        dependencies: [`${taskId}-1`],
      });

      if (this.config.includeTests) {
        subtasks.push({
          id: `${taskId}-${subtaskIndex++}`,
          title: 'Test the implementation',
          description: 'Verify the implementation works correctly',
          type: 'test',
          priority: 3,
          estimatedComplexity: 2,
          dependencies: [`${taskId}-${subtaskIndex - 2}`],
        });
      }
    }

    if (this.config.includeDocs) {
      subtasks.push({
        id: `${taskId}-${subtaskIndex++}`,
        title: 'Update documentation',
        description: 'Update relevant documentation',
        type: 'docs',
        priority: 6,
        estimatedComplexity: 1,
        dependencies: [],
        validation: 'Documentation is up to date',
      });
    }

    subtasks.push({
      id: `${taskId}-${subtaskIndex++}`,
      title: 'Verify and finalize',
      description: 'Run full test suite, verify all changes work correctly',
      type: 'test',
      priority: 10,
      estimatedComplexity: 1,
      dependencies: subtasks.filter(s => s.type === 'code' || s.type === 'test').map(s => s.id),
      validation: 'All tests pass, no regressions',
    });

    const maxSubtasks = this.config.maxSubtasks || 10;
    return subtasks.slice(0, maxSubtasks);
  }

  private createFallbackDecomposition(task: string, taskId: string): DecomposedTask {
    return {
      id: taskId,
      title: this.extractTitle(task),
      description: task,
      complexity: 'simple',
      estimatedSubtasks: 2,
      subtasks: [
        {
          id: `${taskId}-1`,
          title: 'Analyze requirements',
          description: 'Understand what needs to be done',
          type: 'research',
          priority: 1,
          estimatedComplexity: 1,
          dependencies: [],
        },
        {
          id: `${taskId}-2`,
          title: 'Implement and verify',
          description: 'Complete the implementation',
          type: 'code',
          priority: 2,
          estimatedComplexity: 2,
          dependencies: [`${taskId}-1`],
        },
      ],
    };
  }

  /**
   * Merge multiple decomposed tasks with error handling
   */
  async merge(tasks: DecomposedTask[]): Promise<DecomposedTask> {
    return withGracefulDegradation(
      async () => this.mergeInternal(tasks),
      {
        id: `merged-${Date.now().toString(36)}`,
        title: 'Merged Tasks',
        description: tasks.map(t => t.description).join('\n\n'),
        complexity: 'moderate',
        estimatedSubtasks: 1,
        subtasks: [],
      },
      { operationName: 'task-decomposer.merge', logError: true }
    );
  }

  private mergeInternal(tasks: DecomposedTask[]): DecomposedTask {
    const mergedSubtasks: Subtask[] = [];
    let index = 1;

    for (const task of tasks) {
      for (const subtask of task.subtasks) {
        mergedSubtasks.push({
          ...subtask,
          id: `merged-${index++}`,
          dependencies: subtask.dependencies.map(d => `merged-${parseInt(d.split('-').pop() || '1', 10)}`),
        });
      }
    }

    return {
      id: `merged-${Date.now().toString(36)}`,
      title: `Combined: ${tasks.map(t => t.title).join(', ')}`,
      description: tasks.map(t => t.description).join('\n\n'),
      complexity: tasks.some(t => t.complexity === 'complex') ? 'complex' : 
                   tasks.every(t => t.complexity === 'simple') ? 'simple' : 'moderate',
      estimatedSubtasks: mergedSubtasks.length,
      subtasks: mergedSubtasks,
    };
  }

  /**
   * Get subtasks that can run in parallel with error handling
   */
  async getParallelizableSubtasks(subtasks: Subtask[]): Promise<Subtask[][]> {
    return withGracefulDegradation(
      async () => {
        const noDeps = subtasks.filter(s => s.dependencies.length === 0);
        const withDeps = subtasks.filter(s => s.dependencies.length > 0);
        return [noDeps, ...await this.getParallelizableSubtasks(withDeps)].filter(g => g.length > 0);
      },
      [subtasks],
      { operationName: 'task-decomposer.getParallelizableSubtasks', logError: true }
    );
  }

  /**
   * Clear decomposition cache
   */
  clearCache(): void {
    this.decompositionCache.clear();
    console.log('[TaskDecomposer] Cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.decompositionCache.size(),
      maxSize: this.decompositionCache.getMaxSize(),
    };
  }
}

export const taskDecomposer = new TaskDecomposer();
