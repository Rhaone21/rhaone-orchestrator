import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigLoader, RhaoneConfig } from '../src/config';

describe('ConfigLoader', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhaone-test-'));
    configPath = path.join(tempDir, 'config.yaml');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should load default config when file does not exist', () => {
    const loader = new ConfigLoader(configPath);
    const config = loader.get();

    expect(config.defaults.agent).toBe('claude-code');
    expect(config.defaults.model).toBe('claude-sonnet-4-20250514');
    expect(config.telegram.enabled).toBe(true);
  });

  test('should load config from file', () => {
    const yaml = `
defaults:
  agent: test-agent
  model: test-model
github:
  owner: test-owner
  repo: test-repo
telegram:
  chatId: "123456"
  enabled: true
projects:
  test-project:
    name: Test Project
    repo: https://github.com/test/repo
    path: /tmp/test
    defaultBranch: develop
`;
    fs.writeFileSync(configPath, yaml);

    const loader = new ConfigLoader(configPath);
    const config = loader.get();

    expect(config.defaults.agent).toBe('test-agent');
    expect(config.defaults.model).toBe('test-model');
    expect(config.github.owner).toBe('test-owner');
    expect(config.github.repo).toBe('test-repo');
    expect(config.telegram.chatId).toBe('123456');
    expect(config.projects['test-project']).toBeDefined();
    expect(config.projects['test-project'].defaultBranch).toBe('develop');
  });

  test('should merge user config with defaults', () => {
    const yaml = `
defaults:
  model: custom-model
projects:
  test-project:
    name: Test
    path: /tmp/test
`;
    fs.writeFileSync(configPath, yaml);

    const loader = new ConfigLoader(configPath);
    const config = loader.get();

    // User values
    expect(config.defaults.model).toBe('custom-model');
    // Default values preserved
    expect(config.defaults.agent).toBe('claude-code');
    // Default values preserved
    expect(config.telegram.enabled).toBe(true);
  });

  test('should get project config', () => {
    const yaml = `
projects:
  my-project:
    name: My Project
    repo: https://github.com/test/repo
    path: /tmp/my-project
`;
    fs.writeFileSync(configPath, yaml);

    const loader = new ConfigLoader(configPath);
    const project = loader.getProject('my-project');

    expect(project).toBeDefined();
    expect(project?.name).toBe('My Project');
  });

  test('should return null for non-existent project', () => {
    const loader = new ConfigLoader(configPath);
    const project = loader.getProject('non-existent');

    expect(project).toBeNull();
  });

  test('should save config', () => {
    const loader = new ConfigLoader(configPath);
    loader.save({
      defaults: {
        agent: 'new-agent',
        model: 'new-model',
      },
    });

    const newLoader = new ConfigLoader(configPath);
    const config = newLoader.get();

    expect(config.defaults.agent).toBe('new-agent');
    expect(config.defaults.model).toBe('new-model');
  });

  test('should get GitHub token from config or env', () => {
    process.env.GITHUB_TOKEN = 'env-token';
    const yaml = `
github:
  token: config-token
`;
    fs.writeFileSync(configPath, yaml);

    const loader = new ConfigLoader(configPath);
    expect(loader.getGithubToken()).toBe('config-token');

    // Cleanup
    delete process.env.GITHUB_TOKEN;
  });

  test('should fallback to env var for GitHub token', () => {
    process.env.GITHUB_TOKEN = 'env-token';
    const loader = new ConfigLoader(configPath);

    expect(loader.getGithubToken()).toBe('env-token');

    delete process.env.GITHUB_TOKEN;
  });
});