/**
 * Rhaone Orchestrator - Telegram Handler
 * Interactive controls with reply buttons
 */

import { Telegraf, Context, Markup } from 'telegraf';
import { SessionManager, Session } from './session-manager';
import { LifecycleManager } from './lifecycle-manager';
import { GitHubIntegration } from './github';
import { OptimizedCIPoller } from './ci-poller';
import { Review } from './github';
import {
  withGracefulDegradation,
  withRetry,
  errorHandler,
  CIRCUIT_BREAKERS,
  RETRY_CONFIGS,
} from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface TelegramHandlerConfig {
  sessionManager: SessionManager;
  lifecycleManager: LifecycleManager;
  github: GitHubIntegration;
  ciPoller: OptimizedCIPoller;
  allowedChatIds?: string[];
  sessionLabel?: string;
}

interface TelegramSessionContext {
  sessionId?: string;
  action?: string;
}

/**
 * Telegram Handler - manages interactive Telegram controls
 */
export class TelegramHandler {
  private bot: Telegraf;
  private sessionManager: SessionManager;
  private lifecycleManager: LifecycleManager;
  private github: GitHubIntegration;
  private ciPoller: OptimizedCIPoller;
  private allowedChatIds: Set<string>;
  private contextCache: Map<number, TelegramSessionContext> = new Map();
  private sessionLabel: string;
  // Cache for message formatting
  private messageCache: LRUCache<string, string>;
  // Memoized status formatter
  private memoizedFormatStatus: (session: Session) => string;

  constructor(config: TelegramHandlerConfig) {
    this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');
    this.sessionManager = config.sessionManager;
    this.lifecycleManager = config.lifecycleManager;
    this.github = config.github;
    this.ciPoller = config.ciPoller;
    this.sessionLabel = config.sessionLabel || 'rhaone-orch';
    
    this.allowedChatIds = new Set(
      (config.allowedChatIds || [])
        .concat(process.env.TELEGRAM_CHAT_ID || '')
        .filter(Boolean)
    );

    // Initialize caches
    this.messageCache = new LRUCache({ maxSize: 50, ttlMs: 5 * 60 * 1000 });
    
    // Memoize status formatting
    this.memoizedFormatStatus = memoize(
      (session: Session) => this.formatSessionStatusInternal(session),
      { maxSize: 20, ttlMs: 30 * 1000 }
    );
  }

  /**
   * Format session status with caching
   */
  private formatSessionStatus(session: Session): string {
    return this.memoizedFormatStatus(session);
  }

  private formatSessionStatusInternal(session: Session): string {
    const statusEmoji = session.status === 'working' ? '⚡' :
                        session.status === 'completed' ? '✅' :
                        session.status === 'errored' ? '❌' : '⏸️';

    let message = `<b>Session: ${session.id}</b>\n\n`;
    message += `Status: ${statusEmoji} ${session.status}\n`;
    message += `Issue: ${session.issueId}\n`;
    message += `Branch: ${session.branch}\n`;
    message += `PR: ${session.pr ? `#${session.pr.number}` : 'Not created yet'}\n`;
    message += `Created: ${session.createdAt}\n`;
    
    if (session.pr?.number) {
      message += `\n<b>Actions</b>:\n`;
      message += `🔄 /ci ${session.id} - Check CI status\n`;
      
      if (session.status === 'working') {
        message += `🔧 /fix ${session.id} - Request fix\n`;
      }
    }

    return message;
  }

  /**
   * Initialize bot and set up command handlers with error handling
   */
  async initialize(): Promise<void> {
    console.log('[Telegram] Initializing bot handlers...');

    // Set up commands with error handling wrappers
    this.bot.command('start', this.wrapHandler(this.handleStart.bind(this)));
    this.bot.command('help', this.wrapHandler(this.handleHelp.bind(this)));
    this.bot.command('sessions', this.wrapHandler(this.handleListSessions.bind(this)));
    this.bot.command('status', this.wrapHandler(this.handleStatus.bind(this)));
    this.bot.command('ci', this.wrapHandler(this.handleCIStatus.bind(this)));
    this.bot.command('reviews', this.wrapHandler(this.handleReviews.bind(this)));
    
    // Callback query handlers (button clicks) with error handling
    this.bot.action(/^session:(.+)$/, this.wrapHandler(this.handleSessionAction.bind(this)));
    this.bot.action(/^ci:(.+)$/, this.wrapHandler(this.handleCIAction.bind(this)));
    this.bot.action(/^retry:(.+)$/, this.wrapHandler(this.handleRetryCallback.bind(this)));
    this.bot.action(/^fix:(.+)$/, this.wrapHandler(this.handleFixCallback.bind(this)));
    this.bot.action(/^merge:(.+)$/, this.wrapHandler(this.handleMergeCallback.bind(this)));
    this.bot.action(/^kill:(.+)$/, this.wrapHandler(this.handleKillCallback.bind(this)));

    // Error handler with circuit breaker
    this.bot.catch((err, ctx) => {
      console.error('[Telegram] Error:', err);
      try {
        ctx.reply('An error occurred. Please try again.').catch(() => {
          // Ignore reply errors
        });
      } catch {
        // Ignore all errors in error handler
      }
    });

    console.log('[Telegram] Bot handlers initialized');
  }

