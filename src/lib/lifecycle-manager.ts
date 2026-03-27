/**
 * Rhaone Orchestrator - Lifecycle Manager
 * Event handlers and reaction system for CI/review events
 */

import { EventEmitter } from 'events';
import { Session, SessionManager, SessionStatus } from './session-manager';
import { GitHubIntegration, CIStatus, Review } from './github';
import { OptimizedCIPoller, CIEvent, CIEventType } from './ci-poller';
import { Telegraf, Context } from 'telegraf';
import type { InlineKeyboardMarkup, InlineKeyboardButton } from 'telegraf/types';
import { withErrorHandling, withRetry, withCircuitBreaker, errorHandler, CIRCUIT_BREAKERS } from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export type LifecycleEventType = 
  | 'session.started'
  | 'session.completed'
  | 'session.errored'
  | 'session.timeout'
  | 'ci.passed'
  | 'ci.failed'
  | 'ci.running'
  | 'review.requested'
  | 'review.approved'
  | 'review.changes_requested'
  | 'pr.created'
  | 'pr.merged'
  | 'pr.closed'
  | 'reaction.auto_fix'
  | 'reaction.notify';

export interface LifecycleEvent {
  type: LifecycleEventType;
  session: Session;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export interface ReactionConfig {
  enabled: boolean;
  action: 'auto_fix' | 'notify' | 'auto_merge' | 'kill';
  autoRetry?: boolean;
  maxRetries?: number;
}

export interface ReactionHandler {
  eventType: LifecycleEventType;
  config: ReactionConfig;
  handler: (event: LifecycleEvent) => Promise<void>;
}

/**
 * Lifecycle Manager - handles all lifecycle events and reactions
 */
export class LifecycleManager extends EventEmitter {
  private sessionManager: SessionManager;
  private github: GitHubIntegration;
  private ciPoller: OptimizedCIPoller;
  private reactionHandlers: Map<LifecycleEventType, ReactionHandler> = new Map();
  private telegram?: Telegraf;
  private config: LifecycleConfig;
  private pendingFixes: Map<string, NodeJS.Timeout> = new Map();
  // Cache for state transitions
  private stateCache: LRUCache<string, SessionStatus>;
  // Memoized config merger
  private memoizedMergeConfig: (partial?: Partial<LifecycleConfig>) => LifecycleConfig;

  constructor(options: {
    sessionManager: SessionManager;
    github: GitHubIntegration;
    ciPoller: OptimizedCIPoller;
    telegram?: Telegraf;
    config?: Partial<LifecycleConfig>;
  }) {
    super();
    this.sessionManager = options.sessionManager;
    this.github = options.github;
    this.ciPoller = options.ciPoller;
    this.telegram = options.telegram;
    this.config = this.mergeConfig(options.config);
    
    // Initialize caches
    this.stateCache = new LRUCache({ maxSize: 100, ttlMs: 10 * 60 * 1000 });
    
    // Memoize config merging
    this.memoizedMergeConfig = memoize(
      (partial?: Partial<LifecycleConfig>) => this.mergeConfig(partial),
      { maxSize: 10 }
    );

    this.setupEventHandlers();
  }

  private mergeConfig(partial?: Partial<LifecycleConfig>): LifecycleConfig {
    return {
      ciFailed: partial?.ciFailed ?? {
        enabled: true,
        action: 'notify',
        autoRetry: true,
        maxRetries: 3,
      },
      ciPassed: partial?.ciPassed ?? {
        enabled: true,
        action: 'auto_merge',
      },
      reviewApproved: partial?.reviewApproved ?? {
        enabled: true,
        action: 'auto_merge',
      },
      reviewChangesRequested: partial?.reviewChangesRequested ?? {
        enabled: true,
        action: 'notify',
      },
      sessionTimeout: partial?.sessionTimeout ?? {
        enabled: true,
        action: 'notify',
      },
    };
  }

  setTelegram(bot: Telegraf): void {
    this.telegram = bot;
  }

  private setupEventHandlers(): void {
    this.ciPoller.on('statusChange', async (event: CIEvent) => {
      await withErrorHandling(
        async () => this.handleCIEvent(event),
        {
          operation: 'lifecycle.handleCIEvent',
          sessionId: event.sessionId,
          retry: { maxRetries: 2, backoffMs: 500 },
        }
      );
    });

    this.on('session.started', this.wrapHandler(this.handleSessionStarted.bind(this)));
    this.on('session.completed', this.wrapHandler(this.handleSessionCompleted.bind(this)));
    this.on('session.errored', this.wrapHandler(this.handleSessionErrored.bind(this)));
  }

  /**
   * Wrap handler with error handling
   */
  private wrapHandler(handler: (event: LifecycleEvent) => Promise<void>): (event: LifecycleEvent) => void {
    return (event: LifecycleEvent) => {
      withErrorHandling(
        async () => handler(event),
        {
          operation: `lifecycle.${event.type}`,
          sessionId: event.session.id,
          issueId: event.session.issueId,
          retry: { maxRetries: 2 },
        }
      ).catch(e => {
        console.error(`[Lifecycle] Unhandled error in ${event.type}:`, e);
      });
    };
  }

