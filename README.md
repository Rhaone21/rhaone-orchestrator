# Rhaone Orchestrator 🦞

> Multi-agent orchestration for autonomous development with Claude Code

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/your-org/rhaone-orchestrator)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

Rhaone Orchestrator is a sophisticated system for coordinating multiple AI agents (powered by Claude Code) to autonomously handle GitHub issues, run tests, create PRs, and manage the full development lifecycle.

## ✨ Features

### Phase 1: Core Infrastructure
- **Session Management** - Spawn, track, and manage multiple agent sessions
- **Configuration System** - Flexible YAML-based configuration with environment variable support
- **Git Worktree Handler** - Isolated branch management for parallel issue resolution

### Phase 2: Lifecycle Management
- **GitHub Integration** - Automatic issue tracking, PR creation, and status updates
- **CI/CD Monitoring** - Real-time workflow status polling with auto-merge support
- **Telegram Notifications** - Rich notifications for session events and mentions

### Phase 3: Learning & Insights
- **Learning Engine** - Pattern recognition from session history
- **Metrics Collector** - Track session lifecycle, CI events, code changes
- **Pattern Analyzer** - Identify success/failure patterns by project/task/agent
- **Recommendation Engine** - Actionable recommendations based on historical data
- **Insights Generator** - Comprehensive reports with Telegram integration

### Phase 4: Task Intelligence
- **Task Decomposition** - Break complex issues into manageable subtasks with parallelization support
- **Dependency Resolution** - Intelligent task ordering based on cross-issue dependencies
- **Resource Management** - Optimal resource allocation with concurrency limits and memory tracking
- **Batch Spawner** - Handle multiple related issues in parallel with configurable concurrency
- **Orchestrator** - Main coordination layer for Phase 4 task intelligence

### Phase 5: Polish & Optimization
- **Performance Optimization** - LRU caching, adaptive polling, intelligent batching
- **Error Handling** - Comprehensive retry logic with exponential backoff and graceful degradation
- **Complete Documentation** - API docs, examples, and troubleshooting guides

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Claude Code CLI (`npx -y @anthropic-ai/claude-code`)
- Git
- GitHub Personal Access Token
- (Optional) Telegram Bot Token

### Installation

```bash
# Install globally
npm install -g rhaone-orchestrator

# Or install locally
npm install rhaone-orchestrator
```

### Configuration

Create a config file at `~/.rhaone-orchestrator/config.yaml`:

```yaml
# Minimal configuration
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
```

### Usage

#### CLI Commands

```bash
# Initialize configuration
rhaone init

# Spawn a session for an issue
rhaone spawn 123

# List all sessions
rhaone list

# Get session status
rhaone status session-abc123

# Cleanup a session
rhaone kill session-abc123

# Get insights
rhaone insights

# Batch spawn multiple issues
rhaone batch 123 124 125
```

#### Programmatic Usage

```typescript
import { init, runTask, status, cleanupTask } from 'rhaone-orchestrator';

// Initialize the orchestrator
const ctx = await init();

// Run a task
const { sessionId, worktreePath } = await runTask('GH-123');

// Check status
const stats = await status(sessionId);

// Cleanup when done
await cleanupTask(sessionId);
```

## 📚 Documentation

- [Installation Guide](docs/installation.md) - Step-by-step installation instructions
- [Configuration Reference](docs/configuration.md) - Complete configuration options
- [API Documentation](docs/api.md) - Full API reference with examples
- [Examples](docs/examples.md) - Common use cases and recipes
- [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions
- [Architecture](docs/architecture.md) - System design and component details
- [Contributing](CONTRIBUTING.md) - How to contribute to the project

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Rhaone Orchestrator                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Session    │  │   Lifecycle   │  │    Task      │          │
│  │   Manager    │──│   Manager    │──│  Decomposer  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Orchestrator                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  GitHub API  │  │  CI Poller   │  │   Telegram   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Description | Phase |
|-----------|-------------|-------|
| **SessionManager** | Spawns, tracks, and manages Claude Code sessions | 1 |
| **LifecycleManager** | Handles events, notifications, and reactions | 2 |
| **CIPoller** | Monitors CI status with adaptive polling | 2/5 |
| **TaskDecomposer** | Breaks complex issues into parallelizable subtasks | 4 |
| **DependencyResolver** | Determines task execution order with cycle detection | 4 |
| **ResourceManager** | Manages memory, concurrency, and resource limits | 4 |
| **BatchSpawner** | Coordinates parallel task execution with rate limiting | 4 |
| **LearningEngine** | Pattern recognition and recommendations | 3 |
| **ErrorHandler** | Comprehensive error handling with recovery | 5 |
| **PerformanceOptimizer** | Caching and performance optimizations | 5 |

## ⚙️ Configuration

### Global Config

```yaml
# ~/.rhaone-orchestrator/config.yaml
github:
  owner: your-org
  repo: your-repo
  token: ${GITHUB_TOKEN}

git:
  mainBranch: main

session:
  defaultTimeout: 300
  defaultModel: claude-sonnet-4-20250514
  maxConcurrent: 5

telegram:
  token: ${TELEGRAM_BOT_TOKEN}
  chatId: ${TELEGRAM_CHAT_ID}

learning:
  enabled: true
  minSessionsForPattern: 5
```

## 📖 API Overview

### Session Management

```typescript
import { SessionManager, sessionManager } from 'rhaone-orchestrator';

const session = await sessionManager.spawn({
  projectId: 'my-project',
  issueId: 'GH-123',
  task: 'Fix the bug',
});
```

### Orchestrator (Phase 4)

```typescript
import { Orchestrator } from 'rhaone-orchestrator';

const orchestrator = new Orchestrator(sessionManager, {
  maxConcurrentAgents: 5,
  maxTotalAgents: 20,
});

const task = await orchestrator.orchestrateTask('GH-123', 'Fix complex bug', {
  decompose: true,
  execute: true,
  parallel: true,
});
```

### Learning Engine

```typescript
import { learningEngine } from 'rhaone-orchestrator';

learningEngine.recordSession({
  sessionId: 'session-123',
  issueId: 'GH-456',
  success: true,
  duration: 3600,
});

const report = learningEngine.getInsightsReport(7);
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Built with [Claude Code](https://claude.ai/code)
- Inspired by [OpenClaw](https://openclaw.io)
- Powered by [GitHub CLI](https://cli.github.com)

---

<p align="center">
  Made with ❤️ by the Rhaone team
</p>