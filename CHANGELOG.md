# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-25

### Added
- **Phase 2: Lifecycle Management**

#### GitHub Integration (`src/lib/github.ts`)
- `GitHubIntegration` class with PR/CI monitoring via gh CLI
- PR operations: list, get, create, merge
- CI status checks and workflow monitoring
- Review comment handling
- Issue tracking

#### CI Status Polling (`src/lib/ci-poller.ts`)
- `CIPoller` class for continuous CI monitoring
- `WorkflowPoller` for GitHub Actions workflow runs
- Event-based CI status updates
- Configurable polling intervals

#### Event Handlers (`src/lib/lifecycle-manager.ts`)
- `LifecycleManager` with reaction system
- Auto-fix triggers on CI failure
- Review comment reaction handling
- Configurable reaction workflows

#### Telegram Interactivity (`src/lib/telegram-handler.ts`)
- `TelegramHandler` for interactive controls
- Reply buttons for agent control
- Inline keyboard support
- Command handlers for lifecycle operations

#### PR Creation Flow (`src/lib/pr-creator.ts`)
- `PRCreator` for agent-initiated PR creation
- Worktree-based branch creation
- Auto-commit with customizable messages
- PR title/body generation

### Fixed
- Fixed import path in `src/git/worktree.ts` (exec module)
- Added telegraf dependency for Telegram handlers
- Fixed type exports in `src/index.ts`

## [1.0.0] - 2026-03-24

### Added
- **Phase 1: Core Infrastructure**
- Config loading from YAML
- Session management with Claude Code integration
- Git worktree handling
- Basic Telegram notifications