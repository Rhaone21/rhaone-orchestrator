# Notes for Kimi — Security & Bug Fixes Review

Halo Kimi, berikut ringkasan apa yang sudah diperbaiki dan apa yang masih perlu perhatianmu.

---

## Yang Sudah Diperbaiki

### 1. Command Injection — `src/lib/pr-creator.ts` (CRITICAL)

**Masalah:** Semua perintah git menggunakan pola `cd ${path} && git ...` dengan path yang langsung diinterpolasi ke shell string. Karena `exec()` menggunakan `child_process.exec` (mode shell), path yang mengandung `;`, `|`, backtick, atau `$()` bisa mengeksekusi perintah arbitrer.

**Fix:** Semua pola `cd ${path} && git ...` diganti dengan `git ...` + opsi `workdir: path`. Fungsi `exec()` sudah mendukung `workdir` yang meng-set `cwd` tanpa melalui shell.

Titik yang diperbaiki:
- `getGitInfoInternal()` — status, log, branch commands
- `commitChangesInternal()` — git add dan git commit
- `listWorktrees()` — git worktree list
- `cleanupWorktrees()` — git log untuk cek umur
- `removeWorktreeInternal()` — git worktree remove dan git branch -D

**Tambahan:** Commit message escaping diperkuat — sebelumnya hanya escape `"`, sekarang juga escape `\`, backtick, dan `$`.

---

### 2. Shell Injection — `src/lib/git-worktree.ts` (HIGH)

**Masalah:** Fungsi `git()` dan `gitAsync()` menggabungkan argumen dengan `join(' ')` lalu dikirim sebagai string ke `execSync`/`exec` (mode shell). Argumen dengan spasi atau karakter shell akan salah diinterpretasi.

**Fix:** Diganti dengan `execFileSync('git', args)` dan `execFile('git', args)` — array-based, tidak melalui shell sama sekali.

**Bug tambahan yang diperbaiki:** `destroy()` dan `destroyWithRetry()` mengirimkan string kosong `''` sebagai argumen ke git saat `force=false`. Fix: argumen `--force` sekarang hanya ditambahkan secara kondisional.

---

### 3. Bug Worktree Creation — `src/git/worktree.ts` (BUG)

**Masalah:** Fungsi `ensureBranch()` menggunakan `git checkout -b branchName` untuk membuat branch baru. Ini men-checkout branch tersebut di repo utama, sehingga ketika `create()` mencoba `git worktree add`, git menolak dengan error _"already checked out"_.

**Fix:** Diganti dengan `git branch branchName baseBranch` — membuat branch tanpa checkout.

---

### 4. Weak Session ID — `src/lib/session-manager.ts` (MEDIUM)

**Masalah:** `generateSessionId()` hanya menggunakan 4 karakter terakhir dari `Date.now().toString(36)` (~1.6 juta kombinasi), membuat session ID predictable.

**Fix:** Sekarang menggunakan `crypto.randomBytes(4).toString('hex')` — 8 karakter hex = 32 bits entropi kriptografis.

---

### 5. TypeScript Type Errors — `src/lib/session-manager.ts` (BUG)

**Masalah:** `SpawnConfig.issueId` bertipe `string | undefined`, tapi dipakai di banyak tempat yang mengharapkan `string` — menyebabkan compile error.

**Fix:** Ditambahkan fallback `?? ''` di semua titik: `create()`, `spawn()`, `buildTaskPrompt()`, `scheduleSession()`.

---

## Yang Masih Perlu Perhatianmu ⚠️

### 1. Command Injection di `src/git/worktree.ts` (HIGH)

File ini masih menggunakan string interpolation di semua perintah git:
```typescript
const cmd = `git -C "${this.repoPath}" worktree add "${worktreePath}" "${branchName}"`;
await exec({ command: cmd });
```

Path sudah di-quote dengan `"` jadi aman dari spasi, tapi `branchName` yang berasal dari input user bisa mengandung backtick atau `$()` untuk command substitution.

**Rekomendasi:** Refactor ke menggunakan `child_process.execFile` dengan array argumen, sama seperti fix di `src/lib/git-worktree.ts`. Atau minimal validasi `branchName` hanya mengandung `[a-zA-Z0-9/_.-]`.

---

### 2. GITHUB_TOKEN Exposure (MEDIUM)

Di `src/lib/session-manager.ts` line ~229:
```typescript
env: {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  ...
}
```

Token dikirim sebagai env var ke child process. Ini by-design, tapi:
- Jika token kosong (`''`), error gagal silently downstream
- Token bisa ter-expose di log jika child process crash

**Rekomendasi:** Tambahkan validasi token sebelum spawn, dan pastikan logging tidak mencetak env vars.

---

### 3. Pre-existing Test Failures (37 tests)

Test berikut gagal sebelum perubahan ini dan **bukan disebabkan oleh fix di atas**:

| Test File | Masalah |
|-----------|---------|
| `tests/phase2.test.ts` | `CIPoller is not a constructor` — export salah/tidak ada |
| `tests/phase2.test.ts` | `prCreator.getWorktreeInfo is not a function` — method bernama `getWorktreeInfoWithCache`, bukan `getWorktreeInfo` |
| `tests/phase2.test.ts` | GitHub Integration, Lifecycle Manager, Telegram Handler — dependency/mock issues |
| `tests/orchestrator.test.ts` | `Config Loader` — `config.defaults` undefined, struktur config tidak match |
| `tests/session-manager.test.ts` | Session count wrong (got 61, expected 2) — sessions dari run sebelumnya terakumulasi di disk, tidak ada cleanup di `beforeEach` |

**Yang perlu dilakukan:**
- Fix export `CIPoller` di index
- Rename test call `getWorktreeInfo` → `getWorktreeInfoWithCache`, atau expose method publik dengan nama yang benar
- Fix `loadGlobalConfig` agar mengembalikan struktur dengan `defaults.agent`
- Fix test isolation di `session-manager.test.ts` — gunakan `os.tmpdir()` + random dir dan hapus di `afterEach`

---

## Status Build & Test

```
npm run build   → ✅ Clean (no TypeScript errors)
npm test        → 117 passed, 37 failed (semua failures pre-existing)
```

---

*Notes ditulis oleh Claude Sonnet 4.6 — 2026-03-26*