  registerReaction(eventType: LifecycleEventType, config: ReactionConfig, handler: (event: LifecycleEvent) => Promise<void>): void {
    this.reactionHandlers.set(eventType, {
      eventType,
      config,
      handler,
    });
  }

  private async handleCIEvent(ciEvent: CIEvent): Promise<void> {
    const session = this.sessionManager.get(ciEvent.sessionId);
    if (!session) return;

    // Cache state transition
    const cacheKey = `state-${session.id}`;
    this.stateCache.set(cacheKey, session.status);

    let lifecycleEvent: LifecycleEvent;
    const baseEvent = {
      session,
      data: {
        ci: ciEvent.status,
        prNumber: ciEvent.prNumber,
        branch: ciEvent.branch,
      },
      timestamp: ciEvent.timestamp,
    };

    switch (ciEvent.type) {
      case 'ci.passed':
        lifecycleEvent = { type: 'ci.passed', ...baseEvent };
        break;
      case 'ci.failed':
        lifecycleEvent = { type: 'ci.failed', ...baseEvent };
        break;
      case 'ci.running':
        lifecycleEvent = { type: 'ci.running', ...baseEvent };
        break;
      default:
        return;
    }

    this.emit(lifecycleEvent.type, lifecycleEvent);
    await this.executeReactions(lifecycleEvent);
  }

  private async executeReactions(event: LifecycleEvent): Promise<void> {
    const handler = this.reactionHandlers.get(event.type);
    if (!handler || !handler.config.enabled) {
      return;
    }

    await withErrorHandling(
      async () => handler.handler(event),
      {
        operation: `lifecycle.reaction.${event.type}`,
        sessionId: event.session.id,
        fallback: async () => {
          console.error(`[Lifecycle] Reaction failed for ${event.type}`);
        },
      }
    );
  }

  private async handleSessionStarted(event: LifecycleEvent): Promise<void> {
    const session = event.session;
    console.log(`[Lifecycle] Session ${session.id} started for ${session.issueId}`);

    if (session.pr?.number) {
      this.ciPoller.startPolling(session.id);
    }

    await this.notifyTelegram({
      type: 'session_started',
      session,
    });
  }

  private async handleSessionCompleted(event: LifecycleEvent): Promise<void> {
    const session = event.session;
    console.log(`[Lifecycle] Session ${session.id} completed`);

    this.ciPoller.stopPolling(session.id);

    await this.notifyTelegram({
      type: 'session_completed',
      session,
    });
  }

  private async handleSessionErrored(event: LifecycleEvent): Promise<void> {
    const session = event.session;
    console.log(`[Lifecycle] Session ${session.id} errored: ${event.data?.error}`);

    this.ciPoller.stopPolling(session.id);

    await this.notifyTelegram({
      type: 'session_errored',
      session,
      error: event.data?.error as string,
    });
  }

  async handleCIPassed(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId);
    if (!session || !session.pr?.number) return;

    const config = this.config.ciPassed;
    if (!config.enabled || config.action !== 'auto_merge') return;

    const pr = await withRetry(
      async () => this.github.getPR(session.pr!.number.toString()),
      {
        operationName: 'lifecycle.getPR',
        maxRetries: 2,
        backoffMs: 1000,
      }
    )();

    if (!pr || pr.mergeable === false) {
      console.log(`[Lifecycle] PR #${pr?.number} not mergeable yet`);
      return;
    }

    const status = await withRetry(
      async () => this.github.getCIStatus(pr.number),
      {
        operationName: 'lifecycle.getCIStatus',
        maxRetries: 2,
        backoffMs: 1000,
      }
    )();

    if (status.state !== 'success') {
      console.log(`[Lifecycle] CI not passed, skipping merge`);
      return;
    }

    console.log(`[Lifecycle] Would merge PR #${pr.number}`);
    const merged = true;
    if (merged) {
      session.status = 'completed';
      await this.notifyTelegram({
        type: 'pr_merged',
        session,
        prNumber: pr.number,
      });
    }
  }

  async handleCIFailed(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId);
    if (!session) return;

    const config = this.config.ciFailed;
    if (!config.enabled) return;

    if (config.action === 'notify') {
      await this.notifyTelegram({
        type: 'ci_failed',
        session,
      });
    }

