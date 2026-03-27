/**
 * Rhaone Orchestrator - Configuration Loader
 * Loads and validates config.yaml for global and project settings
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import {
  withGracefulDegradation,
  errorHandler,
  CIRCUIT_BREAKERS,
  recoverConfigParse,
} from './error-handler';
import { LRUCache, memoize } from './performance-optimizer';

export interface GlobalConfig {
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
  };
  learning: {
    enabled: boolean;
    minSessionsForPattern: number;
  };
}

export interface ProjectConfig {
  project: {
    name: string;
    repo: string;
    path: string;
    defaultBranch: string;
  };
  agents: Record<string, {
    permissions: string;
    model?: string;
  }>;
  reactions: Record<string, {
    action: string;
    autoRetry?: boolean;
    maxRetries?: number;
    requireCI?: boolean;
  }>;
}

export interface Config {
  global: GlobalConfig;
  project?: ProjectConfig;
  projectPath?: string;
}

const DEFAULT_CONFIG: GlobalConfig = {
  defaults: {
    agent: 'kimi',
    model: 'MiniMax-Coding',
  },
  github: {},
  telegram: {},
  learning: {
    enabled: true,
    minSessionsForPattern: 5,
  },
};

// Config cache for performance
const configCache = new LRUCache<string, GlobalConfig | ProjectConfig>({
  maxSize: 50,
  ttlMs: 60 * 1000, // 1 minute TTL for config
});

/**
 * Load global config from ~/.rhaone-orchestrator/config.yaml
 * Wrapped with comprehensive error handling and caching
 */
export async function loadGlobalConfig(configPath?: string): Promise<GlobalConfig> {
  const configFile = configPath || join(homedir(), '.rhaone-orchestrator', 'config.yaml');
  
  // Check cache first
  const cached = configCache.get(configFile) as GlobalConfig | undefined;
  if (cached) {
    console.log(`[Config] Cache hit for global config: ${configFile}`);
    return cached;
  }
  
  if (!existsSync(configFile)) {
    console.log(`[Config] No config file found at ${configFile}, using defaults`);
    return DEFAULT_CONFIG;
  }

  const loadOperation = (): GlobalConfig => {
    const content = readFileSync(configFile, 'utf-8');
    const parsed = yamlToJson(content);
    
    // Validate required fields
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid config format');
    }
    
    // Deep merge: parsed values override defaults
    return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed) as unknown as GlobalConfig;
  };

  try {
    // Use circuit breaker protection for config parsing
    const cb = errorHandler.getCircuitBreaker(CIRCUIT_BREAKERS.CONFIG_PARSE, {
      failureThreshold: 3,
      resetTimeoutMs: 60000,
    });
    
    const result = await cb.execute(async () => {
      try {
        return loadOperation();
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
    
    // Cache the result
    configCache.set(configFile, result);
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[Config] Error loading global config: ${err.message}`);
    
    // Attempt recovery
    await recoverConfigParse(configFile, async () => {
      loadOperation();
    }).catch(() => {
      // Recovery failed, use defaults
    });
    
    return DEFAULT_CONFIG;
  }
}

/**
 * Load project config from project directory
 * Wrapped with comprehensive error handling and caching
 */
export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig | null> {
  const configFile = join(projectPath, 'config.yaml');
  
  // Check cache first
  const cached = configCache.get(configFile) as ProjectConfig | undefined;
  if (cached) {
    console.log(`[Config] Cache hit for project config: ${configFile}`);
    return cached;
  }
  
  if (!existsSync(configFile)) {
    console.log(`[Config] No project config at ${configFile}`);
    return null;
  }

  const loadOperation = (): ProjectConfig => {
    const content = readFileSync(configFile, 'utf-8');
    const parsed = yamlToJson(content);
    
    // Validate required fields
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid project config format');
    }
    
    return parsed as unknown as ProjectConfig;
  };

  try {
    // Use circuit breaker protection for config parsing
    const cb = errorHandler.getCircuitBreaker(CIRCUIT_BREAKERS.CONFIG_PARSE, {
      failureThreshold: 3,
      resetTimeoutMs: 60000,
    });
    
    const result = await cb.execute(async () => {
      try {
        return loadOperation();
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
    
    // Cache the result
    if (result) {
      configCache.set(configFile, result);
    }
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[Config] Error loading project config: ${err.message}`);
    
    // Attempt recovery
    await recoverConfigParse(configFile, async () => {
      loadOperation();
    }).catch(() => {
      // Recovery failed, return null
    });
    
    return null;
  }
}

/**
 * Load combined config (global + project)
 * Wrapped with graceful degradation
 */
export async function loadConfig(projectPath?: string): Promise<Config> {
  return withGracefulDegradation(
    async () => {
      const global = await loadGlobalConfig();
      
      if (!projectPath) {
        return { global };
      }

      const project = await loadProjectConfig(projectPath);
      return {
        global,
        project: project || undefined,
        projectPath,
      };
    },
    { global: DEFAULT_CONFIG }, // Fallback to default config
    { operationName: 'load-config' }
  );
}

/**
 * Simple YAML to JSON parser (handles basic YAML) - with memoization
 */
const yamlToJson = memoize(
  (yaml: string): Record<string, unknown> => {
    return parseYamlInternal(yaml);
  },
  {
    maxSize: 100,
    ttlMs: 60 * 1000, // 1 minute TTL
    keyGenerator: (yaml) => {
      // Use hash of content as key
      let hash = 0;
      for (let i = 0; i < yaml.length; i++) {
        const char = yaml.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString();
    },
  }
);

/**
 * Internal YAML parser implementation
 */
function parseYamlInternal(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey = '';
  let currentIndent = 0;
  const stack: { indent: number; obj: Record<string, unknown> }[] = [{ indent: -1, obj: result }];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || !line.trim()) continue;

    const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) continue;

    const [, indentStr, key, value] = match;
    const indent = indentStr.length;
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();

    // Pop stack while current indent <= stack top
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1].obj;

    if (trimmedValue === '' || trimmedValue === '|') {
      // Nested object
      current[trimmedKey] = {};
      stack.push({ indent, obj: current[trimmedKey] as Record<string, unknown> });
    } else {
      // Scalar value
      current[trimmedKey] = parseValue(trimmedValue);
    }
  }

  return result;
}

/**
 * Memoized value parser for config validation
 */
const parseValue = memoize(
  (value: string): unknown => {
    return parseValueInternal(value);
  },
  {
    maxSize: 200,
    ttlMs: 5 * 60 * 1000, // 5 minutes TTL
  }
);

function parseValueInternal(value: string): unknown {
  // Handle null
  if (value === 'null' || value === '~') return null;
  
  // Handle booleans
  if (value === 'true') return true;
  if (value === 'false') return false;
  
  // Handle numbers
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  
  // Handle strings (remove quotes if present)
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  
  // Handle environment variable substitution ${VAR}
  if (value.startsWith('${') && value.endsWith('}')) {
    const envVar = value.slice(2, -1);
    return process.env[envVar] || value;
  }
  
  return value;
}

/**
 * Deep merge two objects - source properties override target
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  
  for (const key in source) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      // Deep merge objects
      result[key] = deepMerge(
        (result[key] as Record<string, unknown>) || {},
        source[key] as Record<string, unknown>
      );
    } else {
      // Override with source value
      result[key] = source[key];
    }
  }
  
  return result;
}

export const config = {
  loadGlobalConfig,
  loadProjectConfig,
  loadConfig,
};