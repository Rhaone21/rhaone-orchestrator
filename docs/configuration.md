# Configuration Reference

Complete reference for Rhaone Orchestrator configuration options.

## Configuration Files

### Global Config

Location: `~/.rhaone-orchestrator/config.yaml`

This file contains your global settings that apply to all projects.

### Project Config

Location: `config.yaml` in project root

Project-specific settings override global settings.

## Configuration Schema

### `github` (Required)

GitHub integration settings.

```yaml
github:
  owner: string              # GitHub organization or user
  repo: string               # Repository name
  token: string              # GitHub Personal Access Token
```

**Token Permissions Required:**
- `repo` - Full repository access
- `workflow` - Access GitHub Actions
- `read:org` - Read organization data (if applicable)

### `git`

Git and worktree configuration.

```yaml
git:
  mainBranch: string         # Default branch (default: main)
  worktreesDir: string       # Worktree directory (default: ~/.rhaone-orchestrator/worktrees)
```

### `session`

Session management defaults.

```yaml
session:
  defaultTimeout: number     # Default timeout in minutes (default: 300)
  defaultModel: string       # Default Claude model (default: claude-sonnet-4-20250514)
  maxConcurrent: number      # Max concurrent sessions (default: 5)
```

### `telegram`

Telegram notification settings.

```yaml
telegram:
  token: string              # Bot token from @BotFather
  chatId: string             # Chat ID for notifications
```

**Getting Chat ID:**
1. Message @userinfobot
2. Or use: `curl https://api.telegram.org/bot<TOKEN>/getUpdates`

### `learning`

Learning engine configuration.

```yaml
learning:
  enabled: boolean                    # Enable learning (default: true)
  minSessionsForPattern: number       # Min sessions for pattern detection (default: 5)
  minSessionsForRecommendation: number # Min sessions for recommendations (default: 3)
  storagePath: string                 # Metrics storage path
```

### `reactions`

Automated reactions to events.

```yaml
reactions:
  ciFailed:
    enabled: boolean         # Enable reaction (default: true)
    action: string           # Action: notify | auto_fix | kill
    autoRetry: boolean       # Auto-retry on failure (default: true)
    maxRetries: number       # Max retry attempts (default: 3)
  
  ciPassed:
    enabled: boolean
    action: string           # Action: notify | auto_merge
  
  reviewApproved:
    enabled: boolean
    action: string           # Action: notify | auto_merge
  
  reviewChangesRequested:
    enabled: boolean
    action: string           # Action: notify | auto_fix
```

### `performance`

Performance optimization settings.

```yaml
performance:
  cacheEnabled: boolean      # Enable caching (default: true)
  cacheTTL: number           # Cache TTL in milliseconds (default: 30000)
  adaptivePolling: boolean   # Enable adaptive polling (default: true)
  minPollInterval: number    # Minimum poll interval in ms (default: 10000)
  maxPollInterval: number    # Maximum poll interval in ms (default: 300000)
  maxCacheSize: number       # Maximum cache entries (default: 1000)
  maxMemoryMB: number        # Maximum cache memory in MB (default: 100)
```

### `errorHandling`

Error handling and recovery settings.

```yaml
errorHandling:
  maxRetries: number         # Default max retries (default: 3)
  backoffMs: number          # Initial backoff in ms (default: 1000)
  backoffMultiplier: number  # Backoff multiplier (default: 2)
  maxBackoffMs: number       # Maximum backoff in ms (default: 30000)
  maxErrorHistory: number    # Max error records to keep (default: 100)
```

### `agents`

Agent-specific configuration.

```yaml
agents:
  kimi:
    permissions: string      # Agent permissions: full | read-only
    model: string            # Model override
    timeout: number          # Timeout override
  
  claude:
    permissions: full
    model: claude-opus-4-20250514
```

### `projects` (Multi-repo)

For multi-repository setups.

```yaml
projects:
  - name: string             # Project name
    repo: string             # Full repo path (owner/repo)
    path: string             # Local path
    defaultBranch: string    # Default branch
    agents:                  # Project-specific agents
      kimi:
        permissions: full
```

## Environment Variables

All config values can use environment variable substitution:

```yaml
github:
  token: ${GITHUB_TOKEN}
  token: ${GITHUB_TOKEN:-fallback_value}  # With fallback
```

**Available Variables:**

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID |
| `HOME` | User home directory |
| `RHAONE_CONFIG_DIR` | Config directory override |

## Example Configurations

### Minimal

```yaml
github:
  owner: my-org
  repo: my-repo
  token: ${GITHUB_TOKEN}
```

### Full-Featured

```yaml
github:
  owner: my-org
  repo: my-repo
  token: ${GITHUB_TOKEN}

git:
  mainBranch: main
  worktreesDir: /data/worktrees

session:
  defaultTimeout: 300
  defaultModel: claude-sonnet-4-20250514
  maxConcurrent: 10

telegram:
  token: ${TELEGRAM_BOT_TOKEN}
  chatId: ${TELEGRAM_CHAT_ID}

learning:
  enabled: true
  minSessionsForPattern: 5
  minSessionsForRecommendation: 3

reactions:
  ciFailed:
    enabled: true
    action: auto_fix
    autoRetry: true
    maxRetries: 3
  ciPassed:
    enabled: true
    action: auto_merge
  reviewApproved:
    enabled: true
    action: auto_merge

performance:
  cacheEnabled: true
  cacheTTL: 30000
  adaptivePolling: true
  minPollInterval: 5000
  maxPollInterval: 60000

errorHandling:
  maxRetries: 3
  backoffMs: 1000
  backoffMultiplier: 2
  maxBackoffMs: 30000

agents:
  kimi:
    permissions: full
    model: claude-sonnet-4-20250514
  claude:
    permissions: full
    model: claude-opus-4-20250514
```

### CI/CD Optimized

```yaml
github:
  owner: my-org
  repo: my-repo
  token: ${GITHUB_TOKEN}

git:
  mainBranch: main
  worktreesDir: /tmp/rhaone-worktrees

session:
  defaultTimeout: 60
  maxConcurrent: 20

reactions:
  ciFailed:
    enabled: true
    action: auto_fix
    autoRetry: true
    maxRetries: 5
  ciPassed:
    enabled: true
    action: auto_merge

performance:
  adaptivePolling: true
  minPollInterval: 5000
  maxPollInterval: 30000
  cacheTTL: 15000
```

## Validation

Validate your configuration:

```bash
rhaone config validate

# Or with verbose output
rhaone config validate --verbose
```

## Configuration Precedence

Settings are applied in this order (later overrides earlier):

1. Default values
2. Global config (`~/.rhaone-orchestrator/config.yaml`)
3. Project config (`./config.yaml`)
4. Environment variables
5. CLI flags

## Migration

### From v0.x to v1.0

```bash
# Backup old config
cp ~/.rhaone-orchestrator/config.yaml ~/.rhaone-orchestrator/config.yaml.bak

# Run migration
rhaone config migrate

# Validate
rhaone config validate
```
