const path = require('path');
const TemplateEngine = require('../../src/utils/TemplateEngine');
const FileUtils = require('../../src/utils/FileUtils');
const os = require('os');
const fs = require('fs').promises;

describe('TemplateEngine', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `template-test-${Date.now()}`);
    await FileUtils.createDirectory(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should render a template string', () => {
    const template = 'Hello <%= name %>!';
    const data = { name: 'World' };
    const result = TemplateEngine.renderString(template, data);
    expect(result).toBe('Hello World!');
  });

  test('should render a template file', async () => {
    const templatePath = path.join(tempDir, 'template.ejs');
    const templateContent = 'Project: <%= projectName %>';
    await FileUtils.writeFile(templatePath, templateContent);

    const result = await TemplateEngine.render(templatePath, { projectName: 'TestProject' });
    expect(result).toBe('Project: TestProject');
  });

  test('should render template to file', async () => {
    const templatePath = path.join(tempDir, 'template.ejs');
    const outputPath = path.join(tempDir, 'output.txt');
    const templateContent = 'Name: <%= name %>';
    await FileUtils.writeFile(templatePath, templateContent);

    await TemplateEngine.renderToFile(templatePath, outputPath, { name: 'Test' });
    const output = await FileUtils.readFile(outputPath);
    expect(output).toBe('Name: Test');
  });

  test('should handle template with multiple variables', () => {
    const template = '<%= greeting %> <%= name %>, you are <%= age %> years old.';
    const data = { greeting: 'Hello', name: 'Alice', age: 30 };
    const result = TemplateEngine.renderString(template, data);
    expect(result).toBe('Hello Alice, you are 30 years old.');
  });
});
