# Implement Instructions for Kimi

Halo Kimi! Ada beberapa perubahan dari Claude yang perlu kamu apply ke codebase. Semua perubahan sudah di-verify build clean dan tested.

---

## 1. Fix `package.json` — Critical

Ubah baris ini:
```json
"type": "module",
```
Jadi:
```json
"type": "commonjs",
```

---

## 2. Fix `src/lib/git-worktree.ts` — Security (Shell Injection)

**Baris 1**, ubah import:
```typescript
// BEFORE
import { execSync, exec } from 'child_process';

// AFTER
import { execFileSync, execFile } from 'child_process';
```

**Fungsi `git()`**, ubah implementasi:
```typescript
// BEFORE
function git(cwd: string, ...args: string[]): string {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string };
    throw new Error(`git ${args.join(' ')} failed: ${err.stderr || err.message || error}`);
  }
}

// AFTER
function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string | Buffer };
    const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString();
    throw new Error(`git ${args.join(' ')} failed: ${stderr || err.message || error}`);
  }
}
```

**Fungsi `gitAsync()`**, ubah implementasi:
```typescript
// BEFORE
function gitAsync(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`git ${args.join(' ')}`, { cwd, encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// AFTER
function gitAsync(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
      } else {
        resolve((stdout as string).trim());
      }
    });
  });
}
```

**Di `destroy()`**, ubah baris yang ada `--force`:
```typescript
// BEFORE
git(repoPath, 'worktree', 'remove', worktreePath, force ? '--force' : '');

// AFTER
const removeArgs: string[] = ['worktree', 'remove', worktreePath, ...(force ? ['--force'] : [])];
git(repoPath, ...removeArgs);
```
(Ada 2 tempat — di `destroy()` dan `destroyWithRetry()`, fix keduanya)

---

## 3. Fix `src/git/worktree.ts` — Bug (Worktree Creation Fails)

Di fungsi `ensureBranch()`, ubah:
```typescript
// BEFORE
if (remoteExists) {
  await exec({ command: `git -C "${this.repoPath}" checkout -b "${branchName}" "origin/${branchName}"` });
} else {
  await exec({ command: `git -C "${this.repoPath}" checkout -b "${branchName}" "${this.defaultBranch}"` });
}

// AFTER
if (remoteExists) {
  // Create local branch from remote (without checking out)
  await exec({ command: `git -C "${this.repoPath}" branch "${branchName}" "origin/${branchName}"` });
} else {
  // Create new branch from default branch (without checking out)
  await exec({ command: `git -C "${this.repoPath}" branch "${branchName}" "${this.defaultBranch}"` });
}
```

**Kenapa:** `checkout -b` men-checkout branch di repo utama sehingga `git worktree add` selalu gagal dengan "already checked out". Cukup `git branch` tanpa checkout.

---

## 4. Fix `src/lib/pr-creator.ts` — Security (Command Injection)

Di fungsi `getGitInfoInternal()`, ubah semua perintah:
```typescript
// BEFORE
const statusResult = await exec({
  command: `cd ${gitPath} && git status --porcelain`,
  timeout: 10,
});
// ... (3 perintah serupa dengan cd ${gitPath})

// AFTER — hapus cd ${gitPath} &&, tambah workdir
const statusResult = await exec({
  command: 'git status --porcelain',
  workdir: gitPath,
  timeout: 10,
});
const lastCommitResult = await exec({
  command: 'git log -1 --oneline',
  workdir: gitPath,
  timeout: 10,
});
const branchResult = await exec({
  command: 'git branch --show-current',
  workdir: gitPath,
  timeout: 10,
});
```

Di `commitChangesInternal()`:
```typescript
// BEFORE
await exec({ command: `cd ${worktree.path} && git add -A`, timeout: 10 });
await exec({ command: `cd ${worktree.path} && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, timeout: 10 });

// AFTER
await exec({ command: 'git add -A', workdir: worktree.path, timeout: 10 });

const rawMessage = session.issueId
  ? `Fix: ${session.issueId} - Session ${session.id}`
  : `Changes: Session ${session.id}`;
const commitMessage = rawMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
await exec({ command: `git commit -m "${commitMessage}"`, workdir: worktree.path, timeout: 10 });
```

Di `listWorktrees()`:
```typescript
// BEFORE
command: `cd ${this.workspaceRoot} && git worktree list --porcelain`,

// AFTER
command: 'git worktree list --porcelain',
workdir: this.workspaceRoot,
```

Di `cleanupWorktrees()`:
```typescript
// BEFORE
command: `cd ${worktree.path} && git log -1 --format=%ct`,

// AFTER
command: 'git log -1 --format=%ct',
workdir: worktree.path,
```

Di `removeWorktreeInternal()`:
```typescript
// BEFORE
command: `git worktree remove ${worktree.path} --force`,
// ...
command: `git branch -D ${worktree.branch}`,

