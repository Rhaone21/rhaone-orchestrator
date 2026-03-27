/**
 * Rhaone Orchestrator - Telegram Notifier
 * Send status updates to Telegram
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import {
  withRetry,
  withCircuitBreaker,
  withGracefulDegradation,
  withTimeout,
  errorHandler,
  CIRCUIT_BREAKERS,
  RETRY_CONFIGS,
  recoverTelegramSend,
} from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface TelegramConfig {
  botToken?: string;
  chatId?: string;
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationOptions {
  level?: NotificationLevel;
  parseMode?: 'markdown' | 'html';
  disableNotification?: boolean;
}

/**
 * Format message with emoji based on level
 */
function formatWithEmoji(message: string, level: NotificationLevel): string {
  const emojis: Record<NotificationLevel, string> = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  };
  return `${emojis[level]} ${message}`;
}

/**
 * Load Telegram config from file or environment
 */
function loadTelegramConfig(): TelegramConfig {
  const configPath = join(homedir(), '.rhaone-orchestrator', 'telegram.json');
  
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      console.log('[Telegram] Failed to parse config, using env vars');
    }
  }

  return {
    botToken: process.env.RHAONE_TELEGRAM_BOT_TOKEN,
    chatId: process.env.RHAONE_TELEGRAM_CHAT_ID,
  };
}

/**
 * Telegram Notifier - sends messages to Telegram
 */
export class TelegramNotifier {
  private botToken?: string;
  private chatId?: string;
  private defaultLevel: NotificationLevel = 'info';
  // Memoized message formatter
  private memoizedFormatMessage: (message: string, level: NotificationLevel) => string;

  constructor(config?: TelegramConfig) {
    const loaded = config || loadTelegramConfig();
    this.botToken = loaded.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = loaded.chatId || process.env.TELEGRAM_CHAT_ID;
    // NOTE: baseUrl is NOT stored with the token to avoid token leaking in logs/stack traces.
    // The URL is built at call time in sendOperation().
    
    // Memoize message formatting
    this.memoizedFormatMessage = memoize(
      (message: string, level: NotificationLevel) => formatWithEmoji(message, level),
      { maxSize: 50 }
    );
  }

  /**
   * Check if Telegram is configured
   */
  isConfigured(): boolean {
    return !!(this.botToken && this.chatId);
  }

  /**
   * Configure the notifier
   */
  configure(config: TelegramConfig): void {
    if (config.botToken) this.botToken = config.botToken;
    if (config.chatId) this.chatId = config.chatId;
    // baseUrl is built at call time; no need to update here.
  }

  /**
   * Set default notification level
   */
  setDefaultLevel(level: NotificationLevel): void {
    this.defaultLevel = level;
  }

  /**
   * Send a message to Telegram with comprehensive error handling
   */
  async send(
    message: string,
    options: NotificationOptions = {}
  ): Promise<{ ok: boolean; messageId?: number }> {
    if (!this.isConfigured()) {
      console.log(`[Telegram] Not configured, skipping: ${message.slice(0, 50)}...`);
      return { ok: false };
    }

    const { level = this.defaultLevel, parseMode = 'html', disableNotification = false } = options;
    
    const formattedMessage = this.memoizedFormatMessage(message, level);

    const sendOperation = async (): Promise<{ ok: boolean; messageId?: number }> => {
      // Build URL at call time to avoid token appearing in class state/logs
      const apiUrl = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const payload = {
        chat_id: this.chatId,
        text: formattedMessage,
        parse_mode: 'HTML',
        disable_notification: disableNotification,
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };
      
      if (result.ok) {
        console.log(`[Telegram] Sent: ${formattedMessage.slice(0, 50)}...`);
      } else {
        // Check for retryable errors
        const errorDesc = result.description?.toLowerCase() || '';
        if (errorDesc.includes('timeout') || errorDesc.includes('retry') || errorDesc.includes('too many')) {
          throw new Error(`Telegram API error: ${result.description}`);
        }
        console.error(`[Telegram] Error: ${JSON.stringify(result)}`);
      }

      return { 
        ok: result.ok, 
        messageId: result.result?.message_id 
      };
    };

    try {
      // Use circuit breaker and retry logic
      const cb = errorHandler.getCircuitBreaker(CIRCUIT_BREAKERS.TELEGRAM_SEND);
      
      const result = await withTimeout(
        () => cb.execute(() => 
          withRetry(sendOperation, {
            operationName: 'telegram-send',
            ...RETRY_CONFIGS.TELEGRAM_SEND,
            onRetry: (attempt, error, delay) => {
              console.log(`[Telegram] Retry ${attempt} after ${delay}ms: ${error.message}`);
            },
          })()
        ),
        30000, // 30 second timeout
        { operationName: 'telegram-send' }
      );
      
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[Telegram] Failed to send after retries: ${err.message}`);

      // Attempt recovery
      const recovered = await recoverTelegramSend(async () => {
        await sendOperation();
      });

      if (recovered) {
        return { ok: true };
      }

      return { ok: false };
    }
  }
  
  /**
   * Clear notification cache (no-op: notification caching removed to ensure all alerts are sent)
   */
  clearCache(): void {
    console.log('[Telegram Notifier] Cache is disabled; all messages are sent immediately');
  }
  
  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; maxSize: number } {
    return { size: 0, maxSize: 0 };
  }

  /**
   * Send session started notification
   */
  async notifySessionStart(sessionId: string, issueId: string, branch: string): Promise<void> {
    const message = [
      '🚀 *Session Started*',
      `Session: \`${sessionId}\``,
      `Issue: ${issueId}`,
      `Branch: \`${branch}\``,
    ].join('\n');
    await this.send(message, { level: 'info' });
  }