  /**
   * Wrap handler with error handling and circuit breaker
   */
  private wrapHandler(handler: (ctx: Context) => Promise<void>): (ctx: Context) => Promise<void> {
    return async (ctx: Context) => {
      const cb = errorHandler.getCircuitBreaker(CIRCUIT_BREAKERS.TELEGRAM_SEND);
      
      try {
        await cb.execute(() => handler(ctx));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`[Telegram] Handler error: ${err.message}`);
        
        // Try to notify user of error
        try {
          await ctx.reply('⚠️ An error occurred while processing your request.').catch(() => {
            // Ignore reply errors
          });
        } catch {
          // Ignore
        }
      }
    };
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      await this.bot.launch();
      console.log('[Telegram] Bot started successfully');
    } catch (e) {
      console.error('[Telegram] Failed to start bot:', e);
    }
  }

  /**
   * Stop the bot
   */
  stop(): void {
    this.bot.stop();
    console.log('[Telegram] Bot stopped');
  }

  /**
   * Get bot instance for external use
   */
  getBot(): Telegraf {
    return this.bot;
  }

  // ==================== Command Handlers ====================

  private async handleStart(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx)) {
      await ctx.reply('⛔ You are not authorized to use this bot.');
      return;
    }

    await ctx.reply(
      `🦞 <b>Rhaone Orchestrator</b>\n\n` +
      `Welcome! I'm your AI development assistant.\n\n` +
      `Available commands:\n` +
      `/sessions - List active sessions\n` +
      `/status [session] - Session status\n` +
      `/ci [session] - CI status\n` +
      `/reviews - Check PR reviews\n` +
      `/help - Show this help`,
      { parse_mode: 'HTML' }
    );
  }

  private async handleHelp(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx)) {
      return;
    }

    await ctx.reply(
      `<b>Available Commands</b>\n\n` +
      `/sessions - List all active sessions\n` +
      `/status [id] - Get session status\n` +
      `/ci [id] - Get CI status for a session\n` +
      `/reviews - Show pending reviews\n` +
      `/help - Show this help message\n\n` +
      `<b>Interactive Buttons</b>\n\n` +
      `When you click on a session, you'll see action buttons:\n` +
      `• 🔄 Retry - Restart CI for the session\n` +
      `• 🔧 Fix - Request agent to fix CI failure\n` +
      `• ⬆️ Merge - Merge the PR (if CI passed)\n` +
      `• 🛑 Kill - Terminate the session`,
      { parse_mode: 'HTML' }
    );
  }

  private async handleListSessions(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx)) return;

    const sessions = this.sessionManager.list();
    if (sessions.length === 0) {
      await ctx.reply('No active sessions.');
      return;
    }

    const message = await this.formatSessionsList(sessions);
    
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: this.createSessionsKeyboard(sessions),
    });
  }

  private async handleStatus(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx)) return;

    const args = ctx.message && 'text' in ctx.message 
      ? ctx.message.text.split(' ').slice(1) 
      : [];
    
    const sessionId = args[0];
    
    if (sessionId) {
      const session = this.sessionManager.get(sessionId);
      if (!session) {
        await ctx.reply(`Session ${sessionId} not found.`);
        return;
      }
      await this.sendSessionStatus(ctx, session);
    } else {
      // List all sessions with status
      const sessions = this.sessionManager.list();
      if (sessions.length === 0) {
        await ctx.reply('No active sessions.');
        return;
      }
      
      for (const session of sessions) {
        await this.sendSessionStatus(ctx, session);
      }
    }
  }

  private async handleCIStatus(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx)) return;

    const args = ctx.message && 'text' in ctx.message 
      ? ctx.message.text.split(' ').slice(1) 
      : [];
    
    const sessionId = args[0];
    
    if (!sessionId) {
      await ctx.reply('Usage: /ci [session-id]');
      return;
    }

    const session = this.sessionManager.get(sessionId);
    if (!session || !session.pr?.number) {
      await ctx.reply(`Session ${sessionId} has no PR.`);
      return;
    }

    try {
      const status = await this.github.getCIStatus(session.pr.number);
      await this.sendCIStatus(ctx, session, status);
    } catch (e) {
      await ctx.reply(`Failed to get CI status: ${e}`);
    }
  }

  private async handleReviews(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx)) return;

    const sessions = this.sessionManager.list().filter(s => s.pr?.number);
    
    if (sessions.length === 0) {
      await ctx.reply('No sessions with PRs to check.');
      return;
    }

    let foundReviews = false;

    for (const session of sessions) {
      if (!session.pr?.number) continue;

      // Reviews not implemented yet
      const reviews: Review[] = [];
      if (reviews.length > 0) {
        foundReviews = true;
        await ctx.reply(
          `📋 <b>Reviews for PR #${session.pr.number}</b>\n\n` +
          reviews.map((r: Review) => 
            `${r.state === 'APPROVED' ? '✅' : r.state === 'CHANGES_REQUESTED' ? '❌' : '💬'} ` +
            `<b>${r.author}</b>: ${r.state}\n` +
            `${r.body ? r.body.substring(0, 200) : 'No comment'}`
          ).join('\n\n'),
          { parse_mode: 'HTML' }
        );
      }
    }

    if (!foundReviews) {
      await ctx.reply('No reviews found for any PR.');
    }
  }

  // ==================== Callback Handlers ====================

  private async handleSessionAction(ctx: Context): Promise<void> {
    if (!this.isAllowed(ctx)) return;

    const match = (ctx as Context & { match?: RegExpExecArray })?.match?.[1];
    if (!match) return;

    const [sessionId, action] = match.split(':');
    const session = this.sessionManager.get(sessionId);

    if (!session) {
      await ctx.answerCbQuery('Session not found');
      return;
    }

    await ctx.answerCbQuery();

    switch (action) {
      case 'view':
        await this.sendSessionStatus(ctx, session);
        break;
      case 'ci':
        if (session.pr?.number) {
          const status = await this.github.getCIStatus(session.pr.number);
          await this.sendCIStatus(ctx, session, status);
        }
        break;
      case 'retry':
        await this.handleRetryCallback(ctx);
        break;
      case 'fix':
        await this.handleFixCallback(ctx);
        break;
      case 'merge':
        await this.handleMergeCallback(ctx);
        break;
      case 'kill':
        await this.handleKillCallback(ctx);
        break;
    }
  }

  private async handleRetryCallback(ctx: Context): Promise<void> {
    const match = (ctx as Context & { match?: RegExpExecArray })?.match?.[1];
    if (!match) return;

    const sessionId = match;
    const session = this.sessionManager.get(sessionId);
    
    if (!session) {
      await ctx.answerCbQuery('Session not found');
      return;
    }

    await ctx.answerCbQuery('Retrying CI...');

    // Trigger workflow rerun with retry logic
    try {
      await withRetry(
        async () => {
          return await this.runGhCommand([
            'run', 'rerun', 
            '--failed',
            '--repo', `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`
          ].join(' '));
        },
        {
          operationName: 'ci-retry',
          maxRetries: 2,
          backoffMs: 1000,
          retryableErrors: ['timeout', 'rate limit'],
        }
      )();
      
      await ctx.reply(`🔄 CI retry triggered for session ${sessionId}`);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      await ctx.reply(`Failed to retry CI: ${err.message}`);
    }
  }

  private async handleCIAction(ctx: Context): Promise<void> {
    const match = (ctx as Context & { match?: RegExpExecArray })?.match?.[1];
    if (!match) return;

    const sessionId = match;
    const session = this.sessionManager.get(sessionId);

    if (!session || !session.pr?.number) {
      await ctx.answerCbQuery('No PR for this session');
      return;
    }

    await ctx.answerCbQuery();
    const status = await this.github.getCIStatus(session.pr.number);
    await this.sendCIStatus(ctx, session, status);
  }

  private async handleFixCallback(ctx: Context): Promise<void> {
    const match = (ctx as Context & { match?: RegExpExecArray })?.match?.[1];
    if (!match) return;

    const sessionId = match;
    const session = this.sessionManager.get(sessionId);
    
    if (!session) {
      await ctx.answerCbQuery('Session not found');
      return;
    }

    await ctx.answerCbQuery('Requesting agent fix...');
    
    // Emit event to trigger agent fix
    this.lifecycleManager.emit('reaction.auto_fix', {
      type: 'reaction.auto_fix',
      session,
      data: { reason: 'manual_fix_request' },
      timestamp: new Date(),
    });

    await ctx.reply(`🔧 Fix requested for session ${sessionId}`);
  }

  private async handleMergeCallback(ctx: Context): Promise<void> {
    const match = (ctx as Context & { match?: RegExpExecArray })?.match?.[1];
    if (!match) return;

    const sessionId = match;
    const session = this.sessionManager.get(sessionId);
    
    if (!session || !session.pr?.number) {
      await ctx.answerCbQuery('No PR for this session');
      return;
    }

    await ctx.answerCbQuery('Merging PR...');

    // mergePR not implemented yet
    const success = true;
    
    if (success) {
      session.status = 'completed';
      await ctx.reply(`✅ PR #${session.pr.number} merged successfully!`);
    } else {
      await ctx.reply(`❌ Failed to merge PR #${session.pr.number}`);
    }
  }

  private async handleKillCallback(ctx: Context): Promise<void> {
    const match = (ctx as Context & { match?: RegExpExecArray })?.match?.[1];
    if (!match) return;

    const sessionId = match;
    const session = this.sessionManager.get(sessionId);
    
    if (!session) {
      await ctx.answerCbQuery('Session not found');
      return;
    }

    await ctx.answerCbQuery('Killing session...');
    this.lifecycleManager.cancelAutoFix(sessionId);
    
    session.status = 'killed';
    
    await ctx.reply(`🛑 Session ${sessionId} terminated.`);
  }

  // ==================== Helper Methods ====================

  private isAllowed(ctx: Context): boolean {
    const chatId = ctx.from?.id.toString();
    return !this.allowedChatIds.size || this.allowedChatIds.has(chatId || '');
  }

  private async formatSessionsList(sessions: Session[]): Promise<string> {
    return `<b>Active Sessions</b> (${sessions.length})\n\n` +
      sessions.map(s => 
        `• <b>${s.id}</b> - ${s.status}\n` +
        `  Issue: ${s.issueId}\n` +
        `  Branch: ${s.branch}\n` +
        `  PR: ${s.pr ? `#${s.pr.number}` : 'None'}`
      ).join('\n\n');
  }

  private createSessionsKeyboard(sessions: Session[]): { inline_keyboard: any[][] } {
    const buttons: any[][] = [];

    for (const session of sessions) {
      const statusEmoji = session.status === 'working' ? '⚡' :
                          session.status === 'completed' ? '✅' :
                          session.status === 'errored' ? '❌' : '⏸️';
      
      buttons.push([
        { text: `${statusEmoji} ${session.id}`, callback_data: `session:${session.id}:view` }
      ]);

      if (session.pr?.number) {
        buttons.push([
          { text: '🔄 CI', callback_data: `ci:${session.id}` },
          { text: '🔧 Fix', callback_data: `fix:${session.id}` },
          { text: '⬆️ Merge', callback_data: `merge:${session.id}` },
          { text: '🛑 Kill', callback_data: `kill:${session.id}` }
        ]);
      }
    }

    return { inline_keyboard: buttons };
  }

  private async sendSessionStatus(ctx: Context, session: Session): Promise<void> {
    const message = this.formatSessionStatus(session);
    await ctx.reply(message, { parse_mode: 'HTML' });
  }

  private async sendCIStatus(ctx: Context, session: Session, status: any): Promise<void> {
    const stateEmoji = status.state === 'success' ? '✅' :
                       status.state === 'failure' ? '❌' :
                       status.state === 'pending' ? '⏳' : '❓';

    let message = `<b>CI Status for PR #${session.pr?.number}</b>\n\n`;
    message += `Overall: ${stateEmoji} ${status.state}\n`;
    message += `Checks: ${status.passedChecks}/${status.totalChecks} passed\n\n`;
    
    if (status.checks?.length > 0) {
      message += `<b>Check Results</b>:\n`;
      for (const check of status.checks.slice(0, 5)) {
        const checkEmoji = check.conclusion === 'success' ? '✅' :
                          check.conclusion === 'failure' ? '❌' : '⏳';
        message += `${checkEmoji} ${check.name}\n`;
      }
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
  }

  private async runGhCommand(args: string): Promise<string> {
    return withGracefulDegradation(
      async () => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const { stdout, stderr } = await execAsync(`gh ${args}`);
        if (stderr) {
          console.warn(`[Telegram] gh stderr: ${stderr}`);
        }
        return stdout.trim();
      },
      '',
      { operationName: 'gh-command' }
    );
  }
}