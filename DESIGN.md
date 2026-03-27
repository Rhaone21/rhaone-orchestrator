# Rhaone Orchestrator - Design Document

## Executive Summary

Rhaone Orchestrator is a simplified, OpenClaw-native agent orchestration system. It eliminates the complexity of tmux/Docker runtimes and web dashboards, replacing them with OpenClaw's built-in `sessions_spawn` capability. The design prioritizes:

1. **Simplicity**: 4 core abstractions instead of 8 plugin slots
2. **OpenClaw Integration**: Native use of `sessions_spawn`, `message`, and `exec` tools
3. **Telegram-First**: All notifications and human interaction via Telegram
4. **Learning**: Agent performance tracking and pattern recognition

---

## 1. Core Philosophy

### 1.1 Convention Over Configuration
- Auto-derive session names from project + issue
- Standard directory structure (no configuration needed)
- Sensible defaults for all settings

### 1.2 OpenClaw as the Runtime
Instead of managing tmux/Docker sessions, Rhaone uses OpenClaw's session spawning:
```typescript
// Instead of: tmux new-session -d -s {name}
// Use: sessions_spawn({ agent: "kimi", task: "..." })
```

### 1.3 Telegram as the Dashboard
- Real-time status updates via Telegram messages
- Interactive controls via reply buttons
- No web server required

---

## 2. Architecture Overview

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Rhaone Orchestrator                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Session    │  │   Lifecycle  │  │   Learning   │      │
│  │   Manager    │──│   Manager    │──│   Engine     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                 │                 │               │
│         ▼                 ▼                 ▼               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              OpenClaw Integration Layer               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │  │
│  │  │ sessions │  │ message  │  │  exec (ao CLI)   │   │  │
│  │  │ _spawn   │  │ (notify) │  │  (control)       │   │  │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                 │
│                           ▼                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    GitHub Layer                       │  │
│  │         (PRs, Issues, CI, Reviews via gh CLI)        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Simplified Abstractions (4 vs 8)

| AO Slot | Rhaone Abstraction | Notes |
|---------|-------------------|-------|
| Runtime + Terminal | **OpenClaw Sessions** | Native spawning, no tmux |
| Agent | **Agent Config** | Claude Code focused, extensible |
| Workspace | **Git Worktree** | Direct implementation, no plugin |
| Tracker + SCM | **GitHub Integration** | Combined, gh CLI based |
| Notifier | **Telegram Messages** | Native OpenClaw messaging |
| Lifecycle | **Event Handlers** | Simplified reaction system |

---

## 3. Directory Structure

```
~/.rhaone-orchestrator/
├── config.yaml                    # Global configuration
├── memory/
│   └── agent-performance.json     # Agent learning data
├── projects/
│   └── {project-id}/
│       ├── config.yaml            # Project-specific config
│       ├── sessions/
│       │   └── {session-id}.json  # Session metadata
│       └── worktrees/
│           └── {session-id}/      # Git worktrees
└── logs/
    └── {date}.log                 # Daily operation logs
```

### 3.1 Session Metadata Format

```json
{
  "id": "myapp-1",
  "projectId": "myapp",
  "issueId": "GH-123",
  "branch": "feat/GH-123",
  "status": "working",
  "openclawSessionId": "agent:kimi:subagent:xxx",
  "pr": {
    "number": 456,
    "url": "https://github.com/owner/repo/pull/456",
    "state": "open"
  },
  "createdAt": "2026-03-24T08:30:00Z",
  "lastActivityAt": "2026-03-24T09:15:00Z",
  "metrics": {
    "spawnDuration": 45,
    "prOpenDuration": 1800,
    "ciPasses": 2,
    "ciFailures": 1
  }
}
```

---

## 4. Core Components

### 4.1 Session Manager

**Responsibilities:**
- Spawn agent sessions via `sessions_spawn`
- Track session metadata
- Map OpenClaw sessions to Rhaone sessions
- Handle session restoration

