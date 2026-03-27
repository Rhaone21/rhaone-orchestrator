import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface RhaoneConfig {
  defaults: {
    agent: string;
    model: string;
  };
  github: {
    token?: string;
    owner?: string;
    repo?: string;
  };
  telegram: {
    chatId?: string;
    enabled: boolean;
  };
  learning: {
    enabled: boolean;
    minSessionsForPattern: number;
  };
  projects: Record<string, ProjectConfig>;
}

export interface ProjectConfig {
  name: string;
  repo: string;
  path: string;
  defaultBranch: string;
  agents?: Record<string, AgentConfig>;
  reactions?: Record<string, ReactionConfig>;
}

export interface AgentConfig {
  permissions?: string;
  model?: string;
}

export interface ReactionConfig {
  action: string;
  autoRetry?: boolean;
  maxRetries?: number;
}

const DEFAULT_CONFIG: RhaoneConfig = {
  defaults: {
    agent: 'claude-code',
    model: 'claude-sonnet-4-20250514',
  },
  github: {
    token: process.env.GITHUB_TOKEN,
    owner: '',
    repo: '',
  },
  telegram: {
    chatId: process.env.TELEGRAM_CHAT_ID,
    enabled: true,
  },
  learning: {
    enabled: true,
    minSessionsForPattern: 5,
  },
  projects: {},
};

export class ConfigLoader {
  private config: RhaoneConfig;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || this.getDefaultConfigPath();
    this.config = this.load();
  }

  private getDefaultConfigPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '/root';
    return path.join(home, '.rhaone-orchestrator', 'config.yaml');
  }

  load(): RhaoneConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileContents = fs.readFileSync(this.configPath, 'utf8');
        const userConfig = yaml.load(fileContents) as Partial<RhaoneConfig>;
        return this.mergeConfig(DEFAULT_CONFIG, userConfig);
      }
    } catch (error) {
      console.error(`Failed to load config from ${this.configPath}:`, error);
    }
    return { ...DEFAULT_CONFIG };
  }

  private mergeConfig(defaults: RhaoneConfig, user: Partial<RhaoneConfig>): RhaoneConfig {
    return {
      defaults: { ...defaults.defaults, ...user.defaults },
      github: { ...defaults.github, ...user.github },
      telegram: { ...defaults.telegram, ...user.telegram },
      learning: { ...defaults.learning, ...user.learning },
      projects: { ...defaults.projects, ...user.projects },
    };
  }

  get(): RhaoneConfig {
    return this.config;
  }

  getProject(projectId: string): ProjectConfig | null {
    return this.config.projects[projectId] || null;
  }

  getGithubToken(): string | undefined {
    return this.config.github.token || process.env.GITHUB_TOKEN;
  }

  getTelegramChatId(): string | undefined {
    return this.config.telegram.chatId || process.env.TELEGRAM_CHAT_ID;
  }

  isTelegramEnabled(): boolean {
    return this.config.telegram.enabled && !!this.getTelegramChatId();
  }

  save(config: Partial<RhaoneConfig>): void {
    this.config = this.mergeConfig(this.config, config);
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, yaml.dump(this.config), 'utf8');
  }
}

export const configLoader = new ConfigLoader();

/**
 * Convenience function to load config
 */
export function loadConfig(configPath?: string, projectRoot?: string): RhaoneConfig {
  const loader = configPath ? new ConfigLoader(configPath) : configLoader;
  return loader.get();
}