// AFTER
command: `git worktree remove "${worktree.path.replace(/"/g, '\\"')}" --force`,
// ...
const safeBranch = worktree.branch.replace(/[^a-zA-Z0-9/_.-]/g, '');
command: `git branch -D ${safeBranch}`,
```

---

## 5. Fix `src/lib/session-manager.ts` — Security + Feature

**Tambah imports** di baris paling atas (setelah import yang sudah ada):
```typescript
import { randomBytes } from 'crypto';
import { LearningEngine } from '../learning';
import { MetricsCollector } from '../learning/metrics-collector';
import { PatternAnalyzer } from '../learning/patterns';
```

**Fix `generateSessionId()`**:
```typescript
// BEFORE
generateSessionId(projectId: string, issueId: string): string {
  const timestamp = Date.now().toString(36).slice(-4);
  const cleanIssueId = issueId ? issueId.replace(/[^a-zA-Z0-9]/g, '') : 'unknown';
  return `${projectId}-${cleanIssueId}-${timestamp}`;
}

// AFTER
generateSessionId(projectId: string, issueId: string): string {
  const random = randomBytes(4).toString('hex');
  const cleanIssueId = issueId ? issueId.replace(/[^a-zA-Z0-9]/g, '') : 'unknown';
  return `${projectId}-${cleanIssueId}-${random}`;
}
```

**Tambah 3 private fields** di class `SessionManager`:
```typescript
private learning: LearningEngine;
private metrics: MetricsCollector;
private patternAnalyzer: PatternAnalyzer;
```

**Di constructor**, tambah sebelum `this.loadAllSessions()`:
```typescript
this.learning = new LearningEngine();
this.metrics = new MetricsCollector();
this.patternAnalyzer = new PatternAnalyzer();
```

**Di `spawn()`**, setelah `console.log('Spawned session...')`, tambah:
```typescript
// Start metrics tracking
this.metrics.startSession({
  sessionId: session.id,
  projectId: session.projectId,
  agentType: config.agent ?? 'kimi',
  model: config.model,
  taskType: this.patternAnalyzer.classifyTask(config.task),
  issueId: session.issueId || undefined,
});
this.metrics.updateSession(session.id, {
  status: 'working',
  spawnDuration: session.metrics.spawnDuration,
});
```

**Di `updateStatus()`**, setelah `console.log('Updated session...')`, tambah:
```typescript
const statusMap: Record<string, string> = {
  working: 'working',
  waiting_pr: 'pr_open',
  completed: 'completed',
  errored: 'errored',
  killed: 'killed',
};
const metricsStatus = statusMap[status] as any;
if (metricsStatus) {
  this.metrics.updateSession(sessionId, { status: metricsStatus });
}
```

**Ganti `complete()`**:
```typescript
async complete(sessionId: string, prInfo?: { number: number; url: string }): Promise<Session | null> {
  const result = await this.updateStatus(sessionId, 'completed', {
    pr: prInfo ? { number: prInfo.number, url: prInfo.url, state: 'open' } : undefined,
  });

  const finalMetrics = this.metrics.completeSession(sessionId, true);
  if (finalMetrics) {
    this.learning.recordSession(finalMetrics);
  }

  return result;
}
```

**Di `kill()`**, setelah `saveSession`, tambah:
```typescript
const finalMetrics = this.metrics.completeSession(sessionId, false, 'killed');
if (finalMetrics) {
  this.learning.recordSession(finalMetrics);
}
```

**Tambah 2 public methods** (taruh sebelum `complete()`):
```typescript
getInsights(days = 7) {
  return this.learning.getInsightsReport(days);
}

getRecommendation(taskDescription: string) {
  const taskType = this.patternAnalyzer.classifyTask(taskDescription);
  return this.learning.getRecommendation(taskType);
}
```

**Fix `issueId` type errors** — ganti semua `config.issueId` yang dipakai sebagai `string` dengan `config.issueId ?? ''`:
- `create()`: `generateSessionId(..., config.issueId ?? '')`, `generateBranchName(config.issueId ?? '')`, `issueId: config.issueId ?? ''`
- `spawn()`: `RHAONE_ISSUE_ID: config.issueId ?? ''`
- `buildTaskPrompt()`: `generateBranchName(config.issueId ?? '')`, `generateSessionId(..., config.issueId ?? '')`
- `scheduleSession()`: `issueId: config.issueId ?? ''`, `generateBranchName(config.issueId ?? '')`

---

## 6. Setelah Apply Semua Perubahan

```bash
npm run build:clean   # wajib clean build biar tidak ada stale artifact
npm test              # harusnya sama atau lebih baik dari sebelumnya
node dist/cli.js spawn TEST-001 "Test after implementation"
node dist/cli.js list
```

**Verify learning integration:**
```bash
node -e "
const { SessionManager } = require('./dist/lib/session-manager');
const sm = new SessionManager({ dataDir: '/tmp/verify' });
const report = sm.getInsights(30);
console.log('Total sessions tracked:', report.totalSessions);
console.log('Top agent:', report.agentPerformance?.[0]?.agentType);
const rec = sm.getRecommendation('Fix auth bug');
console.log('Recommendation:', rec?.suggestedAgent, 'confidence:', rec?.confidence);
"
```

---

## Summary

| File | Jenis Perubahan |
|------|----------------|
| `package.json` | Fix `"type": "module"` → `"commonjs"` |
| `src/lib/git-worktree.ts` | Security: execSync → execFileSync (no shell) |
| `src/git/worktree.ts` | Bug: ensureBranch checkout-b → branch |
| `src/lib/pr-creator.ts` | Security: cd ${path} → workdir option |
| `src/lib/session-manager.ts` | Security: crypto session ID + Feature: learning wire-up |

*Prepared by Claude Sonnet 4.6 — 2026-03-26*
