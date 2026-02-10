const path = require('path');
const fs = require('fs').promises;
const NodeJSPlugin = require('../../src/plugins/NodeJSPlugin');
const FileUtils = require('../../src/utils/FileUtils');
const os = require('os');

describe('NodeJSPlugin', () => {
  let plugin;
  let tempDir;

  beforeEach(async () => {
    plugin = new NodeJSPlugin();
    tempDir = path.join(os.tmpdir(), `nodejs-plugin-test-${Date.now()}`);
    await FileUtils.createDirectory(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should have correct metadata', () => {
    const metadata = plugin.getMetadata();
    expect(metadata.name).toBe('nodejs');
    expect(metadata.description).toBe('Scaffold a Node.js project with Express');
  });

  test('should scaffold a Node.js project', async () => {
    const options = {
      projectName: 'test-project',
      description: 'Test description',
      author: 'Test Author',
      targetPath: tempDir
    };

    const result = await plugin.scaffold(options);

    expect(result.success).toBe(true);
    expect(result.message).toContain('test-project');
    
    const projectPath = path.join(tempDir, 'test-project');
    
    // Check if project files were created
    const packageJsonExists = await FileUtils.exists(path.join(projectPath, 'package.json'));
    const readmeExists = await FileUtils.exists(path.join(projectPath, 'README.md'));
    const indexExists = await FileUtils.exists(path.join(projectPath, 'index.js'));
    const gitignoreExists = await FileUtils.exists(path.join(projectPath, '.gitignore'));

    expect(packageJsonExists).toBe(true);
    expect(readmeExists).toBe(true);
    expect(indexExists).toBe(true);
    expect(gitignoreExists).toBe(true);

    // Verify content
    const packageJson = JSON.parse(await FileUtils.readFile(path.join(projectPath, 'package.json')));
    expect(packageJson.name).toBe('test-project');
    expect(packageJson.description).toBe('Test description');
    expect(packageJson.author).toBe('Test Author');
  });

  test('should throw error if projectName is missing', async () => {
    const options = {
      targetPath: tempDir
    };

    await expect(plugin.scaffold(options)).rejects.toThrow('Project name is required');
  });

  test('should throw error if targetPath is missing', async () => {
    const options = {
      projectName: 'test-project'
    };

    await expect(plugin.scaffold(options)).rejects.toThrow('Target path is required');
  });

  test('should use default description if not provided', async () => {
    const options = {
      projectName: 'test-project',
      targetPath: tempDir
    };

    const result = await plugin.scaffold(options);
    expect(result.success).toBe(true);

    const projectPath = path.join(tempDir, 'test-project');
    const packageJson = JSON.parse(await FileUtils.readFile(path.join(projectPath, 'package.json')));
    expect(packageJson.description).toBe('A Node.js project');
  });
});