**Key Methods:**
```typescript
interface SessionManager {
  spawn(config: SpawnConfig): Promise<Session>;
  list(projectId?: string): Session[];
  get(sessionId: string): Session | null;
  kill(sessionId: string): Promise<void>;
  send(sessionId: string, message: string): Promise<void>;
  restore(sessionId: string): Promise<Session>;
}
```

**Spawn Flow:**
1. Create git worktree for the issue
2. Build agent prompt with context
3. Call `sessions_spawn` with agent config
4. Store mapping: Rhaone session ID → OpenClaw session ID
5. Start lifecycle monitoring

### 4.2 Lifecycle Manager

**Responsibilities:**
- Poll GitHub for PR/CI/review changes
- Emit events on state transitions
- Execute reactions
- Send Telegram notifications

**Event Types:**
```typescript
type EventType =
  | "session.spawned"
  | "session.working"
  | "pr.created"
  | "ci.passed"
  | "ci.failed"
  | "review.approved"
  | "review.changes_requested"
  | "session.stuck"
  | "session.completed";
```

**Reaction System:**
```typescript
interface Reaction {
  event: EventType;
  action: "notify" | "send-to-agent" | "auto-retry";
  telegram?: {
    message: string;
    buttons?: Button[];
  };
  message?: string;  // For send-to-agent
}
```

### 4.3 GitHub Integration

**Combined Tracker + SCM:**
- Uses `gh` CLI for all operations
- No abstraction layer (GitHub-only)
- Caches PR data to reduce API calls

**Key Operations:**
```typescript
interface GitHubIntegration {
  getIssue(issueId: string): Issue;
  createBranch(issueId: string): string;
  detectPR(branch: string): PR | null;
  getCIStatus(pr: PR): CIStatus;
  getReviews(pr: PR): Review[];
  mergePR(pr: PR): void;
  createIssue(title: string, body: string): Issue;
}
```

### 4.4 Learning Engine

**Responsibilities:**
- Track agent performance metrics
- Analyze success/failure patterns
- Provide recommendations
- Improve reaction configs over time

**Tracked Metrics:**
```typescript
interface AgentMetrics {
  agentType: string;
  taskType: string;
  successRate: number;
  avgTimeToPR: number;
  avgCIRetries: number;
  commonFailures: string[];
  optimalStrategies: Strategy[];
}
```

---

## 5. OpenClaw Integration

### 5.1 Session Spawning

Instead of tmux, use OpenClaw's native spawning:

```typescript
// rhaone spawn GH-123
const result = await sessions_spawn({
  agent: "kimi",
  task: buildPrompt(issue),
  workdir: worktreePath,
  env: {
    GITHUB_TOKEN: "...",
    RHONE_SESSION_ID: "myapp-1",
    RHONE_PROJECT_ID: "myapp"
  }
});

// Store mapping
sessionMetadata.openclawSessionId = result.sessionId;
```

### 5.2 Telegram Notifications

Use OpenClaw's `message` tool for all notifications:

```typescript
// Send status update
await message({
  action: "send",
  text: `📋 Session myapp-1 opened PR #456`,
  buttons: [
    { label: "View PR", value: "pr:456" },
    { label: "Check Status", value: "status:myapp-1" }
  ]
});
```

### 5.3 Human Control

Human replies in Telegram trigger actions:

```typescript
// Human clicks "Retry CI"
if (message.text === "retry:myapp-1") {
  await sessionManager.send("myapp-1", "The CI failed. Please fix the errors and retry.");
}
```

### 5.4 Session Monitoring

OpenClaw's built-in session management provides:
- Automatic session lifecycle tracking
- Output capture and logging
- Crash detection
- Resource limits

Rhaone maps these to its own session model:

```typescript
// Poll OpenClaw for session status
const openclawStatus = await sessions_list({
  filter: `rhaone:${sessionId}`
});

