const path = require('path');
const BasePlugin = require('../core/BasePlugin');
const TemplateEngine = require('../utils/TemplateEngine');
const FileUtils = require('../utils/FileUtils');

/**
 * NodeJSPlugin - Plugin for scaffolding Node.js projects
 */
class NodeJSPlugin extends BasePlugin {
  constructor() {
    super('nodejs', 'Scaffold a Node.js project with Express');
  }

  /**
   * Scaffold a Node.js project
   * @param {Object} options - Project configuration options
   * @param {string} options.projectName - Name of the project
   * @param {string} options.description - Project description
   * @param {string} options.author - Project author
   * @param {string} options.targetPath - Target directory path
   */
  async scaffold(options) {
    const {
      projectName,
      description = 'A Node.js project',
      author = '',
      targetPath
    } = options;

    if (!projectName) {
      throw new Error('Project name is required');
    }

    if (!targetPath) {
      throw new Error('Target path is required');
    }

    const templateDir = path.join(__dirname, '../templates/nodejs');
    const projectPath = path.join(targetPath, projectName);

    // Create project directory
    await FileUtils.createDirectory(projectPath);

    // Template data
    const templateData = {
      projectName,
      description,
      author
    };

    // Render templates
    const templates = [
      { src: 'package.json.ejs', dest: 'package.json' },
      { src: 'README.md.ejs', dest: 'README.md' },
      { src: 'index.js.ejs', dest: 'index.js' },
      { src: '.gitignore.ejs', dest: '.gitignore' }
    ];

    for (const template of templates) {
      const templatePath = path.join(templateDir, template.src);
      const outputPath = path.join(projectPath, template.dest);
      await TemplateEngine.renderToFile(templatePath, outputPath, templateData);
    }

    return {
      success: true,
      message: `Node.js project '${projectName}' created successfully at ${projectPath}`,
      path: projectPath
    };
  }
}

module.exports = NodeJSPlugin;
