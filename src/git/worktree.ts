import * as fs from 'fs';
import * as path from 'path';
import { exec } from '../exec';

export interface WorktreeConfig {
  basePath: string;
  defaultBranch: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export class GitWorktreeHandler {
  private basePath: string;
  private repoPath: string;
  private defaultBranch: string;

  constructor(repoPath: string, basePath: string, defaultBranch: string = 'main') {
    this.repoPath = repoPath;
    this.basePath = basePath;
    this.defaultBranch = defaultBranch;
  }

  async create(branchName: string, worktreeName?: string): Promise<WorktreeInfo> {
    const name = worktreeName || branchName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const worktreePath = path.join(this.basePath, name);

    // Ensure base path exists
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }

    // Check if worktree already exists
    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree already exists at ${worktreePath}`);
    }

    // Create branch if it doesn't exist locally
    await this.ensureBranch(branchName);

    // Create the worktree
    const cmd = `git -C "${this.repoPath}" worktree add "${worktreePath}" "${branchName}"`;
    await exec({ command: cmd });

    // Get worktree info
    const info = await this.getWorktreeInfo(worktreePath);
    return info;
  }

  async destroy(branchName: string, worktreeName?: string): Promise<void> {
    const name = worktreeName || branchName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const worktreePath = path.join(this.basePath, name);

    if (!fs.existsSync(worktreePath)) {
      throw new Error(`Worktree does not exist at ${worktreePath}`);
    }

    // Remove the worktree
    const cmd = `git -C "${this.repoPath}" worktree remove "${worktreePath}" --force`;
    await exec({ command: cmd });

    // Try to delete the branch (ignore errors if branch is not fully merged)
    try {
      await exec({ command: `git -C "${this.repoPath}" branch -d "${branchName}"` });
    } catch {
      // Branch may not be fully merged, ignore
    }
  }

  async list(): Promise<WorktreeInfo[]> {
    const output = await exec({ command: `git -C "${this.repoPath}" worktree list --porcelain` });
    
    const worktrees: WorktreeInfo[] = [];
    const entries = output.split('\n\n');
    
    for (const entry of entries) {
      const lines = entry.trim().split('\n');
      const info: Partial<WorktreeInfo> = {};
      
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          info.path = line.substring(9).trim();
        } else if (line.startsWith('branch ')) {
          info.branch = line.substring(7).trim();
        } else if (line.startsWith('HEAD ')) {
          info.head = line.substring(5).trim();
        }
      }
      
      if (info.path && info.path.startsWith(this.basePath)) {
        worktrees.push(info as WorktreeInfo);
      }
    }
    
    return worktrees;
  }

  async getWorktreeInfo(worktreePath: string): Promise<WorktreeInfo> {
    const branch = (await exec({ command: `git -C "${worktreePath}" rev-parse --abbrev-ref HEAD` })).trim();
    const head = (await exec({ command: `git -C "${worktreePath}" rev-parse HEAD` })).trim();
    
    return {
      path: worktreePath,
      branch,
      head,
    };
  }

  async ensureBranch(branchName: string): Promise<void> {
    // Check if branch exists locally
    try {
      const exists = (await exec({ command: `git -C "${this.repoPath}" branch --list "${branchName}"` })).trim();
      if (exists) return;
    } catch {
      // Branch doesn't exist locally
    }

    // Check if branch exists remotely
    const remoteExists = (await exec({ command: `git -C "${this.repoPath}" ls-remote --heads origin "${branchName}"` })).trim();
    
    if (remoteExists) {
      // Create local branch from remote (without checking out)
      await exec({ command: `git -C "${this.repoPath}" branch "${branchName}" "origin/${branchName}"` });
    } else {
      // Create new branch from default branch (without checking out)
      await exec({ command: `git -C "${this.repoPath}" branch "${branchName}" "${this.defaultBranch}"` });
    }
  }

  async getCurrentBranch(): Promise<string> {
    return (await exec({ command: `git -C "${this.repoPath}" rev-parse --abbrev-ref HEAD` })).trim();
  }
}