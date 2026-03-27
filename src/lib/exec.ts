/**
 * Rhaone Orchestrator - Exec Helper
 * Shell command execution wrapper with error handling and retry logic
 */

import { exec as execCallback, spawn } from 'child_process';
import { promisify } from 'util';
import { withRetry, withErrorHandling, withTimeout, withGracefulDegradation } from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

const execAsync = promisify(execCallback);

// LRU cache for exec results
const execCache = new LRUCache<string, string>({ maxSize: 100, ttlMs: 60 * 1000 });

// Memoized command existence checks
const commandExistsCache = new Map<string, boolean>();

export interface ExecOptions {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  timeout?: number;
  retry?: boolean;
  maxRetries?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Generate cache key for exec options
 */
function generateExecCacheKey(options: ExecOptions): string {
  return `${options.command}:${options.workdir || ''}:${Object.keys(options.env || {}).sort().join(',')}`;
}

/**
 * Execute a shell command with error handling and optional caching
 */
export async function exec(options: ExecOptions & { useCache?: boolean }): Promise<string> {
  const { command, workdir, env, timeout = 30, retry = true, maxRetries = 2, useCache = false } = options;
  
  // Check cache if enabled
  if (useCache) {
    const cacheKey = generateExecCacheKey(options);
    const cached = execCache.get(cacheKey);
    if (cached !== undefined) {
      console.log(`[Exec] Cache hit for: ${command.slice(0, 50)}...`);
      return cached;
    }
  }
  
  const execOptions: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {};
  
  if (workdir) {
    execOptions.cwd = workdir;
  }
  
  if (env) {
    execOptions.env = { ...process.env, ...env };
  }
  
  if (timeout) {
    execOptions.timeout = timeout * 1000;
  }

  const operation = async (): Promise<string> => {
    const { stdout, stderr } = await execAsync(command, execOptions);
    
    if (stderr && stderr.trim()) {
      console.warn(`[Exec] stderr: ${stderr.trim()}`);
    }
    
    return stdout.trim();
  };

  try {
    let result: string;
    if (retry) {
      result = await withRetry(() => operation(), {
        operationName: `exec: ${command.slice(0, 50)}`,
        maxRetries,
        backoffMs: 500,
        backoffMultiplier: 1.5,
        maxBackoffMs: 5000,
        retryableErrors: ['timeout', 'ETIMEDOUT', 'ECONNRESET', 'busy', 'lock'],
      })();
    } else {
      result = await operation();
    }
    
    // Cache result if enabled
    if (useCache) {
      const cacheKey = generateExecCacheKey(options);
      execCache.set(cacheKey, result);
    }
    
    return result;
  } catch (error: any) {
    // Create a more informative error with the command context
    const enhancedError = new Error(
      `Command failed: ${command}\nError: ${error.message}`
    );
    enhancedError.stack = error.stack;
    console.error(`[Exec] ${enhancedError.message}`);
    throw enhancedError;
  }
}

/**
 * Execute a command and return full result with error handling
 */
export async function execWithResult(options: ExecOptions): Promise<ExecResult> {
  const { command, workdir, env, timeout = 30 } = options;
  
  const execOptions: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {};
  
  if (workdir) {
    execOptions.cwd = workdir;
  }
  
  if (env) {
    execOptions.env = { ...process.env, ...env };
  }
  
  if (timeout) {
    execOptions.timeout = timeout * 1000;
  }

  try {
    const { stdout, stderr } = await execAsync(command, execOptions);
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || '',
      exitCode: error.code || 1,
    };
  }
}

/**
 * Execute a command with timeout and retry
 */
export async function execWithRetry(
  options: ExecOptions & { retryOptions?: { maxRetries?: number; backoffMs?: number } }
): Promise<string> {
  const { command, timeout = 30, retryOptions } = options;
  
  return withErrorHandling(
    async () => {
      return withTimeout(
        () => exec(options),
        timeout * 1000,
        { operationName: `exec: ${command.slice(0, 30)}` }
      );
    },
    {
      operation: `exec: ${command.slice(0, 50)}`,
      retry: {
        maxRetries: retryOptions?.maxRetries ?? 3,
        backoffMs: retryOptions?.backoffMs ?? 1000,
        backoffMultiplier: 2,
        maxBackoffMs: 10000,
        retryableErrors: ['timeout', 'ETIMEDOUT', 'ECONNRESET', 'busy'],
      },
    }
  );
}

/**
 * Check if a command exists with graceful fallback and caching.
 * Uses a safe array-based spawn (no shell) to avoid command injection.
 * Cross-platform: uses 'where' on Windows and 'which' on Unix.
 */
export async function commandExists(command: string, useCache = true): Promise<boolean> {
  // Validate: command name must be alphanumeric/hyphens only
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(command)) {
    return false;
  }

  // Check cache first
  if (useCache && commandExistsCache.has(command)) {
    return commandExistsCache.get(command)!;
  }

  const result = await new Promise<boolean>((resolve) => {
    // Use 'where' on Windows, 'which' on Unix/macOS
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(finder, [command], { stdio: 'ignore', shell: false });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

  // Cache result
  if (useCache) {
    commandExistsCache.set(command, result);
  }

  return result;
}

/**
 * Clear exec cache
 */
export function clearExecCache(): void {
  execCache.clear();
  commandExistsCache.clear();
  console.log('[Exec] Cache cleared');
}

/**
 * Get exec cache stats
 */
export function getExecCacheStats(): { execCacheSize: number; commandExistsCacheSize: number } {
  return {
    execCacheSize: execCache.size(),
    commandExistsCacheSize: commandExistsCache.size,
  };
}

/**
 * Execute a command with circuit breaker protection
 */
export async function execWithCircuitBreaker(
  options: ExecOptions & { circuitId: string }
): Promise<string> {
  const { circuitId, ...execOptions } = options;
  
  return withErrorHandling(
    () => exec(execOptions),
    {
      operation: `exec: ${options.command.slice(0, 50)}`,
      useCircuitBreaker: circuitId,
      retry: {
        maxRetries: 2,
        backoffMs: 1000,
        retryableErrors: ['timeout', 'busy', 'lock'],
      },
    }
  );
}

/**
 * Safe exec - never throws, returns result with exit code
 */
export async function safeExec(options: ExecOptions): Promise<ExecResult> {
  return withGracefulDegradation(
    async () => {
      const result = await execWithResult(options);
      return result;
    },
    { stdout: '', stderr: 'Operation failed', exitCode: 1 },
    { operationName: `safeExec: ${options.command.slice(0, 30)}`, logError: true }
  );
}
