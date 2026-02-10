const path = require('path');
const fs = require('fs').promises;
const FileUtils = require('../../src/utils/FileUtils');
const os = require('os');

describe('FileUtils', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `test-${Date.now()}`);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should create a directory', async () => {
    await FileUtils.createDirectory(tempDir);
    const exists = await FileUtils.exists(tempDir);
    expect(exists).toBe(true);
  });

  test('should create nested directories', async () => {
    const nestedDir = path.join(tempDir, 'nested', 'deep');
    await FileUtils.createDirectory(nestedDir);
    const exists = await FileUtils.exists(nestedDir);
    expect(exists).toBe(true);
  });

  test('should write a file', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    const content = 'Hello, World!';
    await FileUtils.writeFile(filePath, content);
    
    const readContent = await FileUtils.readFile(filePath);
    expect(readContent).toBe(content);
  });

  test('should read a file', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    const content = 'Test content';
    await FileUtils.writeFile(filePath, content);
    
    const readContent = await FileUtils.readFile(filePath);
    expect(readContent).toBe(content);
  });

  test('should check if path exists', async () => {
    await FileUtils.createDirectory(tempDir);
    const exists = await FileUtils.exists(tempDir);
    expect(exists).toBe(true);
    
    const notExists = await FileUtils.exists(path.join(tempDir, 'non-existent'));
    expect(notExists).toBe(false);
  });

  test('should copy a file', async () => {
    const sourceFile = path.join(tempDir, 'source.txt');
    const destFile = path.join(tempDir, 'dest.txt');
    const content = 'Copy test';
    
    await FileUtils.writeFile(sourceFile, content);
    await FileUtils.copyFile(sourceFile, destFile);
    
    const copiedContent = await FileUtils.readFile(destFile);
    expect(copiedContent).toBe(content);
  });
});