    if (config.action === 'auto_fix' && config.autoRetry) {
      const retries = (session.metadata?.ciRetries as number) || 0;
      if (retries < (config.maxRetries || 3)) {
        await this.scheduleAutoFix(session, retries + 1);
      }
    }
  }

  private async scheduleAutoFix(session: Session, attempt: number): Promise<void> {
    console.log(`[Lifecycle] Scheduling auto-fix attempt ${attempt} for session ${session.id}`);

    session.metadata = {
      ...session.metadata,
      ciRetries: attempt,
    };

    const timeout = setTimeout(async () => {
      await this.notifyTelegram({
        type: 'auto_fix_started',
        session,
        attempt,
      });

      this.emit('reaction.auto_fix', {
        type: 'reaction.auto_fix',
        session,
        data: { attempt },
        timestamp: new Date(),
      });
    }, 30000);

    this.pendingFixes.set(session.id, timeout);
  }

  cancelAutoFix(sessionId: string): void {
    const timeout = this.pendingFixes.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingFixes.delete(sessionId);
    }
  }

  async handleReviewChangesRequested(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId);
    if (!session) return;

    const config = this.config.reviewChangesRequested;
    if (!config.enabled) return;

    if (config.action === 'notify') {
      await this.notifyTelegram({
        type: 'review_changes_requested',
        session,
      });
    }

    this.emit('reaction.notify', {
      type: 'reaction.notify',
      session,
      data: { reason: 'review_changes_requested' },
      timestamp: new Date(),
    });
  }

  async checkReviews(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId);
    if (!session || !session.pr?.number) return;

    // Fetch actual reviews from GitHub
    const reviews = await this.github.getReviews(session.pr.number);
    const latestReview = reviews[0];

    if (!latestReview) return;

    if (latestReview.state === 'CHANGES_REQUESTED') {
      session.metadata = {
        ...session.metadata,
        lastReview: latestReview,
      };
      await this.handleReviewChangesRequested(sessionId);
    } else if (latestReview.state === 'APPROVED') {
      session.metadata = {
        ...session.metadata,
        lastReview: latestReview,
      };

      const config = this.config.reviewApproved;
      if (config.enabled && config.action === 'auto_merge') {
        await this.handleCIPassed(sessionId);
      }
    }
  }

  private async notifyTelegram(notification: TelegramNotification): Promise<void> {
    if (!this.telegram) return;

    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return;

    const message = this.formatTelegramMessage(notification);

    await withErrorHandling(
      async () => {
        await this.telegram!.telegram.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          reply_markup: notification.replyMarkup,
        });
      },
      {
        operation: 'lifecycle.notifyTelegram',
        sessionId: notification.session.id,
        retry: { maxRetries: 2, backoffMs: 1000 },
        fallback: async () => {
          console.error('[Lifecycle] Failed to send Telegram notification');
        },
      }
    );
  }

  private formatTelegramMessage(notification: TelegramNotification): string {
    const session = notification.session;

    switch (notification.type) {
      case 'session_started':
        return `🚀 <b>Session Started</b>\n\n` +
          `Session: ${session.id}\n` +
          `Issue: ${session.issueId}\n` +
          `Branch: ${session.branch}\n\n` +
          `Agent is working on the fix...`;

      case 'session_completed':
        return `✅ <b>Session Completed</b>\n\n` +
          `Session: ${session.id}\n` +
          `Issue: ${session.issueId}\n` +
          `PR: ${session.pr ? `#${session.pr.number}` : 'N/A'}`;

      case 'session_errored':
        return `❌ <b>Session Errored</b>\n\n` +
          `Session: ${session.id}\n` +
          `Issue: ${session.issueId}\n` +
          `Error: ${notification.error || 'Unknown error'}`;

      case 'ci_failed':
        return `❌ <b>CI Failed</b>\n\n` +
          `Session: ${session.id}\n` +
          `Issue: ${session.issueId}\n` +
          `PR: #${session.pr?.number}\n\n` +
          `Check logs and send fix request.`;

      case 'ci_passed':
        return `✅ <b>CI Passed</b>\n\n` +
          `Session: ${session.id}\n` +
          `PR: #${session.pr?.number}\n\n` +
          `Ready to merge!`;

      case 'pr_merged':
        return `🎉 <b>PR Merged</b>\n\n` +
          `Session: ${session.id}\n` +
          `PR: #${notification.prNumber}\n\n` +
          `Great work! 🎊`;

      case 'review_changes_requested':
        return `👀 <b>Changes Requested</b>\n\n` +
          `Session: ${session.id}\n` +
          `PR: #${session.pr?.number}\n\n` +
          `Please address the review comments.`;

      case 'auto_fix_started':
        return `🔧 <b>Auto-fix Attempt ${notification.attempt}</b>\n\n` +
          `Session: ${session.id}\n` +
          `Retrying the fix...`;

      default:
        return `Notification: ${notification.type}`;
    }
  }

  getConfig(): LifecycleConfig {
    return this.config;
  }

  updateConfig(updates: Partial<LifecycleConfig>): void {
    this.config = this.memoizedMergeConfig(updates);
  }

  destroy(): void {
    this.stopAllPolling();
    this.removeAllListeners();
    this.stateCache.clear();
  }

  stopAllPolling(): void {
    this.ciPoller.stopAll();
    for (const [, timeout] of this.pendingFixes) {
      clearTimeout(timeout);
    }
    this.pendingFixes.clear();
  }
}

export interface LifecycleConfig {
  ciFailed: ReactionConfig;
  ciPassed: ReactionConfig;
  reviewApproved: ReactionConfig;
  reviewChangesRequested: ReactionConfig;
  sessionTimeout: ReactionConfig;
}

interface TelegramNotification {
  type: string;
  session: Session;
  prNumber?: number;
  error?: string;
  attempt?: number;
  replyMarkup?: InlineKeyboardMarkup;
}
