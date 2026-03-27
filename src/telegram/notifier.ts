import { ConfigLoader } from '../config';
import { SessionMetadata } from '../session/manager';

export interface TelegramButton {
  label: string;
  value: string;
  style?: 'primary' | 'secondary' | 'success' | 'danger';
}

export interface TelegramMessage {
  text: string;
  buttons?: TelegramButton[];
}

export class TelegramNotifier {
  private configLoader: ConfigLoader;
  private chatId?: string;

  constructor(configLoader?: ConfigLoader) {
    this.configLoader = configLoader || new ConfigLoader();
    this.chatId = this.configLoader.getTelegramChatId();
  }

  isEnabled(): boolean {
    return this.configLoader.isTelegramEnabled() && !!this.chatId;
  }

  async send(message: TelegramMessage): Promise<void> {
    if (!this.isEnabled()) {
      console.log('[Telegram] Disabled, skipping notification:', message.text);
      return;
    }

    const { message: messageTool } = await import('../../../index.js' as any);
    
    // Convert buttons to OpenClaw format
    const buttonRows = message.buttons ? 
      message.buttons.map(btn => ({
        text: btn.label,
        callback_data: btn.value,
      })) : [];

    await messageTool({
      action: 'send',
      target: this.chatId,
      text: message.text,
      buttons: [buttonRows],
    });
  }

  async sendSessionSpawned(session: SessionMetadata): Promise<void> {
    const message = `🚀 **Session ${session.id} spawned**
Branch: \`${session.branch}\`
Worktree: \`${session.worktreePath}\`

[View Status] [View Branch]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'View Status', value: `status:${session.id}`, style: 'primary' },
        { label: 'View Branch', value: `branch:${session.branch}`, style: 'secondary' },
      ],
    });
  }

  async sendPRCreated(session: SessionMetadata, prUrl: string): Promise<void> {
    if (!session.pr) return;

    const message = `📋 **PR #${session.pr.number} opened** by ${session.id}
Branch: \`${session.branch}\`
Status: ${session.pr.state === 'open' ? '✅ Open' : '❌ ' + session.pr.state}

[View PR] [Request Review] [Check CI]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'View PR', value: `pr:${session.pr.number}`, style: 'primary' },
        { label: 'Check CI', value: `ci:${session.id}`, style: 'secondary' },
      ],
    });
  }

  async sendCIFailed(session: SessionMetadata, error?: string): Promise<void> {
    const message = `❌ **CI Failed** on ${session.id}
Branch: \`${session.branch}\`
${error ? `Error: ${error}` : ''}

[View Logs] [Send Fix Request] [Kill Session]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'View Logs', value: `logs:${session.id}`, style: 'secondary' },
        { label: 'Send Fix Request', value: `fix:${session.id}`, style: 'primary' },
        { label: 'Kill Session', value: `kill:${session.id}`, style: 'danger' },
      ],
    });
  }

  async sendCIPassed(session: SessionMetadata): Promise<void> {
    const message = `✅ **CI Passed** on ${session.id}
Branch: \`${session.branch}\`

[Request Review] [View PR] [Merge]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'Request Review', value: `review:${session.id}`, style: 'primary' },
        { label: 'View PR', value: `pr:${session.pr?.number}`, style: 'secondary' },
      ],
    });
  }

  async sendReviewRequested(session: SessionMetadata): Promise<void> {
    if (!session.pr) return;

    const message = `👀 **Review Requested** on PR #${session.pr.number}
Branch: \`${session.branch}\`

[View PR] [Check Status]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'View PR', value: `pr:${session.pr.number}`, style: 'primary' },
        { label: 'Check Status', value: `status:${session.id}`, style: 'secondary' },
      ],
    });
  }

  async sendChangesRequested(session: SessionMetadata): Promise<void> {
    if (!session.pr) return;

    const message = `⚠️ **Changes Requested** on PR #${session.pr.number}
Branch: \`${session.branch}\`

[View Comment] [Notify Agent] [Dismiss]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'View Comment', value: `comment:${session.pr.number}`, style: 'primary' },
        { label: 'Notify Agent', value: `notify:${session.id}`, style: 'secondary' },
      ],
    });
  }

  async sendApproved(session: SessionMetadata): Promise<void> {
    if (!session.pr) return;

    const message = `✅ **Approved!** PR #${session.pr.number} is ready to merge
Branch: \`${session.branch}\`

[Merge] [View PR]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'Merge', value: `merge:${session.id}`, style: 'success' },
        { label: 'View PR', value: `pr:${session.pr.number}`, style: 'secondary' },
      ],
    });
  }

  async sendSessionCompleted(session: SessionMetadata): Promise<void> {
    const message = `🎉 **Session ${session.id} completed**
Branch: \`${session.branch}\`
PR: #${session.pr?.number || 'N/A'}
CI Passes: ${session.metrics.ciPasses}
CI Failures: ${session.metrics.ciFailures}

[View PR] [View Logs]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'View PR', value: `pr:${session.pr?.number}`, style: 'primary' },
        { label: 'View Logs', value: `logs:${session.id}`, style: 'secondary' },
      ],
    });
  }

  async sendSessionKilled(session: SessionMetadata): Promise<void> {
    const message = `🛑 **Session ${session.id} killed**
Branch: \`${session.branch}\`

[Start New] [View Logs]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'Start New', value: 'spawn', style: 'primary' },
        { label: 'View Logs', value: `logs:${session.id}`, style: 'secondary' },
      ],
    });
  }

  async sendError(sessionId: string, error: string): Promise<void> {
    const message = `🚨 **Error** in session ${sessionId}
${error}

[View Logs] [Retry] [Kill]`;

    await this.send({
      text: message,
      buttons: [
        { label: 'View Logs', value: `logs:${sessionId}`, style: 'secondary' },
        { label: 'Retry', value: `retry:${sessionId}`, style: 'primary' },
        { label: 'Kill', value: `kill:${sessionId}`, style: 'danger' },
      ],
    });
  }
}

export const telegramNotifier = new TelegramNotifier();