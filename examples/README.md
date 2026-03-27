# Rhaone Orchestrator Examples

This directory contains example configurations and scripts for common use cases.

## Directory Structure

```
examples/
├── README.md                 # This file
├── configs/                  # Example configuration files
│   ├── minimal.yaml         # Minimal configuration
│   ├── development.yaml     # Development workflow
│   ├── cicd.yaml           # CI/CD optimized
│   ├── multi-repo.yaml     # Multi-repository setup
│   ├── performance.yaml    # Performance optimized
│   └── enterprise.yaml     # Enterprise configuration
└── scripts/                 # Example scripts
    ├── basic/              # Basic usage examples
    ├── advanced/           # Advanced use cases
    └── custom/             # Custom integrations
```

## Quick Start

1. Copy a config file to your project:
   ```bash
   cp configs/minimal.yaml ~/.rhaone-orchestrator/config.yaml
   ```

2. Edit the config with your settings

3. Run an example script:
   ```bash
   npx tsx scripts/basic/spawn-issue.ts
   ```

## Configuration Examples

| Config | Use Case | Description |
|--------|----------|-------------|
| `minimal.yaml` | Getting Started | Bare minimum configuration |
| `development.yaml` | Local Dev | Development workflow with auto-PR |
| `cicd.yaml` | CI/CD | Optimized for continuous integration |
| `multi-repo.yaml` | Monorepo | Multiple repository management |
| `performance.yaml` | High Load | Performance-tuned settings |
| `enterprise.yaml` | Teams | Multi-user enterprise setup |

## Script Examples

### Basic
- `spawn-issue.ts` - Spawn a session for a single issue
- `list-sessions.ts` - List all active sessions
- `cleanup.ts` - Cleanup completed sessions

### Advanced
- `batch-spawn.ts` - Spawn multiple sessions in parallel
- `orchestrate-task.ts` - Use the orchestrator with task decomposition
- `learning-insights.ts` - Generate insights from session history
- `custom-reactions.ts` - Define custom CI/CD reactions

### Custom
- `webhook-server.ts` - Custom webhook integration
- `slack-integration.ts` - Slack notifications
- `discord-bot.ts` - Discord bot integration

## Environment Variables

All examples use environment variables for sensitive data:

```bash
# Required
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Optional
export TELEGRAM_BOT_TOKEN=your_bot_token
export TELEGRAM_CHAT_ID=your_chat_id
export RHAONE_DATA_DIR=~/.rhaone-orchestrator
```

## More Information

- [Full Documentation](../README.md)
- [API Reference](../docs/api.md)
- [Configuration Guide](../docs/configuration.md)
