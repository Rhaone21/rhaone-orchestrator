/**
 * Rhaone Orchestrator - Lineage Tracker
 * Phase 6: Task decomposition with parent → child session tracking
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { TaskDecomposer, DecomposedTask, Subtask } from './task-decomposer';
import { DependencyResolver, ExecutionPlan } from './dependency-resolver';
import { SessionManager, Session, SpawnConfig } from './session-manager';

// ==================== INTERFACES ====================

export interface TaskLineage {
  taskId: string;                          // Unique ID: task-{issueId}-{8charHash}
  issueId: string;
  projectId: string;
  title: string;                           // Original task description
  decomposition: DecomposedTask;
  executionPlan: ExecutionPlan;
  subtaskSessions: Record<string, string>; // subtaskId → sessionId
  status: 'decomposed' | 'assigning' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export interface LineageTree {
  taskId: string;
  issueId: string;
  title: string;
  status: string;
  complexity: string;
  subtasks: LineageNode[];
  summary: {
    total: number;
    completed: number;
    running: number;
    pending: number;
    failed: number;
  };
}

export interface LineageNode {
  subtaskId: string;
  title: string;
  type: string;
  status: string;
  dependencies: string[];
  sessionId?: string;
  sessionStatus?: string;
  branch?: string;
}

// ==================== CLASS ====================

export class LineageTracker {
  private decomposer: TaskDecomposer;
  private resolver: DependencyResolver;
  private sessionManager: SessionManager;
  private dataDir: string;

  constructor(sessionManager: SessionManager, dataDir?: string) {
    this.decomposer = new TaskDecomposer();
    this.resolver = new DependencyResolver();
    this.sessionManager = sessionManager;
    this.dataDir = dataDir || join(homedir(), '.rhaone-orchestrator', 'lineage');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  // ── Generate task ID ──────────────────────────────────────────────────────
  private generateTaskId(issueId: string, task: string): string {
    const hash = createHash('sha256')
      .update(`${issueId}-${task}-${Date.now()}`)
      .digest('hex')
      .slice(0, 8);
    const cleanIssueId = issueId.replace(/[^a-zA-Z0-9]/g, '');
    return `task-${cleanIssueId}-${hash}`;
  }

  // ── Save / Load lineage to disk ───────────────────────────────────────────
  private saveLineage(lineage: TaskLineage): void {
    const filePath = join(this.dataDir, `${lineage.taskId}.json`);
    writeFileSync(filePath, JSON.stringify(lineage, null, 2), 'utf-8');
  }

  loadLineage(taskId: string): TaskLineage | null {
    const filePath = join(this.dataDir, `${taskId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as TaskLineage;
    } catch {
      return null;
    }
  }

  loadAllLineages(): TaskLineage[] {
    if (!existsSync(this.dataDir)) return [];
    const files = readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
    return files.reduce<TaskLineage[]>((acc, file) => {
      try {
        const raw = readFileSync(join(this.dataDir, file), 'utf-8');
        acc.push(JSON.parse(raw) as TaskLineage);
      } catch {
        // skip corrupt files
      }
      return acc;
    }, []);
  }

  findLineageByIssue(issueId: string): TaskLineage | null {
    const all = this.loadAllLineages().filter(l => l.issueId === issueId);
    if (all.length === 0) return null;
    // Return the most recent one
    return all.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  // ── Main decompose & spawn ────────────────────────────────────────────────
  async decomposeAndSpawn(
    projectId: string,
    issueId: string,
    task: string,
    agent?: string,
    model?: string
  ): Promise<TaskLineage> {
    console.log(`[LineageTracker] Decomposing task for ${issueId}: ${task}`);

    // 1. Decompose task into subtasks
    const decomposition = this.decomposer.decompose(task, issueId);
    console.log(`[LineageTracker] Decomposed into ${decomposition.subtasks.length} subtasks (${decomposition.complexity})`);

    // 2. Build dependency graph, then generate execution plan (two separate calls!)
    await this.resolver.buildGraph(decomposition.subtasks);
    const executionPlan = await this.resolver.generateExecutionPlan();
    console.log(`[LineageTracker] Execution plan: ${executionPlan.phases.length} phases, max parallelism: ${executionPlan.maxParallelism}`);

    // 3. Create lineage record and persist
    const taskId = this.generateTaskId(issueId, task);
    const lineage: TaskLineage = {
      taskId,
      issueId,
      projectId,
      title: task,
      decomposition,
      executionPlan,
      subtaskSessions: {},
      status: 'assigning',
      createdAt: new Date().toISOString(),
    };
    this.saveLineage(lineage);
    console.log(`[LineageTracker] Created lineage record: ${taskId}`);

    // 4. Spawn sessions phase by phase (respecting dependencies)
    for (const phase of executionPlan.phases) {
      console.log(`[LineageTracker] Spawning phase ${phase.id} (${phase.tasks.length} subtasks, parallel: ${phase.canRunParallel})`);

      const spawnOne = async (subtaskId: string): Promise<void> => {
        const subtask = decomposition.subtasks.find(s => s.id === subtaskId);
        if (!subtask) {
          console.warn(`[LineageTracker] Subtask ${subtaskId} not found, skipping`);
          return;
        }

        const spawnConfig: SpawnConfig = {
          projectId,
          issueId: `${issueId}-${subtask.id.slice(-4)}`,
          task: `[${subtask.type.toUpperCase()}] ${subtask.title}\n\n${subtask.description}`,
          agent: agent || 'claude-code',
          model,
          lineage: {
            parentTaskId: taskId,
            subtaskId: subtask.id,
            subtaskTitle: subtask.title,
            decompositionLevel: 1,
            subtaskType: subtask.type,
          },
        };

        try {
          const session = await this.sessionManager.spawn(spawnConfig);
          lineage.subtaskSessions[subtaskId] = session.id;
          this.saveLineage(lineage);
          console.log(`[LineageTracker] Spawned session ${session.id} for subtask: ${subtask.title}`);
        } catch (err) {
          console.error(`[LineageTracker] Failed to spawn session for subtask ${subtaskId}:`, err);
        }
      };

      if (phase.canRunParallel) {
        await Promise.all(phase.tasks.map(spawnOne));
      } else {
        for (const subtaskId of phase.tasks) {
          await spawnOne(subtaskId);
        }
      }
    }

    lineage.status = 'running';
    this.saveLineage(lineage);
    console.log(`[LineageTracker] All phases spawned for ${taskId}`);
    return lineage;
  }

  // ── Build display tree ────────────────────────────────────────────────────
  getLineageTree(taskId: string): LineageTree | null {
    const lineage = this.loadLineage(taskId);
    if (!lineage) return null;

    const sessions = this.sessionManager.list();
    const sessionMap = new Map<string, Session>(sessions.map(s => [s.id, s]));

    let completed = 0, running = 0, pending = 0, failed = 0;

    const nodes: LineageNode[] = lineage.decomposition.subtasks.map(subtask => {
      const sessionId = lineage.subtaskSessions[subtask.id];
      const session = sessionId ? sessionMap.get(sessionId) : undefined;

      let status = 'pending';
      if (session) {
        if (session.status === 'completed' || session.status === 'merged') {
          status = 'completed';
        } else if (session.status === 'errored' || session.status === 'killed') {
          status = 'failed';
        } else if (session.status === 'working' || session.status === 'waiting_pr') {
          status = 'running';
        } else {
          status = 'pending';
        }
      }

      if (status === 'completed') completed++;
      else if (status === 'running') running++;
      else if (status === 'failed') failed++;
      else pending++;

      return {
        subtaskId: subtask.id,
        title: subtask.title,
        type: subtask.type,
        status,
        dependencies: subtask.dependencies,
        sessionId,
        sessionStatus: session?.status,
        branch: session?.branch,
      };
    });

    return {
      taskId: lineage.taskId,
      issueId: lineage.issueId,
      title: lineage.title,
      status: lineage.status,
      complexity: lineage.decomposition.complexity,
      subtasks: nodes,
      summary: {
        total: nodes.length,
        completed,
        running,
        pending,
        failed,
      },
    };
  }

  // ── List all tracked tasks ────────────────────────────────────────────────
  listTasks(): Array<{ taskId: string; issueId: string; title: string; status: string; createdAt: string }> {
    return this.loadAllLineages().map(l => ({
      taskId: l.taskId,
      issueId: l.issueId,
      title: l.title,
      status: l.status,
      createdAt: l.createdAt,
    }));
  }
}