// Map to Rhaone status
if (openclawStatus.state === "completed") {
  rhaoneSession.status = "done";
} else if (openclawStatus.state === "failed") {
  rhaoneSession.status = "errored";
}
```

---

## 6. Telegram Bot Interface

### 6.1 Commands

| Command | Description |
|---------|-------------|
| `/spawn <issue>` | Spawn agent for issue |
| `/list` | List active sessions |
| `/status <session>` | Show session status |
| `/kill <session>` | Terminate session |
| `/send <session> <msg>` | Send message to agent |
| `/pr <session>` | Show PR status |
| `/merge <session>` | Merge PR when ready |
| `/learn` | Show agent performance |

### 6.2 Interactive Messages

**Session Started:**
```
🚀 Session myapp-1 spawned for GH-123
Branch: feat/GH-123-fix-login

[View Issue] [Check Status] [Send Message]
```

**PR Created:**
```
📋 PR #456 opened by myapp-1
Title: Fix login authentication
Status: ✅ CI Passing

[View PR] [Request Review] [Merge]
```

**CI Failed:**
```
❌ CI Failed on myapp-1
Error: Type mismatch in auth.ts

[View Logs] [Send Fix Request] [Kill Session]
```

**Review Requested:**
```
👀 Changes requested on PR #456
Comment: Please add error handling

[View Comment] [Notify Agent] [Dismiss]
```

---

## 7. Learning System

### 7.1 Data Collection

Track metrics for each session:
```typescript
interface SessionMetrics {
  sessionId: string;
  agentType: string;
  issueType: string;
  linesChanged: number;
  filesModified: number;
  timeToPR: number;
  ciRetries: number;
  reviewRounds: number;
  success: boolean;
  failureReason?: string;
}
```

### 7.2 Pattern Analysis

```typescript
// Analyze common failure patterns
const patterns = learningEngine.analyze({
  groupBy: "issueType",
  metric: "successRate",
  threshold: 0.5
});

// Result: "Authentication issues have 30% success rate"
```

### 7.3 Recommendations

```typescript
// Before spawning, get recommendation
const rec = learningEngine.recommend({
  issueType: "authentication",
  project: "myapp"
});

// Result:
// {
//   suggestedAgent: "claude-code",
//   estimatedTime: "45m",
//   confidence: 0.8,
//   tips: ["Add test cases early", "Check edge cases"]
// }
```

---

## 8. Configuration

### 8.1 Global Config

```yaml
# ~/.rhaone-orchestrator/config.yaml
defaults:
  agent: claude-code
  model: claude-sonnet-4-20250514
  
github:
  token: ${GITHUB_TOKEN}
  
telegram:
  chatId: ${TELEGRAM_CHAT_ID}
  
learning:
  enabled: true
  minSessionsForPattern: 5
```

### 8.2 Project Config

```yaml
# ~/.rhaone-orchestrator/projects/myapp/config.yaml
project:
  name: My Application
  repo: owner/myapp
  path: ~/repos/myapp
  defaultBranch: main
  
agents:
  claude-code:
    permissions: auto-edit
    model: claude-sonnet-4-20250514
    
reactions:
  ci-failed:
    action: notify
    autoRetry: true
    maxRetries: 3
    
  review-approved:
    action: auto-merge
    requireCI: true
```

---

## 9. Comparison: AO vs Rhaone

| Aspect | Composio AO | Rhaone |
|--------|-------------|--------|
| **Runtime** | tmux/Docker | OpenClaw sessions |
| **Dashboard** | Next.js web app | Telegram |
| **Notifications** | Desktop/Slack/Webhook | Telegram native |
| **Plugin Slots** | 8 | 4 (simplified) |
| **Agent Support** | Claude, Codex, Aider, OpenCode | Claude Code (extensible) |
| **Learning** | ❌ | ✅ |
| **Setup Complexity** | High | Low |
| **Dependencies** | tmux, Node, npm | OpenClaw only |
| **Multi-tenant** | Complex | Simple (via OpenClaw) |

---

## 10. Security Considerations

### 10.1 Session Isolation
- Each session gets its own git worktree
- Environment variables isolated per session
- No shared state between sessions

### 10.2 GitHub Token
- Stored in OpenClaw secure storage
- Passed via environment to spawned sessions
- Never logged or persisted to disk

### 10.3 Telegram Access
- Uses OpenClaw's built-in Telegram integration
- No separate bot token management
- Inherits OpenClaw's security model