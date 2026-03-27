export interface ExecOptions {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function exec(options: ExecOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const child = exec(
      options.command,
      {
        cwd: options.cwd || process.cwd(),
        timeout: (options.timeout || 30) * 1000,
        env: { ...process.env, ...options.env },
      },
      (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          reject(new Error(`Command failed: ${options.command}\n${stderr || error.message}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// Alias exec as run for backwards compatibility
export const run = exec;

export function main(): void {
  // CLI entry point - can be expanded
  console.log('Rhaone Orchestrator CLI');
}

export function execSync(options: ExecOptions): string {
  const { execSync } = require('child_process');
  try {
    return execSync(options.command, {
      cwd: options.cwd || process.cwd(),
      timeout: (options.timeout || 30) * 1000,
      env: { ...process.env, ...options.env },
      encoding: 'utf-8',
    });
  } catch (error: any) {
    throw new Error(`Command failed: ${options.command}\n${error.message}`);
  }
}

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    await exec({
      command: `command -v ${command}`,
      timeout: 5,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a command and return structured result
 */
export async function execWithResult(options: ExecOptions): Promise<ExecResult> {
  const { exec } = require('child_process');
  
  return new Promise((resolve) => {
    const child = exec(
      options.command,
      {
        cwd: options.cwd || process.cwd(),
        timeout: (options.timeout || 30) * 1000,
        env: { ...process.env, ...options.env },
      },
      (error: Error | null, stdout: string, stderr: string) => {
        resolve({
          stdout,
          stderr,
          exitCode: error ? 1 : 0,
        });
      }
    );
  });
}