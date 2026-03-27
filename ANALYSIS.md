# Composio Agent Orchestrator - Architecture Analysis

## Executive Summary

The Composio Agent Orchestrator (AO) is a sophisticated system for managing parallel AI coding agents. It provides a plugin-based architecture with 8 distinct slots, hash-based directory isolation, and a web dashboard for monitoring. This analysis covers its strengths, architectural patterns, and areas for improvement.

---

## 1. Core Architecture Overview

### 1.1 Plugin System (8 Slots)

The AO uses a modular plugin architecture with well-defined interfaces:

| Slot | Purpose | Default | Alternatives |
|------|---------|---------|--------------|
| **Runtime** | Where agents execute | tmux | docker, k8s, process |
| **Agent** | AI coding tool | claude-code | codex, aider, opencode |
| **Workspace** | Code isolation | worktree | clone |
| **Tracker** | Issue tracking | github | linear, jira |
| **SCM** | PR/CI/reviews | github | gitlab |
| **Notifier** | Human notifications | desktop | slack, openclaw, webhook |
| **Terminal** | Human interaction | iterm2 | web |
| **Lifecycle** | State machine | core | - |

### 1.2 Directory Structure

```
~/.agent-orchestrator/
  {hash}-{projectId}/           # Hash-based namespacing
    sessions/
      {prefix}-{num}            # Session metadata files
    worktrees/
      {prefix}-{num}/           # Git worktrees
    archive/
      {prefix}-{num}_{timestamp}
    .origin                     # Config path reference
```

**Hash Derivation:**
- SHA256 of config directory path (first 12 chars)
- Prevents collisions between different AO installations
- Projects from same config share the same hash prefix

### 1.3 Session Lifecycle

```
spawning → working → pr_open → [ci_failed/review_pending] → approved → mergeable → merged
    ↓           ↓         ↓              ↓
 needs_input  stuck   errored        killed/done
```

---

## 2. Key Components Deep Dive

### 2.1 Session Manager (`packages/core/src/session-manager.ts`)

**Responsibilities:**
- Spawn new sessions (workspace → runtime → agent)
- List sessions from metadata + live runtime checks
- Kill sessions (graceful cleanup chain)
- Send messages to running sessions
- Claim existing PRs for sessions

**Key Features:**
- OpenCode session ID discovery and remapping
- Session restoration for crashed/stopped sessions
- Duplicate detection for batch spawning
- Metadata-driven session persistence

### 2.2 Lifecycle Manager (`packages/core/src/lifecycle-manager.ts`)

**Responsibilities:**
- Poll sessions periodically for state changes
- Emit events on state transitions
- Execute reactions (auto-handlers)
- Escalate to human when auto-handling fails

**Reaction System:**
```typescript
interface ReactionConfig {
  auto: boolean;              // Enable/disable
  action: "send-to-agent" | "notify" | "auto-merge";
  retries?: number;           // Retry attempts before escalation
  escalateAfter?: string;     // Duration threshold (e.g., "30m")
}
```

### 2.3 Runtime Plugins

**Tmux Runtime (`packages/plugins/runtime-tmux`):**
- Creates detached tmux sessions
- Uses `load-buffer` + `paste-buffer` for long commands (>200 chars)
- Sends messages via `tmux send-keys`
- Captures output via `tmux capture-pane`

**Process Runtime (`packages/plugins/runtime-process`):**
- Direct child process spawning
- No terminal multiplexing
- Simpler but less interactive

### 2.4 Agent Plugins

**Claude Code Plugin (`packages/plugins/agent-claude-code`):**
- Post-launch prompt delivery (keeps interactive mode)
- JSONL session file introspection for activity detection
- Metadata updater hooks via PostToolUse
- Cost estimation from usage events
- Session restoration via `--resume`

**Activity Detection:**
- Polls JSONL files for last entry type
- Maps entry types to states: `active`, `ready`, `idle`, `waiting_input`, `blocked`
- Uses threshold-based idle detection (default: 5 minutes)

### 2.5 SCM Plugins

**GitHub SCM (`packages/plugins/scm-github`):**
- Uses `gh` CLI for all API interactions
- PR lifecycle: detect, resolve, checkout, merge, close
- CI tracking: individual checks + summary status
- Review tracking: comments, decisions, pending threads
- Webhook verification with HMAC signatures

### 2.6 Notifier Plugins

**OpenClaw Notifier (`packages/plugins/notifier-openclaw`):**
- POSTs to OpenClaw webhook (`/hooks/agent`)
- Session key format: `hook:ao:{session-id}`
- Supports wake modes: `now` | `next-heartbeat`
- Exponential backoff retry logic

---

## 3. Web Dashboard (`packages/web`)

### 3.1 Technology Stack
- Next.js 14+ with App Router
- Server-side rendering for dashboard
- WebSocket server for terminal access
- API routes for session management

### 3.2 Key Pages
- `/` - Main dashboard with session list
- `/sessions/[id]` - Session detail view
- `/api/sessions/*` - CRUD endpoints
- `/api/webhooks/*` - SCM webhook handlers

