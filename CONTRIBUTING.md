# Contributing to Rhaone Orchestrator

Thank you for your interest in contributing to Rhaone Orchestrator! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)

---

## Code of Conduct

This project adheres to a code of conduct that all contributors are expected to follow:

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

## Getting Started

### Prerequisites

- Node.js 20+
- Git
- GitHub CLI (`gh`)
- Claude Code CLI

### Fork and Clone

```bash
# Fork the repository on GitHub
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/rhaone-orchestrator.git
cd rhaone-orchestrator

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Development Setup

### Project Structure

```
rhaone-orchestrator/
├── src/
│   ├── lib/              # Core library modules
│   │   ├── session-manager.ts
│   │   ├── orchestrator.ts
│   │   ├── github.ts
│   │   ├── error-handler.ts
│   │   ├── performance-optimizer.ts
│   │   └── ...
│   ├── learning/         # Learning engine
│   │   ├── index.ts
│   │   ├── patterns.ts
│   │   ├── recommendations.ts
│   │   └── ...
│   ├── cli.ts            # CLI entry point
│   └── index.ts          # Main exports
├── tests/                # Test files
├── docs/                 # Documentation
├── examples/             # Example configurations
└── scripts/              # Build scripts
```

### Development Workflow

1. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**

3. **Run tests:**
   ```bash
   npm test
   ```

4. **Build:**
   ```bash
   npm run build
   ```

5. **Commit:**
   ```bash
   git add .
   git commit -m "feat: description of your changes"
   ```

6. **Push and create PR:**
   ```bash
   git push origin feature/your-feature-name
   ```

## Coding Standards

### TypeScript Guidelines

- **Strict typing:** Always use explicit types, avoid `any`
- **No `@ts-nocheck`:** Fix root causes instead
- **File size:** Keep files under ~700 LOC
- **Comments:** Brief comments for non-obvious logic

### Code Style

```typescript
// Use explicit types
function processData(input: string): Result {
  // Implementation
}

// Use interfaces for complex types
interface Config {
  name: string;
  value: number;
}

// Avoid any
// ❌ Bad
function bad(data: any): any {
  return data.value;
}

// ✅ Good
function good(data: Config): number {
  return data.value;
}
```

### Naming Conventions

- **Files:** kebab-case (`session-manager.ts`)
- **Classes:** PascalCase (`SessionManager`)
- **Functions:** camelCase (`getSession`)
- **Constants:** UPPER_SNAKE_CASE (`DEFAULT_TIMEOUT`)
- **Private members:** camelCase with underscore prefix (`_privateMethod`)

### Error Handling

```typescript
// Use ErrorHandler for async operations
const result = await errorHandler.handle(
  () => riskyOperation(),
  { operation: 'riskyOperation', context: 'additional info' }
);

// Or use try/catch with proper typing
try {
  const result = await operation();
} catch (error) {
  const err = error as Error;
  console.error(`Operation failed: ${err.message}`);
  throw err;
}
```

### Documentation

All public APIs must have JSDoc comments:

```typescript
/**
 * Creates a new session for the given issue.
 * @param config - Configuration for the session
 * @returns The created session
 * @throws Error if session creation fails
 */
async function createSession(config: SpawnConfig): Promise<Session> {
  // Implementation
}
```

## Testing

### Test Structure

Tests are located in the `tests/` directory:

```
tests/
├── unit/                 # Unit tests
│   ├── session-manager.test.ts
│   └── ...
├── integration/          # Integration tests
│   └── github.test.ts
└── e2e/                  # End-to-end tests
    └── workflow.test.ts
```

### Writing Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/lib/session-manager';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('should create a session', async () => {
    const session = await manager.create({
      projectId: 'test',
      issueId: 'GH-123',
      task: 'Test task',
    });

    expect(session.id).toBeDefined();
    expect(session.status).toBe('pending');
  });

  it('should throw on invalid config', async () => {
    await expect(
      manager.create({ projectId: '', issueId: '', task: '' })
    ).rejects.toThrow();
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run specific test file
npm test session-manager

# Run integration tests only
npm run test:integration

# Run e2e tests
npm run test:e2e
```

### Coverage Requirements

- **Minimum coverage:** 70% lines/branches/functions/statements
- **Critical paths:** Should have 90%+ coverage
- **New features:** Must include tests

## Pull Request Process

### Before Submitting

1. **Run all tests:**
   ```bash
   npm test
   ```

2. **Check coverage:**
   ```bash
   npm run test:coverage
   ```

3. **Build:**
   ```bash
   npm run build
   ```

4. **Lint:**
   ```bash
   npm run lint
   ```

5. **Update documentation:**
   - Update README.md if needed
   - Update API docs for new features
   - Update CHANGELOG.md

### PR Template

```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] Tests pass
- [ ] Coverage maintained

## Related Issues
Fixes #123
```

### Review Process

1. **Automated checks:** CI must pass
2. **Code review:** At least one approval required
3. **Documentation review:** For API changes
4. **Merge:** Squash and merge by maintainer

## Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR:** Breaking changes
- **MINOR:** New features (backward compatible)
- **PATCH:** Bug fixes (backward compatible)

### Creating a Release

1. **Update CHANGELOG.md:**
   ```markdown
   ## [1.2.0] - 2026-03-26
   ### Added
   - New feature description

   ### Fixed
   - Bug fix description
   ```

2. **Bump version:**
   ```bash
   npm version minor  # or major/patch
   ```

3. **Create release PR:**
   ```bash
   git checkout -b release/v1.2.0
   git add .
   git commit -m "chore: release v1.2.0"
   git push origin release/v1.2.0
   ```

4. **Merge and tag:**
   ```bash
   git checkout main
   git pull
   git tag v1.2.0
   git push origin v1.2.0
   ```

5. **Publish:**
   ```bash
   npm publish
   ```

## Areas for Contribution

### High Priority

- [ ] Additional CI/CD platform support (GitLab, Bitbucket)
- [ ] Web dashboard for monitoring
- [ ] Plugin system for custom reactions
- [ ] Advanced scheduling (cron-based)
- [ ] Multi-repository coordination

### Medium Priority

- [ ] Additional notification channels (Slack, Discord)
- [ ] Enhanced learning algorithms
- [ ] More task decomposition strategies
- [ ] Distributed orchestration

### Documentation

- [ ] More examples and tutorials
- [ ] Video walkthroughs
- [ ] Architecture decision records (ADRs)

### Testing

- [ ] Increase test coverage
- [ ] Add more integration tests
- [ ] Performance benchmarks

## Questions?

Feel free to open an issue or discussion if you have questions about contributing.

Thank you for contributing to Rhaone Orchestrator! 🦞