  /**
   * Send session completed notification
   */
  async notifySessionComplete(
    sessionId: string, 
    issueId: string, 
    prUrl?: string,
    success = true
  ): Promise<void> {
    const prText = prUrl ? `\n[PR](${prUrl})` : '';
    const message = [
      `${success ? '✅' : '⚠️'} *Session ${success ? 'Complete' : 'Finished'}*`,
      `Session: \`${sessionId}\``,
      `Issue: ${issueId}${prText}`,
    ].join('\n');
    await this.send(message, { level: success ? 'success' : 'warning' });
  }

  /**
   * Send error notification
   */
  async notifyError(sessionId: string, error: string): Promise<void> {
    const message = [
      '❌ *Session Error*',
      `Session: \`${sessionId}\``,
      `Error: ${error.slice(0, 200)}`,
    ].join('\n');
    await this.send(message, { level: 'error' });
  }

  /**
   * Send worktree created notification
   */
  async notifyWorktreeCreated(branch: string, worktreePath: string): Promise<void> {
    const message = [
      '🌿 *Worktree Created*',
      `Branch: \`${branch}\``,
      `Path: \`${worktreePath}\``,
    ].join('\n');
    await this.send(message, { level: 'info' });
  }

  /**
   * Send worktree destroyed notification
   */
  async notifyWorktreeDestroyed(branch: string): Promise<void> {
    const message = [
      '🗑️ *Worktree Destroyed*',
      `Branch: \`${branch}\``,
    ].join('\n');
    await this.send(message, { level: 'info' });
  }

  /**
   * Send batch summary
   */
  async notifyBatchSummary(
    total: number,
    succeeded: number,
    failed: number,
    duration: number
  ): Promise<void> {
    const minutes = Math.round(duration / 60);
    const message = [
      '📊 *Batch Complete*',
      `Total: ${total} | ✅ ${succeeded} | ❌ ${failed}`,
      `Duration: ${minutes}min`,
    ].join('\n');
    await this.send(message, { level: failed > 0 ? 'warning' : 'success' });
  }

  // ==================== Phase 2: Additional Notifications ====================

  /**
   * Send PR created notification
   */
  async notifyPRCreated(sessionId: string, prNumber: number, prUrl: string): Promise<void> {
    const message = [
      '📋 *PR Created*',
      `Session: \`${sessionId}\``,
      `PR: #${prNumber}`,
      `[View PR](${prUrl})`,
    ].join('\n');
    await this.send(message, { level: 'success' });
  }

  /**
   * Send CI passed notification
   */
  async notifyCIPassed(sessionId: string, prNumber?: number): Promise<void> {
    const prText = prNumber ? `\nPR: #${prNumber}` : '';
    const message = [
      '✅ *CI Passed*',
      `Session: \`${sessionId}\`${prText}`,
      '',
      'Ready to merge!',
    ].join('\n');
    await this.send(message, { level: 'success' });
  }

  /**
   * Send CI failed notification
   */
  async notifyCIFailed(sessionId: string, prNumber?: number): Promise<void> {
    const prText = prNumber ? `\nPR: #${prNumber}` : '';
    const message = [
      '❌ *CI Failed*',
      `Session: \`${sessionId}\`${prText}`,
      '',
      'Check logs and send fix request.',
    ].join('\n');
    await this.send(message, { level: 'error' });
  }

  /**
   * Send review changes requested notification
   */
  async notifyReviewChangesRequested(sessionId: string, prNumber?: number): Promise<void> {
    const prText = prNumber ? `\nPR: #${prNumber}` : '';
    const message = [
      '👀 *Changes Requested*',
      `Session: \`${sessionId}\`${prText}`,
      '',
      'Please address the review comments.',
    ].join('\n');
    await this.send(message, { level: 'warning' });
  }

  /**
   * Send PR merged notification
   */
  async notifyPRMerged(sessionId: string, prNumber: number): Promise<void> {
    const message = [
      '🎉 *PR Merged*',
      `Session: \`${sessionId}\``,
      `PR: #${prNumber}`,
      '',
      'Great work! 🎊',
    ].join('\n');
    await this.send(message, { level: 'success' });
  }

  /**
   * Send auto-fix started notification
   */
  async notifyAutoFixStarted(sessionId: string, attempt: number): Promise<void> {
    const message = [
      '🔧 *Auto-fix Attempt*',
      `Session: \`${sessionId}\``,
      `Attempt: ${attempt}`,
      '',
      'Retrying the fix...',
    ].join('\n');
    await this.send(message, { level: 'info' });
  }
}

// Default instance
export const telegram = new TelegramNotifier();

// Helper function for quick notifications with error handling
export async function notify(message: string, level: NotificationLevel = 'info'): Promise<void> {
  await withGracefulDegradation(
    async () => {
      await telegram.send(message, { level });
    },
    undefined,
    { operationName: 'notify', logError: true }
  );
}