### 3.3 Features
- Real-time session status display
- PR/CI/review status enrichment
- Global pause functionality
- Orchestrator session management
- Terminal access via WebSocket

---

## 4. CLI (`packages/cli`)

### 4.1 Core Commands
```bash
ao start [repo-url]      # Initialize and start dashboard
ao spawn [issue]         # Spawn agent session
ao kill <session>        # Terminate session
ao send <session>        # Send message to session
ao list                  # List all sessions
ao status                # Show orchestrator status
```

### 4.2 Configuration
YAML-based config (`agent-orchestrator.yaml`):
```yaml
projects:
  my-app:
    repo: owner/repo
    path: ~/repos/my-app
    defaultBranch: main
    sessionPrefix: app

reactions:
  ci-failed:
    auto: true
    action: send-to-agent
    retries: 2
```

---

## 5. Strengths

### 5.1 Architecture Strengths
1. **Clean Plugin Abstractions** - Well-defined TypeScript interfaces for each slot
2. **Hash-Based Namespacing** - Prevents collisions, enables multi-instance
3. **Metadata-Driven State** - Simple key=value files, easy to debug
4. **Agent-Agnostic** - Works with Claude, Codex, Aider, OpenCode
5. **Runtime-Agnostic** - tmux, Docker, process all supported
6. **Reaction System** - Configurable auto-handlers with escalation
7. **Session Restoration** - Can resume crashed sessions

### 5.2 Implementation Strengths
1. **Activity Detection** - JSONL introspection vs terminal parsing
2. **Cost Tracking** - Token/cost extraction from agent logs
3. **Metadata Hooks** - Auto-update on git/gh commands
4. **Workspace Isolation** - Git worktrees per session
5. **Batch Operations** - Efficient duplicate detection
6. **Observability** - Correlation IDs, health metrics

### 5.3 Integration Strengths
1. **OpenClaw Native** - First-class notifier plugin
2. **GitHub Deep Integration** - PRs, CI, reviews, webhooks
3. **Linear Support** - Issue tracking alternative
4. **Webhook Events** - Extensible SCM event handling

---

## 6. Gaps and Limitations

### 6.1 Architectural Gaps

1. **Complexity Overhead**
   - 8 plugin slots create cognitive load
   - Many abstractions for simple use cases
   - Plugin discovery and loading overhead

2. **Runtime Dependencies**
   - Requires tmux (or Docker) for isolation
   - Additional process management layer
   - Tmux session name collisions possible

3. **State Management**
   - File-based metadata has race conditions
   - No distributed state for multi-host
   - Polling-based lifecycle (not event-driven)

4. **Agent Coupling**
   - Agent plugins need deep integration
   - JSONL parsing is agent-specific
   - Activity detection varies by agent

### 6.2 Operational Gaps

1. **Learning/Memory**
   - No agent performance tracking
   - No historical pattern analysis
   - Static reaction configs (no ML)

2. **Notification Limitations**
   - Desktop notifications are local-only
   - Slack requires additional setup
   - No Telegram support

3. **Dashboard Complexity**
   - Full Next.js app is heavy
   - Requires separate build process
   - WebSocket server adds complexity

4. **GitHub Integration Gaps**
   - No direct PR/issue creation from CLI
   - Limited review comment handling
   - No automatic reviewer assignment

### 6.3 Technical Debt

1. **File-Based Race Conditions**
   - Concurrent metadata writes possible
   - No atomic operations
   - Lock-free design has edge cases

2. **Polling Overhead**
   - Lifecycle manager polls every N seconds
   - Wasted cycles when idle
   - Delayed reaction to events

3. **Tmux Coupling**
   - Many features assume tmux
   - Process runtime is second-class
   - Terminal handling is tmux-centric

---

## 7. Key Insights for Rhaone Orchestrator

### 7.1 What to Keep
1. Hash-based directory structure (collision prevention)
2. Session lifecycle model (comprehensive states)
3. Reaction system pattern (auto-handlers + escalation)
4. OpenClaw webhook integration (bidirectional)
5. Metadata-driven persistence (simple, debuggable)

### 7.2 What to Simplify
1. Reduce from 8 plugin slots to 4 core abstractions
2. Replace tmux with OpenClaw `sessions_spawn`
3. Remove web dashboard (use Telegram + CLI)
4. Consolidate agent plugins (focus on Claude Code)
5. Inline SCM/Tracker (GitHub-only, no abstraction)

### 7.3 What to Add
1. Agent performance tracking and learning
2. Telegram-first notifications
3. GitHub PR/issue creation from CLI
4. Agent capability registry
5. Task decomposition with lineage tracking

### 7.4 OpenClaw Integration Opportunities

**Current AO Approach:**
- AO spawns agents in tmux sessions
- AO polls for state changes
- AO sends webhook to OpenClaw on escalation
- Human uses `ao` CLI to interact

**Rhaone Opportunity:**
- Use OpenClaw `sessions_spawn` instead of tmux
- OpenClaw manages agent lifecycle
- Direct Telegram notifications (no webhook needed)
- Human replies in Telegram to control agents
- Agent performance tracked in memory files