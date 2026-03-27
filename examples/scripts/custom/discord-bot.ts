/**
 * Custom Example: Discord Bot Integration
 *
 * This example demonstrates how to create a Discord bot that
 * interacts with the Rhaone Orchestrator.
 */

import { init, runTask, status, cleanupTask } from 'rhaone-orchestrator';

// Discord bot token (configure at https://discord.com/developers/applications)
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Simple Discord API wrapper
class DiscordClient {
  private token: string;
  private baseUrl = 'https://discord.com/api/v10';

  constructor(token: string) {
    this.token = token;
  }

  async sendMessage(channelId: string, content: string, embeds?: any[]) {
    const response = await fetch(`${this.baseUrl}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        embeds,
      }),
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }

    return await response.json();
  }

  async createSlashCommand(command: any) {
    // In production, register commands with Discord
    console.log('   📋 Registering command:', command.name);
  }
}

async function main() {
  console.log(`🦞 Rhaone Orchestrator - Discord Bot Example`);
  console.log(`=============================================`);

  try {
    // Initialize the orchestrator
    console.log('\n📦 Initializing orchestrator...');
    init({
      github: {
        owner: process.env.GITHUB_OWNER || 'your-org',
        repo: process.env.GITHUB_REPO || 'your-repo',
        token: process.env.GITHUB_TOKEN,
      },
    });

    console.log('\n🤖 Discord Bot Setup');
    console.log('='.repeat(50));

    if (!DISCORD_TOKEN) {
      console.log('\n⚠️  DISCORD_TOKEN not set');
      console.log('   Set it with: export DISCORD_TOKEN=your_bot_token');
      console.log('\n💡 To create a bot:');
      console.log('   1. Go to https://discord.com/developers/applications');
      console.log('   2. New Application → Bot');
      console.log('   3. Enable MESSAGE CONTENT INTENT');
      console.log('   4. Copy the token');
      console.log('   5. Invite bot to your server');
    } else {
      console.log('\n✅ Discord token configured');
      const discord = new DiscordClient(DISCORD_TOKEN);

      // Example commands that could be registered
      const commands = [
        {
          name: 'spawn',
          description: 'Spawn a session for an issue',
          options: [
            {
              name: 'issue',
              description: 'Issue number',
              type: 4, // INTEGER
              required: true,
            },
          ],
        },
        {
          name: 'status',
          description: 'Get orchestrator status',
        },
        {
          name: 'list',
          description: 'List active sessions',
        },
        {
          name: 'cleanup',
          description: 'Cleanup a session',
          options: [
            {
              name: 'session',
              description: 'Session ID',
              type: 3, // STRING
              required: true,
            },
          ],
        },
      ];

      console.log('\n📋 Available Commands:');
      for (const cmd of commands) {
        console.log(`   /${cmd.name} - ${cmd.description}`);
      }

      // Simulate command handling
      console.log('\n🎮 Simulating command interactions...\n');

      // Simulate /spawn command
      console.log('💬 /spawn issue: 123');
      try {
        const result = await runTask('GH-123', 'Fix issue #123');
        console.log(`   ✅ Session spawned: ${result.sessionId}`);

        if (DISCORD_CHANNEL_ID) {
          await discord.sendMessage(
            DISCORD_CHANNEL_ID,
            '',
            [{
              title: '🚀 Session Spawned',
              description: `Session for issue #123 has been created`,
              fields: [
                { name: 'Session ID', value: result.sessionId, inline: true },
                { name: 'Branch', value: result.branch, inline: true },
                { name: 'Status', value: result.status, inline: true },
              ],
              color: 0x00ff00,
              timestamp: new Date().toISOString(),
            }]
          );
          console.log('   📨 Discord notification sent');
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error}`);
      }

      // Simulate /status command
      console.log('\n💬 /status');
      const currentStatus = status();
      console.log(`   📊 Initialized: ${currentStatus.initialized}`);
      console.log(`   📊 Sessions: ${currentStatus.sessions.total} total`);
      console.log(`      - Active: ${currentStatus.sessions.active}`);
      console.log(`      - Pending: ${currentStatus.sessions.pending}`);
      console.log(`      - Completed: ${currentStatus.sessions.completed}`);

      // Simulate /list command
      console.log('\n💬 /list');
      console.log('   📋 Active sessions:');
      // Would list sessions here

      console.log('\n✅ Discord bot commands simulated');
    }

    console.log('\n📋 Implementation Notes:');
    console.log('   To run a real Discord bot:');
    console.log('   1. Use discord.js library for full bot functionality');
    console.log('   2. Set up a persistent connection to Discord Gateway');
    console.log('   3. Handle rate limits and reconnections');
    console.log('   4. Implement proper error handling');

    console.log('\n✅ Discord bot example complete!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
