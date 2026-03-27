# Rhaone Orchestrator - Troubleshooting Guide

## Table of Contents

- [Installation Issues](#installation-issues)
- [Configuration Issues](#configuration-issues)
- [Session Management Issues](#session-management-issues)
- [GitHub Integration Issues](#github-integration-issues)
- [CI/CD Issues](#cicd-issues)
- [Performance Issues](#performance-issues)
- [Error Recovery](#error-recovery)
- [Getting Help](#getting-help)

---

## Installation Issues

### Node.js Version Error

**Error:**
```
error: rhaone-orchestrator requires Node.js >= 20.0.0
```

**Solution:**
```bash
# Check current version
node --version

# Install Node.js 20+ using nvm
nvm install 20
nvm use 20

# Or download from https://nodejs.org/
```

### Claude Code Not Found

**Error:**
```
Error: Claude Code CLI not found
```

**Solution:**
```bash
# Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# Or use npx
npx -y @anthropic-ai/claude-code

# Verify installation
claude --version
```

### GitHub CLI Not Found

**Error:**
```
Error: gh command not found
```

**Solution:**
```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# Or download from https://cli.github.com

# Verify and authenticate
gh --version
gh auth login
```

---

## Configuration Issues

### Config File Not Found

**Error:**
```
[Config] No config file found at ~/.rhaone-orchestrator/config.yaml
```

**Solution:**
```bash
# Create config directory
mkdir -p ~/.rhaone-orchestrator

# Create config file
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
EOF

# Set environment variable
export GITHUB_TOKEN=your_token_here
```

### GitHub Token Invalid

**Error:**
```
[GitHub] Failed to get issue: authentication required
```

**Solution:**
```bash
# Verify token
gh auth status

# Re-authenticate
gh auth login

# Or set token explicitly
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Test with simple API call
gh api user
```

### Environment Variables Not Substituted

**Error:**
```
[Config] github.token: ${GITHUB_TOKEN} not found
```

**Solution:**
```bash
# Check if variable is set
echo $GITHUB_TOKEN

# Set in current shell
export GITHUB_TOKEN=your_token

# Or add to ~/.bashrc or ~/.zshrc
echo 'export GITHUB_TOKEN=your_token' >> ~/.bashrc

# For systemd services, use EnvironmentFile
```

---

## Session Management Issues

### Session Stuck in "Pending"

**Symptom:** Session status never changes from "pending"

**Diagnosis:**
```typescript
const session = sessionManager.get('session-id');
console.log(session);
// Check if openclawSessionId is set
```

**Solutions:**

1. **Check OpenClaw connection:**
```bash
# Verify OpenClaw is running
openclaw status
```

2. **Check session spawn logs:**
```bash
# Look for errors in logs
tail -f ~/.rhaone-orchestrator/logs/$(date +%Y-%m-%d).log
```

3. **Kill and retry:**
```typescript
await sessionManager.kill('session-id');
const newSession = await sessionManager.spawn({
  projectId: 'my-project',
  issueId: 'GH-123',
  task: 'Fix bug',
});
```

### Session "Errored" Status

**Symptom:** Session shows "errored" status

**Diagnosis:**
```typescript
const session = sessionManager.get('session-id');
console.log(session.error);  // Check error message
console.log(session.metadata);  // Check metadata
```

**Common Causes & Solutions:**

| Error | Cause | Solution |
|-------|-------|----------|
| `spawn timeout` | Agent took too long to start | Increase timeout in config |
| `worktree creation failed` | Git worktree conflict | Clean up existing worktrees |
| `agent not found` | Claude Code not installed | Install Claude Code |
| `rate limit exceeded` | GitHub API rate limit | Wait or use different token |

### Cannot Find Session

**Error:**
```
Error: Session session-id not found
```

**Solutions:**

1. **List all sessions:**
```typescript
const allSessions = sessionManager.list();
console.log(allSessions.map(s => s.id));
```

2. **Check data directory:**
```bash
ls -la ~/.rhaone-orchestrator/projects/*/sessions/
```

3. **Reload sessions:**
```typescript
// Create new SessionManager instance to reload from disk
const freshManager = new SessionManager();
```

### Worktree Already Exists

**Error:**
```
Error: worktree already exists
```

**Solution:**
```bash
# List existing worktrees
git worktree list

# Remove stale worktree
git worktree remove /path/to/worktree --force

# Or cleanup all
rm -rf ~/.rhaone-orchestrator/worktrees/*
```

---

## GitHub Integration Issues

### Issue Not Found

**Error:**
```
[GitHub] Failed to get issue GH-123: Could not resolve to an issue
```

**Solutions:**

1. **Verify issue exists:**
```bash
gh issue view 123 --repo owner/repo
```

2. **Check repository configuration:**
```yaml
# config.yaml
github:
  owner: correct-owner
  repo: correct-repo
```

3. **Verify permissions:**
```bash
gh api repos/owner/repo/issues/123
```

### PR Creation Failed

**Error:**
```
[GitHub] Failed to create PR: Validation Failed
```

**Common Causes:**

1. **Branch already exists:**
```bash
# Check existing branches
git branch -a | grep feat/GH-123

# Delete if stale
git push origin --delete feat/GH-123-fix
```

2. **No changes to commit:**
```bash
# Check status in worktree
cd /path/to/worktree
git status
```

3. **Base branch protection:**
```bash
# Check branch protection
gh api repos/owner/repo/branches/main/protection
```

### CI Status Not Updating

**Symptom:** CI status stuck showing old results

**Solutions:**

1. **Clear cache:**
```typescript
import { globalCache } from 'rhaone-orchestrator';
globalCache.clear();
```

2. **Force refresh:**
```typescript
const status = await github.getCIStatus(prNumber);
// Manually check latest run
const runs = await github.getWorkflowRuns(branch, 1);
```

3. **Check webhook delivery:**
```bash
# In GitHub repo settings > Webhooks
# Verify webhook is active and delivering
```

---

## CI/CD Issues

### CI Polling Not Working

**Symptom:** No CI status updates received

**Diagnosis:**
```typescript
// Check poller status
const poller = new CIPoller(github, config);
poller.start();

// Verify events are being emitted
poller.on('statusChange', (event) => {
  console.log('Status changed:', event);
});
```

**Solutions:**

1. **Verify GitHub token has required scopes:**
```bash
gh auth status
# Should show: ✓ Logged in
#              ✓ Token scopes: repo, workflow
```

2. **Check rate limits:**
```bash
gh api rate_limit
```

3. **Manual poll test:**
```typescript
const status = await github.getCIStatus(456);
console.log(status);
```

### Auto-Merge Not Working

**Symptom:** PR not auto-merged even though CI passed

**Solutions:**

1. **Check branch protection:**
```typescript
const protection = await github.getBranchProtection('main');
console.log(protection.requireReviews);  // May require reviews
console.log(protection.requireCI);       // May require CI
```

2. **Verify PR is mergeable:**
```typescript
const pr = await github.getPR('456');
console.log(pr.mergeable);  // Must be true
console.log(pr.draft);      // Must be false
```

3. **Check merge requirements in config:**
```yaml
reactions:
  ciPassed:
    action: auto_merge
    requireCI: true
    requireReviews: false  # Set to true if reviews required
```

---

## Performance Issues

### High Memory Usage

**Symptom:** Process using excessive memory

**Diagnosis:**
```typescript
// Check resource usage
const usage = resourceManager.getUsage();
console.log(usage.memoryUsage);

// Check cache
const metrics = globalCache.getMetrics();
console.log(metrics.memoryUsage);
```

**Solutions:**

1. **Reduce cache size:**
```typescript
const cache = createCache({
  maxSize: 500,        // Reduce from 1000
  maxMemoryMB: 50,     // Reduce from 100
});
```

2. **Clear old sessions:**
```typescript
// Clean up completed sessions
const sessions = sessionManager.list();
for (const session of sessions) {
  if (session.status === 'completed' || session.status === 'errored') {
    await sessionManager.kill(session.id);
  }
}
```

3. **Limit concurrent sessions:**
```yaml
session:
  maxConcurrent: 3  # Reduce from default 5
```

### Slow Response Times

**Symptom:** API calls taking too long

**Diagnosis:**
```typescript
// Enable performance logging
const start = Date.now();
const result = await github.getIssue('GH-123');
console.log(`Took ${Date.now() - start}ms`);

// Check cache hit rate
const metrics = globalCache.getMetrics();
console.log(`Hit rate: ${metrics.hitRate * 100}%`);
```

**Solutions:**

1. **Enable caching:**
```typescript
// Results are automatically cached
// Adjust TTL based on your needs
const cache = createCache({
  defaultTTL: 5 * 60 * 1000,  // 5 minutes
});
```

2. **Use adaptive polling:**
```yaml
performance:
  adaptivePolling: true
```

3. **Batch operations:**
```typescript
// Instead of sequential calls
const issues = await Promise.all(
  issueIds.map(id => github.getIssue(id))
);
```

### Too Many API Calls

**Symptom:** Hitting GitHub rate limits

**Diagnosis:**
```bash
# Check current rate limit
gh api rate_limit
```

**Solutions:**

1. **Increase cache TTL:**
```typescript
const cache = createCache({
  defaultTTL: 10 * 60 * 1000,  // 10 minutes
});
```

2. **Reduce polling frequency:**
```yaml
performance:
  adaptivePolling: true
  pollInterval: 30000  # 30 seconds
```

3. **Use lazy loading:**
```typescript
const loader = createLazyLoader({
  ttl: 60000,
  preload: false,  // Don't preload
});
```

---

## Error Recovery

### Automatic Retry

The ErrorHandler automatically retries operations:

```typescript
const result = await errorHandler.handle(
  () => riskyOperation(),
  { operation: 'riskyOperation' }
);
```

Default retry strategies by category:

| Category | Max Retries | Backoff | Retryable Errors |
|----------|-------------|---------|------------------|
| network | 5 | 2s → 60s | ECONNRESET, ETIMEDOUT |
| github | 3 | 5s → 60s | rate limit, 5xx errors |
| git | 2 | 1s → 10s | lock, conflict |
| session | 1 | 1s | spawn failures |
| config | 0 | - | No retry |

### Manual Recovery

**Kill stuck sessions:**
```typescript
// Get stuck sessions
const sessions = sessionManager.listActive();
const stuck = sessions.filter(s => {
  const age = Date.now() - new Date(s.createdAt).getTime();
  return age > 24 * 60 * 60 * 1000;  // Older than 24h
});

// Kill them
for (const session of stuck) {
  await sessionManager.kill(session.id);
}
```

**Clean up stuck resources:**
```typescript
// Clean up resource manager
const cleaned = resourceManager.cleanupStuckSlots();
console.log(`Cleaned up ${cleaned} stuck slots`);

// Clean up orchestrator
const orchCleaned = orchestrator.cleanup();
```

**Clear error history:**
```typescript
errorHandler.clearHistory();
```

### Fallback Actions

Configure fallback actions for errors:

```typescript
const errorHandler = createErrorHandler({
  categoryStrategies: {
    github: {
      fallbackAction: async () => {
        // Send notification
        await telegramNotifier.send('GitHub API unavailable');
      },
    },
  },
});
```

---

## Getting Help

### Debug Mode

Enable debug logging:

```bash
# Set environment variable
export RHAONE_DEBUG=1

# Or in code
process.env.RHAONE_DEBUG = '1';
```

### Log Files

Check log files for detailed error information:

```bash
# Today's log
tail -f ~/.rhaone-orchestrator/logs/$(date +%Y-%m-%d).log

# All logs
ls -la ~/.rhaone-orchestrator/logs/

# Search for errors
grep -i "error" ~/.rhaone-orchestrator/logs/*.log
```

### Health Checks

Run health checks:

```typescript
// Orchestrator health
const health = orchestrator.getHealth();
console.log(JSON.stringify(health, null, 2));

// Resource health
const resourceHealth = resourceManager.getHealth();
console.log(JSON.stringify(resourceHealth, null, 2));
```

### Error Statistics

Get error statistics:

```typescript
const stats = errorHandler.getStats(24 * 60 * 60 * 1000);  // Last 24h
console.log('Total errors:', stats.total);
console.log('By category:', stats.byCategory);
console.log('Recovery rate:', stats.recoveryRate);
```

### Report an Issue

When reporting issues, include:

1. **Environment:**
   - Node.js version: `node --version`
   - Package version: `npm list rhaone-orchestrator`
   - OS: `uname -a`

2. **Configuration:**
   ```bash
   cat ~/.rhaone-orchestrator/config.yaml
   ```

3. **Relevant logs:**
   ```bash
   tail -n 100 ~/.rhaone-orchestrator/logs/$(date +%Y-%m-%d).log
   ```

4. **Error details:**
   ```typescript
   const session = sessionManager.get('session-id');
   console.log(JSON.stringify(session, null, 2));
   ```

5. **Health status:**
   ```typescript
   console.log(orchestrator.getHealth());
   ```

### Community Resources

- **GitHub Issues:** https://github.com/your-org/rhaone-orchestrator/issues
- **Documentation:** https://docs.rhaone-orchestrator.io
- **Discord:** https://discord.gg/rhaone

---

## Quick Reference: Common Commands

```bash
# Check status
rhaone status

# List active sessions
rhaone list

# Kill stuck session
rhaone kill <session-id>

# Get insights
rhaone insights

# View logs
tail -f ~/.rhaone-orchestrator/logs/$(date +%Y-%m-%d).log

# Check GitHub auth
gh auth status

# Check rate limits
gh api rate_limit

# Clean worktrees
git worktree list
git worktree remove <path> --force

# Clear cache
rm -rf ~/.rhaone-orchestrator/memory/cache/*
```