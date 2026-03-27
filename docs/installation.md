# Installation Guide

This guide covers installing and configuring Rhaone Orchestrator.

## Prerequisites

### Required

- **Node.js 20+** - [Download here](https://nodejs.org)
- **Git** - [Download here](https://git-scm.com)
- **GitHub Personal Access Token** - [Create here](https://github.com/settings/tokens)

### Optional

- **Claude Code CLI** - Install with `npm install -g @anthropic-ai/claude-code`
- **Telegram Bot Token** - Create with [@BotFather](https://t.me/botfather)

## Installation Methods

### Method 1: NPM (Recommended)

```bash
# Install globally
npm install -g rhaone-orchestrator

# Verify installation
rhaone --version
```

### Method 2: From Source

```bash
# Clone repository
git clone https://github.com/your-org/rhaone-orchestrator.git
cd rhaone-orchestrator

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional)
npm link
```

### Method 3: Docker

```bash
# Pull image
docker pull rhaone/orchestrator:latest

# Run
docker run -v ~/.rhaone-orchestrator:/config rhaone/orchestrator
```

## Configuration

### Step 1: Create Config Directory

```bash
mkdir -p ~/.rhaone-orchestrator
```

### Step 2: Create Config File

```bash
cat > ~/.rhaone-orchestrator/config.yaml << 'EOF'
github:
  owner: your-org
  repo: your-repo
  token: ${GITHUB_TOKEN}

git:
  mainBranch: main

session:
  defaultTimeout: 300
  defaultModel: claude-sonnet-4-20250514

telegram:
  token: ${TELEGRAM_BOT_TOKEN}
  chatId: ${TELEGRAM_CHAT_ID}

learning:
  enabled: true
  minSessionsForPattern: 5
EOF
```

### Step 3: Set Environment Variables

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
export TELEGRAM_CHAT_ID="123456789"
```

Reload your shell:

```bash
source ~/.bashrc  # or ~/.zshrc
```

### Step 4: Initialize

```bash
rhaone init
```

## Verification

```bash
# Check version
rhaone --version

# List sessions (should be empty)
rhaone list

# Test GitHub connection
rhaone test github

# Test Telegram (if configured)
rhaone test telegram
```

## Troubleshooting Installation

### Permission Denied

```bash
# Fix npm permissions
sudo chown -R $(whoami) ~/.npm
```

### Module Not Found

```bash
# Rebuild native modules
npm rebuild
```

### GitHub Token Issues

```bash
# Test token
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

## Next Steps

- Read the [Configuration Reference](configuration.md)
- Check out [Examples](examples.md)
- Review [API Documentation](api.md)
